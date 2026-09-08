mod commands;
mod db;
mod gdrive;
mod mcp;
mod metadata;
mod scan;
mod secret;
mod server;

use sqlx::SqlitePool;
use std::sync::Arc;
use tauri::{Emitter, Manager};

/// Sauvegarde automatique JSON dans Documents\Vaultly\Sauvegardes.
/// Appelée à la fermeture de la fenêtre principale (silencieuse : un
/// échec ne doit jamais bloquer l'arrêt, on journalise seulement).
async fn auto_backup(pool: SqlitePool, dir: std::path::PathBuf) {
    let _ = tokio::fs::create_dir_all(&dir).await;
    // la sauvegarde doit être exhaustive : sans `no_limit`, le garde-fou
    // LIMIT 500 de list_resources tronquerait silencieusement le backup.
    // Une ERREUR de lecture (base verrouillée/corrompue) ABORT la sauvegarde :
    // avec `unwrap_or_default`, on écrasait un backup VIDE horodaté comme
    // valide, et le prune finissait par évincer les bons backups.
    let resources = match db::list_resources(
        &pool,
        &db::ResourceFilter {
            no_limit: true,
            ..Default::default()
        },
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("sauvegarde auto annulée (lecture des ressources) : {e}");
            return;
        }
    };
    let folders = match db::list_folders(&pool).await {
        Ok(f) => f,
        Err(e) => {
            tracing::warn!("sauvegarde auto annulée (lecture des dossiers) : {e}");
            return;
        }
    };
    let data = commands::ExportData {
        resources,
        folders,
        version: env!("CARGO_PKG_VERSION").into(),
    };
    match serde_json::to_string_pretty(&data) {
        Ok(json) => {
            let stamp = chrono_like_stamp();
            let path = dir.join(format!("vaultly-{stamp}.json"));
            if let Err(e) = tokio::fs::write(&path, json).await {
                tracing::warn!("sauvegarde auto échouée : {e}");
            } else {
                prune_old_backups(&dir, 10).await;
            }
        }
        Err(e) => tracing::warn!("sauvegarde auto : sérialisation {e}"),
    }
}

fn chrono_like_stamp() -> String {
    // horodatage UTC : YYYYMMDD-HHMMSS via l'heure système (pas de chrono)
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = civil_from_secs(secs);
    format!("{y:04}{mo:02}{d:02}-{h:02}{mi:02}{s:02}")
}

fn civil_from_secs(secs: u64) -> (u64, u64, u64, u64, u64, u64) {
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // conversion jours -> date (algorithme de Howard Hinnant)
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z % 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d, h, mi, s)
}

/// Alias public pour gdrive.rs (horodatage des backups Drive).
pub fn civil_from_secs_public(secs: u64) -> (u64, u64, u64, u64, u64, u64) {
    civil_from_secs(secs)
}

async fn prune_old_backups(dir: &std::path::Path, keep: usize) {
    // Sécurité : ne supprime QUE nos propres sauvegardes `vaultly-*.json`
    // (ou `connectall-*.json` d'avant le renommage), jamais un autre *.json
    // de l'utilisateur présent dans le dossier.
    // Lecture du dossier en spawn_blocking (IO synchrone hors de l'async).
    let dir_for_listing = dir.to_path_buf();
    let mut files: Vec<_> = tokio::task::spawn_blocking(move || {
        std::fs::read_dir(&dir_for_listing)
            .map(|rd| {
                rd.flatten()
                    .filter(|f| {
                        let name = f.file_name();
                        let name = name.to_string_lossy();
                        // préfixe historique « connectall- » accepté : les
                        // sauvegardes créées avant le renommage restent
                        // prunées avec les nouvelles
                        (name.starts_with("vaultly-") || name.starts_with("connectall-"))
                            && name.ends_with(".json")
                            && f.path().extension().map(|e| e == "json").unwrap_or(false)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default();
    files.sort_by_key(|f| f.file_name());
    while files.len() > keep {
        let oldest = files.remove(0);
        let _ = tokio::fs::remove_file(oldest.path()).await;
    }
}
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// statut MCP partagé entre le spawn de démarrage et les commandes Tauri
pub struct McpStatus(pub server::SharedStatus);

/// Handles des tâches de fond (serveur MCP, boucle auto-backup),
/// avortées à l'arrêt de l'application (best effort).
type BgHandles = Arc<std::sync::Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>>;

/// Avorte toutes les tâches de fond enregistrées (best effort, sans paniquer).
fn abort_background(handles: &BgHandles) {
    if let Ok(mut guard) = handles.lock() {
        for h in guard.drain(..) {
            h.abort();
        }
    }
}

/// Amène la fenêtre principale au premier plan (tray, raccourci global).
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Migration one-shot des données de l'ancienne app « ConnectAll » :
/// copie connectall.db et LISEZ-MOI vers les nouveaux dossiers si la base
/// du nouveau nom n'existe pas encore. Le dossier Documents est renommé
/// ConnectAll → Vaultly si possible (contenu entier). Silencieux : tout
/// échec est loggé, jamais bloquant.
fn migrate_from_connectall(app: &tauri::AppHandle, new_data_dir: &std::path::Path) {
    let db_path = new_data_dir.join("vaultly.db");
    if db_path.exists() {
        return; // déjà migré ou nouvelle installation : rien à faire
    }
    // ancien dossier APPDATA (même arborescence, ancien identifiant)
    let old_appdata = app
        .path()
        .data_dir()
        .ok()
        .map(|d| d.join("com.alexanders.connectall"));
    if let Some(old) = old_appdata {
        let old_db = old.join("connectall.db");
        if old_db.exists() {
            if let Err(e) = std::fs::copy(&old_db, &db_path) {
                tracing::warn!("migration ConnectAll : copie de la base échouée : {e}");
            } else {
                // les fichiers WAL/SHM accompagnent la base s'ils existent
                for suffix in ["-wal", "-shm"] {
                    let src = old.join(format!("connectall.db{suffix}"));
                    if src.exists() {
                        let _ = std::fs::copy(
                            &src,
                            new_data_dir.join(format!("vaultly.db{suffix}")),
                        );
                    }
                }
                tracing::warn!("migration ConnectAll → Vaultly : base copiée");
            }
        }
    }
    // ancien dossier Documents\ConnectAll → Documents\Vaultly
    if let Some(dirs) = directories::UserDirs::new() {
        if let Some(docs) = dirs.document_dir() {
            let old_res = docs.join("ConnectAll");
            let new_res = docs.join("Vaultly");
            if old_res.exists() && !new_res.exists() {
                match std::fs::rename(&old_res, &new_res) {
                    Ok(()) => tracing::warn!("migration ConnectAll → Vaultly : dossier Documents renommé"),
                    Err(e) => {
                        // dossier verrouillé (Explorateur ouvert...) : on copie
                        // au moins la structure pour que l'app fonctionne
                        tracing::warn!(
                            "migration ConnectAll : renommage de Documents\\ConnectAll échoué ({e}), copie des sous-dossiers"
                        );
                        let _ = std::fs::create_dir_all(new_res.join("Fichiers"));
                        let _ = std::fs::create_dir_all(new_res.join("Icones"));
                    }
                }
            }
        }
    }
}

/// Séquence de sortie propre : avorte les tâches de fond, attend la
/// sauvegarde JSON puis quitte. Partagée par « Quitter » du plateau système
/// et par la croix quand le plateau n'a pas pu être créé — sinon le process
/// pourrait mourir en pleine écriture du backup (le piège historique).
fn save_and_exit(
    app: &tauri::AppHandle,
    closing: &Arc<std::sync::atomic::AtomicBool>,
    bg: &BgHandles,
) {
    if closing.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return; // sortie déjà en cours
    }
    abort_background(bg);
    let app = app.clone();
    let pool = app.try_state::<SqlitePool>().map(|p| p.inner().clone());
    let dir = commands::resources_root_dir(&app).join("Sauvegardes");
    tauri::async_runtime::spawn(async move {
        if let Some(pool) = pool {
            auto_backup(pool, dir).await;
        }
        app.exit(0);
    });
}

#[tauri::command]
async fn get_mcp_status(
    status: tauri::State<'_, McpStatus>,
) -> Result<server::McpServerStatus, String> {
    Ok(status.0.read().await.clone())
}

/// Initialise le logging persistant : un fichier par jour dans
/// %APPDATA%\com.kevsi.vaultly\logs (7 jours conservés). Remplace les
/// eprintln! invisibles en release — les bugs rapportés par les
/// utilisateurs deviennent diagnostiquables. Ne panique jamais : sans
/// logging, l'app doit continuer de fonctionner.
fn init_logging() {
    // directories 6 : BaseDirs::data_dir() = %APPDATA% (roaming) sur Windows
    let Some(base) = directories::BaseDirs::new().map(|d| d.data_dir().to_path_buf()) else {
        return;
    };
    let log_dir = base.join("com.kevsi.vaultly").join("logs");
    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }
    // prune des vieux fichiers (vaultly.log.YYYY-MM-DD) : garde 7 jours
    let cutoff = chrono_like_stamp(); // réutilise le format, suffixe à part
    let _ = cutoff; // (le tri lexicographique par nom suffit, voir ci-dessous)
    let mut daily: Vec<String> = std::fs::read_dir(&log_dir)
        .map(|rd| {
            rd.flatten()
                .filter_map(|f| {
                    let n = f.file_name().to_string_lossy().to_string();
                    n.strip_prefix("vaultly.log.")
                        .filter(|d| d.len() == 10 && d.chars().all(|c| c.is_ascii_digit() || c == '-'))
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default();
    daily.sort();
    daily.reverse();
    for old in daily.iter().skip(7) {
        let _ = std::fs::remove_file(log_dir.join(format!("vaultly.log.{old}")));
    }

    let appender = tracing_appender::rolling::daily(&log_dir, "vaultly.log");
    let (writer, guard) = tracing_appender::non_blocking(appender);
    // le guard fait avancer le writer en tâche de fond : il doit vivre
    // jusqu'à la fin du process (on n'a pas de point de sortie propre qui
    // puisse le flusher — exit(0) de save_and_exit inclus).
    std::mem::forget(guard);
    let _ = tracing_subscriber::fmt()
        .with_writer(writer)
        .with_ansi(false)
        .with_target(false)
        .try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();
    tracing::info!("Vaultly démarre (v{})", env!("CARGO_PKG_VERSION"));
    // Handles des tâches de fond, partagés entre le setup (qui les remplit)
    // et on_window_event (qui les avorte à l'arrêt). Le serveur callback
    // OAuth est spawné dans gdrive.rs (aucun handle exposé) : le process qui
    // s'arrête le nettoie de toute façon.
    let bg_for_setup: BgHandles = Arc::new(std::sync::Mutex::new(Vec::new()));
    let bg_for_event = bg_for_setup.clone();
    let bg_for_tray = bg_for_setup.clone();
    // anti double-fermeture : la première demande déclenche la sauvegarde
    // puis app.exit(), les suivantes pendant la sauvegarde sont ignorées
    let closing = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let closing_for_tray = closing.clone();
    // le plateau système décide du rôle de la croix : masquer (tray ok) ou
    // sortir proprement (fallback sans tray). Créé dans setup.
    let tray_available = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let tray_for_setup = tray_available.clone();
    let tray_for_event = tray_available.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // focus la fenêtre existante quand une 2e instance est lancée
            show_main(app);
        }))
        .plugin(
            // Alt+Espace système : montre la fenêtre et bascule la palette
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                            let _ = win.emit("palette-toggle", ());
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(move |app| {
            // base de données dans %APPDATA%/com.kevsi.vaultly
            let app_data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data)?;

            // --- migration depuis l'ancien nom ConnectAll (one-shot) ---
            // l'app s'appelait ConnectAll : les données vivaient dans
            // %APPDATA%\com.alexanders.connectall (connectall.db) et
            // Documents\ConnectAll. Si l'app renommée démarre avec un
            // dossier de données vide, on récupère l'ancien.
            migrate_from_connectall(app.handle(), &app_data);

            // dossier de ressources visible : Documents\Vaultly
            let res_dir = commands::resources_root_dir(app.handle());
            let _ = std::fs::create_dir_all(res_dir.join("Fichiers"));
            let _ = std::fs::create_dir_all(res_dir.join("Icones"));
            let readme = res_dir.join("LISEZ-MOI.txt");
            if !readme.exists() {
                let _ = std::fs::write(
                    &readme,
                    "Vaultly - dossier de ressources\r\n\r\nFichiers/ : tes fichiers (documents, captures...) a cote de tes ressources\r\nIcones/ : icones personnalisees des tuiles\r\n",
                );
            }

            let db_path = app_data.join("vaultly.db");
            let pool = tauri::async_runtime::block_on(async {
                let pool = db::open_pool(&db_path).await?;
                db::migrate(&pool).await?;
                Ok::<SqlitePool, sqlx::Error>(pool)
            })?;

            app.manage(pool.clone());

            // lancement auto Windows activé au tout premier démarrage (un
            // launcher doit être là dès l'ouverture de session) ; coupable
            // dans Réglages — le flag évite de le réactiver après un refus
            // explicite de l'utilisateur.
            tauri::async_runtime::block_on(async {
                use tauri_plugin_autostart::ManagerExt;
                // migration du renommage : le raccourci autostart Windows
                // pointait vers l'ancien exécutable ConnectAll — on le
                // réenregistre une fois vers le nouvel exe (one-shot, la clé
                // dédiée évite d'écraser un refus utilisateur ultérieur).
                if db::get_setting(&pool, "vaultly_autostart_migrated")
                    .await
                    .is_none()
                {
                    let _ = app.handle().autolaunch().enable();
                    let _ = db::set_setting(&pool, "vaultly_autostart_migrated", "1").await;
                }
                if db::get_setting(&pool, "autostart_done").await.is_none() {
                    let _ = app.handle().autolaunch().enable();
                    let _ = db::set_setting(&pool, "autostart_done", "1").await;
                }
                // purge de la corbeille : les entrées de plus de 30 jours
                if let Ok(n) = db::purge_expired_trash(&pool, 30).await {
                    if n > 0 {
                        tracing::warn!("corbeille : {n} entrée(s) expirée(s) purgée(s)");
                    }
                }
            });

            // --- plateau système : la croix masque, « Quitter » sauvegarde + sort ---
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                let open_i = MenuItem::with_id(app.handle(), "tray_open", "Ouvrir Vaultly", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app.handle(), "tray_quit", "Quitter", true, None::<&str>)?;
                let tray_menu = Menu::with_items(app.handle(), &[&open_i, &quit_i])?;
                let closing_t = closing_for_tray;
                let bg_t = bg_for_tray;
                let tray_flag = tray_for_setup;
                match TrayIconBuilder::with_id("vaultly-tray")
                    .menu(&tray_menu)
                    .tooltip("Vaultly — hub de ressources")
                    .icon(app.default_window_icon().expect("icône de fenêtre embarquée").clone())
                    .on_menu_event(move |app, ev| match ev.id().as_ref() {
                        "tray_open" => show_main(app),
                        "tray_quit" => save_and_exit(app, &closing_t, &bg_t),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, ev| {
                        // clic gauche : ouvrir/amener la fenêtre ; clic droit : menu
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = ev
                        {
                            show_main(tray.app_handle());
                        }
                    })
                    .build(app.handle())
                {
                    Ok(_) => tray_flag.store(true, std::sync::atomic::Ordering::SeqCst),
                    Err(e) => tracing::warn!("icône plateau indisponible : {e} — la croix redevient la sortie"),
                }
            }

            // statut MCP initialisé vide, rempli par le spawn ci-dessous
            let status_holder: server::SharedStatus =
                Arc::new(tokio::sync::RwLock::new(server::McpServerStatus {
                    running: false,
                    port: 0,
                    url: String::new(),
                    token: String::new(),
                    add_token: String::new(),
                }));
            app.manage(McpStatus(status_holder.clone()));

            // serveur de callback Google OAuth : démarre une fois pour toutes
            let gdrive_slot: gdrive::AuthCodeSlot =
                Arc::new(tokio::sync::RwLock::new(None));
            let slot_for_server = gdrive_slot.clone();
            tauri::async_runtime::block_on(async {
                if let Err(e) = gdrive::start_callback_server(slot_for_server).await {
                    tracing::warn!("serveur callback gdrive non démarré : {e}");
                }
            });
            app.manage(gdrive::GDriveSlot(gdrive_slot));

            // jetons générés au premier lancement, chiffrés au repos (DPAPI) :
            // `mcp_token` = plein accès (clients IA), `api_add_token` = POST
            // /api/add uniquement (extension navigateur).
            let shared_tokens = tauri::async_runtime::block_on(async {
                // migration une fois : les jetons écrits EN CLAIR avant le
                // mécanisme DPAPI sont chiffrés dès ce démarrage (sinon il
                // faudrait attendre leur prochaine réécriture, parfois jamais)
                for key in [
                    "mcp_token",
                    "api_add_token",
                    "gdrive_refresh_token",
                    "gdrive_access_token",
                    "gdrive_client_secret",
                ] {
                    if let Some(v) = db::get_setting(&pool, key).await {
                        if !v.is_empty() && !secret::is_encrypted(&v) {
                            if let Err(e) = db::set_secret(&pool, key, &v).await {
                                tracing::warn!("migration DPAPI du secret {key} échouée : {e}");
                            }
                        }
                    }
                }
                async fn ensure_token(pool: &SqlitePool, key: &str) -> String {
                    match db::get_secret(pool, key).await {
                        Some(t) => t,
                        None => {
                            let t = server::generate_token();
                            if let Err(e) = db::set_secret(pool, key, &t).await {
                                // sans persistance, le jeton serait régénéré à
                                // chaque démarrage et les clients déconnectés
                                // sans message : le dire dans les logs.
                                tracing::warn!("jeton {key} non persisté : {e}");
                            }
                            t
                        }
                    }
                }
                let mcp = ensure_token(&pool, "mcp_token").await;
                let add = ensure_token(&pool, "api_add_token").await;
                server::SharedTokens::new(mcp, add)
            });
            app.manage(shared_tokens.clone());

            let pool_for_server = pool.clone();
            let bg_for_server = bg_for_setup.clone();
            tauri::async_runtime::spawn(async move {
                let (new_status, serve_handle) =
                    match server::start(pool_for_server, shared_tokens).await {
                        Ok((s, h)) => (s, Some(h)),
                        Err(e) => {
                            tracing::warn!("serveur MCP non démarré : {e}");
                            (
                                server::McpServerStatus {
                                    running: false,
                                    port: 0,
                                    url: String::new(),
                                    token: String::new(),
                                    add_token: String::new(),
                                },
                                None,
                            )
                        }
                    };
                if let Some(h) = serve_handle {
                    if let Ok(mut guard) = bg_for_server.lock() {
                        guard.push(h);
                    }
                }
                let mut guard = status_holder.write().await;
                *guard = new_status;
            });

            // raccourci global personnalisable (défaut : ctrl+alt+space —
            // alt+space est réservé par Windows et échoue à s'enregistrer)
            let shortcut = tauri::async_runtime::block_on(async {
                db::get_setting(&pool, "global_shortcut")
                    .await
                    .filter(|s| !s.is_empty() && s != "alt+space")
                    .unwrap_or_else(|| "ctrl+alt+space".into())
            });
            if let Err(e) = app.global_shortcut().register(shortcut.as_str()) {
                tracing::warn!("raccourci global indisponible ({shortcut}) : {e}");
            }

            // auto-backup Drive : toutes les 30 minutes, si l'autobackup est
            // activé, Drive connecté, et l'intervalle écoulé depuis le dernier backup.
            let pool_for_backup = pool.clone();
            let backup_loop = tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(30 * 60)).await;
                    let enabled = db::get_setting(&pool_for_backup, "gdrive_autobackup_enabled")
                        .await
                        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                        .unwrap_or(false);
                    if !enabled {
                        continue;
                    }
                    let connected = db::get_secret(&pool_for_backup, "gdrive_refresh_token")
                        .await
                        .is_some();
                    if !connected {
                        continue;
                    }
                    let interval_hours: i64 =
                        db::get_setting(&pool_for_backup, "gdrive_autobackup_interval_hours")
                            .await
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(24)
                            .max(1);
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    let last: Option<i64> =
                        db::get_setting(&pool_for_backup, "gdrive_last_backup_at")
                            .await
                            .and_then(|v| v.parse().ok());
                    if last.map(|l| now - l > interval_hours * 3600).unwrap_or(true) {
                        if let Err(e) = gdrive::backup_to_drive(&pool_for_backup).await {
                            tracing::warn!("auto-backup Drive échoué : {e}");
                        }
                    }
                }
            });
            if let Ok(mut guard) = bg_for_setup.lock() {
                guard.push(backup_loop);
            }

            Ok(())
        })
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    if !tray_for_event.load(std::sync::atomic::Ordering::SeqCst) {
                        // pas de plateau système : la croix reste la sortie
                        // propre (backup attendu puis exit) — sinon une
                        // fenêtre masquée serait in-rattrapable.
                        save_and_exit(window.app_handle(), &closing, &bg_for_event);
                        return;
                    }
                    // plateau actif : la croix MASQUE la fenêtre (le launcher
                    // continue de vivre dans le tray, Ctrl+Alt+Espace la fait
                    // resurgir). La sauvegarde JSON part en tâche de fond ;
                    // la vraie sortie (avec backup attendu) est « Quitter ».
                    if let Some(w) = window.app_handle().get_webview_window("main") {
                        let _ = w.hide();
                    }
                    let app = window.app_handle().clone();
                    let pool = app.try_state::<SqlitePool>().map(|p| p.inner().clone());
                    let dir = commands::resources_root_dir(&app).join("Sauvegardes");
                    tauri::async_runtime::spawn(async move {
                        if let Some(pool) = pool {
                            auto_backup(pool, dir).await;
                        }
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_resources,
            commands::get_resource,
            commands::add_resource,
            commands::update_resource,
            commands::delete_resource,
            commands::delete_resources,
            commands::list_trash,
            commands::restore_trash,
            commands::restore_trash_bulk,
            commands::empty_trash,
            commands::wayback_available,
            commands::set_autostart,
            commands::get_autostart,
            commands::toggle_favorite,
            commands::record_open,
            commands::reorder_resources,
            commands::all_tags,
            commands::categories_with_counts,
            commands::fetch_metadata,
            commands::fetch_repo_details,
            commands::detect_browser_profiles,
            commands::import_bookmarks,
            commands::open_resources_folder,
            commands::read_image_data_url,
            commands::launch_executable,
            commands::open_file_path,
            commands::list_folders,
            commands::create_folder,
            commands::rename_folder,
            commands::delete_folder,
            commands::move_folder,
            commands::dissolve_folder,
            commands::set_resource_status,
            commands::check_dead_links,
            commands::gdrive_connect,
            commands::gdrive_status,
            commands::gdrive_disconnect,
            commands::gdrive_upload,
            commands::gdrive_list_files,
            commands::gdrive_search_files,
            commands::gdrive_download,
            commands::gdrive_delete_file,
            commands::gdrive_create_folder,
            commands::gdrive_share_file,
            commands::gdrive_list_share_lists,
            commands::gdrive_append_link,
            commands::gdrive_backup,
            commands::gdrive_restore,
            commands::gdrive_set_backup_folder,
            commands::gdrive_set_autobackup,
            commands::gdrive_get_settings,
            commands::set_resource_folder,
            commands::get_stats,
            commands::is_url_known,
            commands::export_data,
            commands::import_data,
            commands::set_global_shortcut,
            get_mcp_status,
            server::mcp_regenerate_token,
            server::api_regenerate_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

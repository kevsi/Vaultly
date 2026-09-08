use crate::db::{self, NewResource, Resource, ResourceFilter};
use tauri::Manager;
use crate::scan::{read_chromium, read_firefox, BrowserProfile, ImportedBookmark};
use sqlx::SqlitePool;
use tauri::State;

#[tauri::command]
pub async fn list_resources(
    pool: State<'_, SqlitePool>,
    filter: Option<ResourceFilter>,
) -> Result<Vec<Resource>, String> {
    db::list_resources(&pool, &filter.unwrap_or_default()).await
}

#[tauri::command]
pub async fn get_resource(pool: State<'_, SqlitePool>, id: i64) -> Result<Resource, String> {
    db::get_resource(&pool, id).await
}

#[tauri::command]
pub async fn add_resource(
    pool: State<'_, SqlitePool>,
    resource: NewResource,
) -> Result<Resource, String> {
    let resource = normalize_url(resource)?;
    db::add_resource(&pool, &resource).await
}

#[tauri::command]
pub async fn update_resource(
    pool: State<'_, SqlitePool>,
    id: i64,
    resource: NewResource,
) -> Result<Resource, String> {
    let resource = normalize_url(resource)?;
    db::update_resource(&pool, id, &resource).await
}

#[tauri::command]
pub async fn delete_resource(pool: State<'_, SqlitePool>, id: i64) -> Result<(), String> {
    db::delete_resource(&pool, id).await
}

/// Suppression en masse (sélection multiple).
#[tauri::command]
pub async fn delete_resources(
    pool: State<'_, SqlitePool>,
    ids: Vec<i64>,
) -> Result<usize, String> {
    db::delete_resources(&pool, &ids).await
}

// --- Corbeille (suppressions restaurables pendant 30 jours) ---

#[tauri::command]
pub async fn list_trash(pool: State<'_, SqlitePool>) -> Result<Vec<db::TrashEntry>, String> {
    db::list_trash(&pool).await
}

#[tauri::command]
pub async fn restore_trash(
    pool: State<'_, SqlitePool>,
    trash_id: i64,
) -> Result<Resource, String> {
    db::restore_trash(&pool, trash_id).await
}

/// Restauration en masse depuis la corbeille (sélection multiple).
/// Retourne le nombre restauré + les ids de corbeille introuvables
/// (déjà restaurés ailleurs) — mais échoue si une URL est en conflit.
#[tauri::command]
pub async fn restore_trash_bulk(
    pool: State<'_, SqlitePool>,
    trash_ids: Vec<i64>,
) -> Result<BulkRestoreResult, String> {
    let missing = db::restore_trash_bulk(&pool, &trash_ids).await?;
    let restored = trash_ids.len() - missing.len();
    Ok(BulkRestoreResult {
        restored,
        missing,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkRestoreResult {
    pub restored: usize,
    pub missing: Vec<i64>,
}

#[tauri::command]
pub async fn empty_trash(pool: State<'_, SqlitePool>) -> Result<usize, String> {
    db::empty_trash(&pool).await
}

// --- Archivage Wayback pour les liens morts ---

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaybackSnapshot {
    pub url: String,
    /// date du snapshot au format compact AAAAMMJJhhmmss
    pub timestamp: String,
}

/// Demande à l'API « availability » d'archive.org si une capture existe pour
/// cette URL. Aucun appel côté webview : requête sortante déclenchée
/// uniquement par un clic explicite sur un lien mort listé.
#[tauri::command]
pub async fn wayback_available(url: String) -> Result<Option<WaybackSnapshot>, String> {
    let lower = url.trim().to_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("seules les URL http(s) peuvent être archivées".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Vaultly/0.2")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get("https://archive.org/wayback/available")
        .query(&[("url", url.trim())])
        .send()
        .await
        .map_err(|e| format!("archive.org injoignable : {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("archive.org a répondu {status}"));
    }
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let closest = body
        .get("archived_snapshots")
        .and_then(|a| a.get("closest"))
        .filter(|c| c.get("available").and_then(|v| v.as_bool()).unwrap_or(false));
    Ok(closest.and_then(|c| {
        let u = c.get("url")?.as_str()?.to_string();
        if u.is_empty() {
            return None;
        }
        let ts = c
            .get("timestamp")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();
        Some(WaybackSnapshot { url: u, timestamp: ts })
    }))
}

#[tauri::command]
pub async fn toggle_favorite(
    pool: State<'_, SqlitePool>,
    id: i64,
) -> Result<Resource, String> {
    db::toggle_favorite(&pool, id).await
}

/// Appelé par l'UI à chaque ouverture d'une ressource : incrémente le compteur.
#[tauri::command]
pub async fn record_open(pool: State<'_, SqlitePool>, id: i64) -> Result<(), String> {
    db::record_open(&pool, id).await
}

/// Sauvegarde l'ordre de placement manuel des tuiles.
#[tauri::command]
pub async fn reorder_resources(
    pool: State<'_, SqlitePool>,
    ordered_ids: Vec<i64>,
) -> Result<(), String> {
    db::reorder_resources(&pool, &ordered_ids).await
}

#[tauri::command]
pub async fn all_tags(pool: State<'_, SqlitePool>) -> Result<Vec<String>, String> {
    db::all_tags(&pool).await
}

#[tauri::command]
pub async fn categories_with_counts(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<CategoryCount>, String> {
    Ok(db::categories_with_counts(&pool)
        .await?
        .into_iter()
        .map(|(name, count)| CategoryCount { name, count })
        .collect())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryCount {
    name: String,
    count: i64,
}

#[tauri::command]
pub async fn fetch_metadata(url: String) -> Result<crate::metadata::PageMetadata, String> {
    crate::metadata::fetch(&url).await
}

/// Détails d'un dépôt GitHub (description, langage, stars, README…)
/// pour le formulaire et la vue Détails des ressources type « repo ».
#[tauri::command]
pub async fn fetch_repo_details(
    url: String,
) -> Result<crate::metadata::RepoDetails, String> {
    crate::metadata::fetch_github_repo(&url).await
}

/// Identifiant unique pour une ressource sans lien (garantit l'UNIQUE).
fn placeholder_url() -> String {
    use rand::RngCore;
    // OsRng comme le token MCP (jamais thread_rng pour des valeurs
    // stockées en base — la contrainte UNIQUE n'excuse pas la faiblesse).
    let mut bytes = [0u8; 8];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("local:{hex}")
}

/// Version canonique d'une URL web pour le dédoublonnage : schéma+hôte en
/// minuscules, `www.` retiré, paramètres de tracking (`utm_*`, `gclid`,
/// `fbclid`) retirés, slash final retiré. Le chemin garde sa casse (il est
/// sensible sur la plupart des sites). Les schémas internes (exe:, file:,
/// local:) ne sont pas touchés.
pub(crate) fn canonicalize_url(url: &str) -> String {
    let t = url.trim();
    let (scheme, rest) = match t.split_once("://") {
        Some((s, r)) => (s.to_lowercase(), r),
        None => return t.to_string(),
    };
    if scheme != "http" && scheme != "https" {
        return t.to_string();
    }
    // host / path+query
    let (authority, tail) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    let host_lower = authority.to_lowercase();
    let host = host_lower
        .strip_prefix("www.")
        .unwrap_or(&host_lower)
        .to_string();
    // chemin + requête filtrée
    let (path, query) = match tail.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (tail, None),
    };
    let query_kept = query.map(|q| {
        q.split('&')
            .filter(|kv| {
                let k = kv.split('=').next().unwrap_or("").to_lowercase();
                !(k.starts_with("utm_") || k == "gclid" || k == "fbclid" || k == "mc_cid" || k == "mc_eid")
            })
            .collect::<Vec<_>>()
            .join("&")
    });
    let mut out = format!("{scheme}://{host}{path}");
    if let Some(ref q) = query_kept {
        if !q.is_empty() {
            out.push('?');
            out.push_str(q);
        }
    } else if out.ends_with('/') {
        out.pop();
    }
    // un « https://site.com/ » avec params retranchés peut finir en « / »
    if out.ends_with('/') && !out.ends_with("://") && query_kept.map(|q| q.is_empty()).unwrap_or(false) {
        out.pop();
    }
    out
}

pub(crate) fn normalize_url(mut r: NewResource) -> Result<NewResource, String> {
    // une app Windows peut n'avoir que son exécutable ; une ressource peut
    // n'avoir aucun lien (titre seul) → on stocke un identifiant local unique.
    let exe_path = r
        .meta
        .get("exePath")
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let url = r.url.trim().to_string();
    let lower = url.to_lowercase();
    r.url = if !url.is_empty() {
        // on accepte les schémas internes déjà présents (note sans lien, app, fichier)
        let internal = lower.starts_with("local:")
            || lower.starts_with("exe:")
            || lower.starts_with("file:");
        if !internal && !lower.starts_with("http://") && !lower.starts_with("https://") {
            return Err("l'URL doit commencer par http:// ou https://".into());
        }
        if internal { url.clone() } else { canonicalize_url(&url) }
    } else if !exe_path.is_empty() {
        format!("exe:{exe_path}")
    } else {
        placeholder_url()
    };
    if r.title.trim().is_empty() {
        // titre de repli : nom de fichier, domaine web, sinon "Sans titre"
        let url_lower = r.url.to_lowercase();
        r.title = if url_lower.starts_with("file:") {
            std::path::Path::new(&r.url[5..])
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Fichier")
                .to_string()
        } else if url_lower.starts_with("http") {
            r.url
                .trim_start_matches("https://")
                .trim_start_matches("http://")
                .split('/')
                .next()
                .unwrap_or("Sans titre")
                .to_string()
        } else {
            "Sans titre".into()
        };
    } else {
        r.title = r.title.trim().to_string();
    }
    Ok(r)
}

// --- Import des favoris navigateurs ---

#[tauri::command]
pub async fn detect_browser_profiles() -> Result<Vec<BrowserProfile>, String> {
    // lecture des fichiers de favoris — peuvent être volumineux, exécution bloquante
    tauri::async_runtime::spawn_blocking(|| {
        let mut profiles = Vec::new();
        // Brave en premier : navigateur principal sur Windows
        profiles.extend(read_chromium("brave"));
        profiles.extend(read_chromium("chrome"));
        profiles.extend(read_chromium("edge"));
        profiles.extend(read_firefox());
        Ok::<Vec<BrowserProfile>, String>(profiles)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub bookmarks: Vec<ImportedBookmark>,
    #[serde(default)]
    pub default_category: String,
    #[serde(default)]
    pub default_tags: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub added: usize,
    pub duplicates: usize,
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn import_bookmarks(
    pool: State<'_, SqlitePool>,
    request: ImportRequest,
) -> Result<ImportReport, String> {
    let mut report = ImportReport {
        added: 0,
        duplicates: 0,
        errors: Vec::new(),
    };
    for b in &request.bookmarks {
        if !b.selected {
            continue;
        }
        let mut tags = request.default_tags.clone();
        if !b.folder.is_empty() && !tags.contains(&b.folder) {
            // le dossier devient un tag pour rester cherchable
            tags.push(b.folder.clone());
        }
        let new = NewResource {
            url: b.url.clone(),
            title: b.title.clone(),
            description: String::new(),
            resource_type: "site".into(),
            category: request.default_category.clone(),
            tags,
            notes: String::new(),
            favicon: favicon_for(&b.url),
            favorite: false,
            meta: Default::default(),
            folder_id: None,
            status: None,
        };
        // même normalisation que les autres chemins d'ajout : le payload
        // vient du frontend, on ne lui fait pas confiance sur le schéma
        let new = match normalize_url(new) {
            Ok(n) => n,
            Err(e) => {
                report.errors.push(format!("{} : {e}", b.url));
                continue;
            }
        };
        match db::add_resource(&pool, &new).await {
            Ok(_) => report.added += 1,
            Err(e) => {
                if e.contains("déjà enregistrée") {
                    report.duplicates += 1;
                } else {
                    report.errors.push(format!("{} : {}", b.url, e));
                }
            }
        }
    }
    Ok(report)
}

/// Favicon via le service Google s2 (pas de CORS, pas de scraping).
pub(crate) fn favicon_for(url: &str) -> String {
    if url.starts_with("exe:") || url.starts_with("file:") {
        return String::new();
    }
    let host = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("");
    format!("https://www.google.com/s2/favicons?domain={host}&sz=64")
}

// --- Dossier de ressources, icônes images, exécutables ---

/// Racine du dossier de ressources visible par l'utilisateur :
/// Documents\Vaultly (repli : dossier de données de l'app).
pub fn resources_root_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    let base = directories::UserDirs::new()
        .and_then(|d| d.document_dir().map(|p| p.to_path_buf()))
        .or_else(|| app.path().app_data_dir().ok())
        .unwrap_or_else(std::env::temp_dir);
    base.join("Vaultly")
}

/// Crée le dossier de ressources s'il manque et l'ouvre dans l'Explorateur.
#[tauri::command]
pub async fn open_resources_folder(app: tauri::AppHandle) -> Result<String, String> {
    let dir = resources_root_dir(&app);
    std::fs::create_dir_all(dir.join("Fichiers")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir.join("Icones")).map_err(|e| e.to_string())?;
    let readme = dir.join("LISEZ-MOI.txt");
    if !readme.exists() {
        let _ = std::fs::write(
            &readme,
            "Vaultly - dossier de ressources

Fichiers/ : tes fichiers (documents, captures...) a cote de tes ressources
Icones/ : icones personnalisees des tuiles
",
        );
    }
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("ouverture impossible : {e}"))?;
    Ok(dir.display().to_string())
}

/// Lit une image et la renvoie en data URL (base64) pour l'affichage
/// immédiat dans la tuile ; stockée telle quelle dans `favicon`.
#[tauri::command]
pub async fn read_image_data_url(path: String) -> Result<String, String> {
    let p = std::path::PathBuf::from(&path);
    // taille contrôlée AVANT la lecture : un fichier de 2 Go ne doit pas
    // transiter par la mémoire pour être refusé ensuite.
    let len = tokio::fs::metadata(&p)
        .await
        .map_err(|e| e.to_string())?
        .len();
    if len > 4 * 1024 * 1024 {
        return Err("image trop volumineuse (max 4 Mo)".into());
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => return Err(format!("format d'image non pris en charge : .{ext}")),
    };
    let bytes = tokio::fs::read(&p).await.map_err(|e| e.to_string())?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// Lancement synchrone réutilisé par le serveur MCP.
pub fn launch_executable_sync(path: &str) -> Result<(), String> {
    let p = std::path::PathBuf::from(path);
    if !p.exists() {
        return Err(format!("fichier introuvable : {path}"));
    }
    let cwd = p
        .parent()
        .map(|d| d.to_path_buf())
        .unwrap_or_else(std::env::temp_dir);
    std::process::Command::new(&p)
        .current_dir(cwd)
        .spawn()
        .map_err(|e| format!("lancement impossible : {e}"))?;
    Ok(())
}

/// Lance un exécutable Windows (app sans URL web).
#[tauri::command]
pub async fn launch_executable(path: String) -> Result<(), String> {
    launch_executable_sync(&path)
}

/// Ouvre un fichier local avec l'application Windows par défaut.
#[tauri::command]
pub async fn open_file_path(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("fichier introuvable : {path}"));
    }
    tauri_plugin_opener::open_path(p.display().to_string(), None::<&str>)
        .map_err(|e| format!("ouverture impossible : {e}"))
}



// --- Statistiques ---

#[tauri::command]
pub async fn get_stats(pool: State<'_, SqlitePool>) -> Result<db::DbStats, String> {
    db::stats(&pool).await
}

// --- Dossiers (groupements de ressources sur l'interface) ---

#[tauri::command]
pub async fn list_folders(pool: State<'_, SqlitePool>) -> Result<Vec<db::Folder>, String> {
    db::list_folders(&pool).await
}

#[tauri::command]
pub async fn create_folder(
    pool: State<'_, SqlitePool>,
    name: String,
    icon: Option<String>,
    parent_id: Option<i64>,
) -> Result<db::Folder, String> {
    db::create_folder(&pool, &name, icon.as_deref().unwrap_or(""), parent_id).await
}

#[tauri::command]
pub async fn rename_folder(
    pool: State<'_, SqlitePool>,
    id: i64,
    name: String,
) -> Result<(), String> {
    db::rename_folder(&pool, id, &name).await
}

#[tauri::command]
pub async fn delete_folder(pool: State<'_, SqlitePool>, id: i64) -> Result<(), String> {
    db::delete_folder(&pool, id).await
}

/// Déplace un dossier dans un autre (parent_id = None → racine).
#[tauri::command]
pub async fn move_folder(
    pool: State<'_, SqlitePool>,
    folder_id: i64,
    parent_id: Option<i64>,
) -> Result<(), String> {
    db::move_folder(&pool, folder_id, parent_id).await
}

/// Dissout un dossier : libère ses ressources et remonte ses sous-dossiers.
#[tauri::command]
pub async fn dissolve_folder(pool: State<'_, SqlitePool>, id: i64) -> Result<(), String> {
    db::dissolve_folder(&pool, id).await
}

/// Change le statut de traitement d'une ressource ('' | 'todo' | 'archived').
#[tauri::command]
pub async fn set_resource_status(
    pool: State<'_, SqlitePool>,
    id: i64,
    status: String,
) -> Result<(), String> {
    db::set_resource_status(&pool, id, &status).await
}

// --- Détection de liens morts ---

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadLink {
    pub id: i64,
    pub url: String,
    pub title: String,
    pub reason: String,
}

/// Vérifie tous les liens web : GET avec timeout court. Sont considérés
/// morts : erreur réseau, timeout, HTTP 404/410 et 5xx. Les 401/403/405
/// (protection/anti-bot) comptent comme vivants. Version sans State,
/// partagée par la commande Tauri et l'outil MCP.
pub async fn run_dead_link_check(pool: &SqlitePool) -> Result<Vec<DeadLink>, String> {
    // vérification exhaustive : pas de garde-fou LIMIT.
    let resources = db::list_resources(
        pool,
        &ResourceFilter {
            no_limit: true,
            ..Default::default()
        },
    )
    .await?;
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Vaultly/0.1")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    // concurrence bornée : sans sémaphore, des milliers de sockets seraient
    // ouvertes en même temps sur une grosse bibliothèque.
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(32));
    let mut set = tokio::task::JoinSet::new();
    for r in resources.iter().filter(|r| r.url.starts_with("http")) {
        let client = client.clone();
        let url = r.url.clone();
        let title = r.title.clone();
        let id = r.id;
        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| e.to_string())?;
        set.spawn(async move {
            let _permit = permit; // tenu pendant la requête, libéré après
            match client.get(&url).send().await {
                Ok(resp) => {
                    let code = resp.status().as_u16();
                    if matches!(code, 404 | 410) || code >= 500 {
                        Some(DeadLink {
                            id,
                            url,
                            title,
                            reason: format!("HTTP {code}"),
                        })
                    } else {
                        None
                    }
                }
                Err(e) => Some(DeadLink {
                    id,
                    url,
                    title,
                    reason: if e.is_timeout() {
                        "délai dépassé".into()
                    } else {
                        "introuvable (erreur réseau)".into()
                    },
                }),
            }
        });
    }

    let mut out: Vec<DeadLink> = Vec::new();
    while let Some(res) = set.join_next().await {
        if let Ok(Some(d)) = res {
            out.push(d);
        }
    }
    out.sort_by_key(|d| d.id);
    Ok(out)
}

#[tauri::command]
pub async fn check_dead_links(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<DeadLink>, String> {
    run_dead_link_check(&pool).await
}

/// Range (folder_id = Some) ou sort (None) une ressource d'un dossier.
#[tauri::command]
pub async fn set_resource_folder(
    pool: State<'_, SqlitePool>,
    resource_id: i64,
    folder_id: Option<i64>,
) -> Result<(), String> {
    db::set_resource_folder(&pool, resource_id, folder_id).await
}


// --- Sauvegarde / restauration (export & import JSON) ---

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportData {
    pub resources: Vec<Resource>,
    pub folders: Vec<db::Folder>,
    pub version: String,
}

#[tauri::command]
pub async fn export_data(
    pool: State<'_, SqlitePool>,
    path: String,
) -> Result<usize, String> {
    // l'export doit rester exhaustif : pas de garde-fou LIMIT.
    let resources = db::list_resources(
        &pool,
        &ResourceFilter {
            no_limit: true,
            ..Default::default()
        },
    )
    .await?;
    let folders = db::list_folders(&pool).await?;
    let data = ExportData {
        resources,
        folders,
        version: env!("CARGO_PKG_VERSION").into(),
    };
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, json)
        .await
        .map_err(|e| e.to_string())?;
    Ok(data.resources.len())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPayload {
    #[serde(default)]
    pub resources: Vec<ResourceImport>,
    #[serde(default)]
    pub folders: Vec<FolderImport>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderImport {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub icon: String,
    /// parent exporté : la hiérarchie (imbrication) est restaurée
    #[serde(default)]
    pub parent_id: Option<i64>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceImport {
    #[serde(flatten)]
    pub resource: db::NewResource,
    /// stats exportées, restaurées quand la ressource est nouvelle
    #[serde(default)]
    pub open_count: Option<i64>,
    #[serde(default)]
    pub position: Option<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub resources_added: usize,
    pub duplicates: usize,
    pub folders_added: usize,
    /// ressources du JSON refusées par la normalisation (URL invalide,
    /// schéma inconnu…) — sautées sans avorter l'import
    pub invalid: usize,
}

#[tauri::command]
pub async fn import_data(
    pool: State<'_, SqlitePool>,
    path: String,
) -> Result<ImportSummary, String> {
    let text = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())?;
    import_payload_from_str(&pool, &text).await
}

/// Importe un payload JSON déjà lu en mémoire (fichier local ou backup Drive).
/// Le tout est enveloppé dans UNE transaction : en cas d'erreur à
/// mi-parcours, rien n'est persisté (rollback automatique à la sortie).
pub async fn import_payload_from_str(
    pool: &SqlitePool,
    text: &str,
) -> Result<ImportSummary, String> {
    let payload: ImportPayload = serde_json::from_str(text)
        .map_err(|e| format!("fichier invalide : {e}"))?;

    // La transaction est annulée automatiquement si on sort en erreur
    // avant `commit` (drop sans commit = rollback).
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let mut summary = ImportSummary {
        resources_added: 0,
        duplicates: 0,
        folders_added: 0,
        invalid: 0,
    };

    // Dossiers en deux passes pour restaurer la hiérarchie :
    // 1) tous les dossiers sont créés (match par nom sinon création),
    // 2) une fois tous les ids connus, les parent_id sont rejoués.
    // Sans ça, un dossier enfant arrivant avant son parent finissait à la racine.
    let mut id_map: std::collections::HashMap<i64, i64> = Default::default();
    for f in &payload.folders {
        let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM folders WHERE name = ?")
            .bind(&f.name)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        if let Some(existing) = exists {
            id_map.insert(f.id, existing);
        } else {
            // créé à la racine pour l'instant (passe 2 ci-dessous)
            let created = db::create_folder_tx(&mut tx, &f.name, &f.icon, None).await?;
            id_map.insert(f.id, created.id);
            summary.folders_added += 1;
        }
    }
    // passe 2 : rejouer l'imbrication (parent remappé via id_map)
    for f in &payload.folders {
        if let Some(want_parent) = f.parent_id {
            let new_parent = id_map.get(&want_parent).copied();
            if new_parent != id_map.get(&f.id).copied() {
                if let Some(fid) = id_map.get(&f.id) {
                    // le même contrôle anti-cycle que l'UI passe par move_folder,
                    // mais sans pool : version inline sur tx
                    if !would_create_cycle(&mut tx, *fid, new_parent).await? {
                        sqlx::query("UPDATE folders SET parent_id = ? WHERE id = ?")
                            .bind(new_parent)
                            .bind(fid)
                            .execute(&mut *tx)
                            .await
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
    }

    for r in payload.resources {
        let mut r = r;
        if let Some(fid) = r.resource.folder_id {
            r.resource.folder_id = id_map.get(&fid).copied();
        }
        // statut invalide dans un JSON forgé : replié sur actif plutôt que
        // de polluer le filtrage par statut
        if let Some(s) = &r.resource.status {
            if !matches!(s.as_str(), "" | "todo" | "archived") {
                r.resource.status = Some(String::new());
            }
        }
        // --- durcissement anti-JSON forgé (backup édité à la main) ---
        // exePath/filePath : réservés aux types qui les utilisent, avec
        // extensions exécutables connues pour exePath. Sans ce contrôle, une
        // sauvegarde malveillante transformerait n'importe quelle tuile en
        // lanceur de binaire (launch_executable ne filtre pas les extensions).
        if r.resource.resource_type != "app" {
            r.resource.meta.remove("exePath");
        } else if let Some(p) = r.resource.meta.get("exePath").cloned() {
            let ext = std::path::Path::new(&p)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !matches!(ext.as_str(), "exe" | "lnk" | "bat" | "cmd") {
                r.resource.meta.remove("exePath");
            }
        }
        if r.resource.resource_type != "fichier" {
            r.resource.meta.remove("filePath");
        }
        // Le champ URL porte le même risque que meta.exePath : normalize_url
        // accepte « exe: »/« file: » comme schémas INTERNES, donc un backup
        // forgé avec url « exe:C:\evil.exe » et type « site » contournerait le
        // contrôle ci-dessus (meta vidé mais url lanceuse intacte → openResource
        // branche exe: → launch_executable). Mêmes règles que pour meta.
        {
            let ul = r.resource.url.trim().to_lowercase();
            if let Some(rest) = ul.strip_prefix("exe:") {
                let ext = std::path::Path::new(rest.trim())
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_string();
                if r.resource.resource_type != "app"
                    || !matches!(ext.as_str(), "exe" | "lnk" | "bat" | "cmd")
                {
                    summary.invalid += 1;
                    continue;
                }
            } else if ul.starts_with("file:") && r.resource.resource_type != "fichier" {
                summary.invalid += 1;
                continue;
            }
        }
        // URL : même normalisation qu'à l'ajout (javascript:, data:, schémas
        // inconnus refusés). Une ressource invalide est sautée, pas fatale.
        r.resource = match normalize_url(r.resource) {
            Ok(n) => n,
            Err(_) => {
                summary.invalid += 1;
                continue;
            }
        };
        let created_id = match db::add_resource_tx(&mut tx, &r.resource).await {
            Ok(res) => res.id,
            Err(e) if e.contains("déjà enregistrée") => {
                summary.duplicates += 1;
                continue;
            }
            Err(e) => return Err(e),
        };
        summary.resources_added += 1;
        // les stats exportées sont restaurées (pas de perte à la re-import).
        // created_at : seulement si une vraie valeur est fournie — l'ancienne
        // version liait la CHAÎNE littérale « datetime(now) » (le trim_matches
        // neutralisait l'intention d'appeler la fonction SQL).
        if r.open_count.is_some() || r.position.is_some() || r.created_at.is_some() {
            match r.created_at.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                Some(created) => {
                    sqlx::query(
                        "UPDATE resources SET open_count = ?, position = ?, created_at = ? WHERE id = ?",
                    )
                    .bind(r.open_count.unwrap_or(0))
                    .bind(r.position.unwrap_or(0))
                    .bind(created)
                    .bind(created_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
                }
                None => {
                    sqlx::query("UPDATE resources SET open_count = ?, position = ? WHERE id = ?")
                        .bind(r.open_count.unwrap_or(0))
                        .bind(r.position.unwrap_or(0))
                        .bind(created_id)
                        .execute(&mut *tx)
                        .await
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(summary)
}

/// Cycle si `folder` (ou l'un de ses ancêtres) est le parent proposé.
async fn would_create_cycle(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    folder_id: i64,
    new_parent_id: Option<i64>,
) -> Result<bool, String> {
    let mut cur = new_parent_id;
    let mut guard = 0;
    while let Some(c) = cur {
        if c == folder_id {
            return Ok(true);
        }
        guard += 1;
        if guard > 100 {
            break; // sécurité anti-boucle infinie
        }
        cur = sqlx::query_scalar::<_, Option<i64>>("SELECT parent_id FROM folders WHERE id = ?")
            .bind(c)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|e| e.to_string())?
            .flatten();
    }
    Ok(false)
}

// --- Presse-papiers : l'URL copiée est-elle déjà connue ? ---

/// Normalisation légère pour la comparaison d'URLs : on ignore la casse du
/// schéma/domaine et un éventuel slash final (sinon « Exemple.com/ » passe
/// pour inconnu alors que « exemple.com » est en base).
fn comparable_url(url: &str) -> String {
    let trimmed = url.trim();
    let lowered = trimmed.to_lowercase();
    let no_slash = lowered.strip_suffix('/').unwrap_or(&lowered);
    no_slash.to_string()
}

#[tauri::command]
pub async fn is_url_known(pool: State<'_, SqlitePool>, url: String) -> Result<bool, String> {
    let needle = comparable_url(&url);
    let known: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM resources WHERE url = ? COLLATE NOCASE",
    )
    .bind(&needle)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| e.to_string())?;
    if known.is_some() {
        return Ok(true);
    }
    // repli : comparons aussi la version normalisée de chaque URL en base
    let all: Vec<String> = sqlx::query_scalar("SELECT url FROM resources WHERE url LIKE 'http%'")
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(all.iter().any(|u| comparable_url(u) == needle))
}

/// Change le raccourci global de la palette (persisté, pris au prochain
/// démarrage) — la re-registre immédiatement.
#[tauri::command]
pub async fn set_global_shortcut(
    app: tauri::AppHandle,
    pool: State<'_, SqlitePool>,
    shortcut: String,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let s = shortcut.trim().to_lowercase();
    if s.is_empty() {
        return Err("raccourci vide".into());
    }
    // enregistre le nouveau d'abord : si échec, l'ancien reste actif
    let old = db::get_setting(&pool, "global_shortcut")
        .await
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "ctrl+alt+space".into());
    if s == old {
        return Ok(());
    }
    app.global_shortcut()
        .register(s.as_str())
        .map_err(|e| format!("raccourci « {s} » indisponible : {e}"))?;
    app.global_shortcut().unregister(old.as_str()).ok();
    db::set_setting(&pool, "global_shortcut", &s).await
}

// --- Lancement au démarrage de Windows (contrôlé depuis Réglages) ---

#[tauri::command]
pub async fn set_autostart(
    app: tauri::AppHandle,
    pool: State<'_, SqlitePool>,
    enabled: bool,
) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    if enabled {
        al.enable().map_err(|e| format!("activation impossible : {e}"))?;
    } else {
        al.disable().map_err(|e| format!("désactivation impossible : {e}"))?;
    }
    // le flag « premier démarrage » reste à 1 : on ne réactivera jamais
    // automatiquement après un choix manuel.
    db::set_setting(&pool, "autostart_enabled", if enabled { "1" } else { "0" })
        .await
}

#[tauri::command]
pub async fn get_autostart(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("lecture impossible : {e}"))
}

// --- Google Drive (OAuth + upload) ---

#[tauri::command]
pub async fn gdrive_connect(
    pool: State<'_, SqlitePool>,
    slot: tauri::State<'_, crate::gdrive::GDriveSlot>,
) -> Result<(), String> {
    crate::gdrive::connect_flow(pool.inner().clone(), slot.0.clone()).await
}

#[tauri::command]
pub async fn gdrive_status(pool: State<'_, SqlitePool>) -> Result<crate::gdrive::TokenInfo, String> {
    Ok(crate::gdrive::status(&pool).await)
}

#[tauri::command]
pub async fn gdrive_disconnect(pool: State<'_, SqlitePool>) -> Result<(), String> {
    crate::gdrive::disconnect(&pool).await
}

/// Ouvre le sélecteur de fichier puis l'upload vers Drive.
/// Retourne le lien web du fichier partagé.
#[tauri::command]
pub async fn gdrive_upload(
    app: tauri::AppHandle,
    pool: State<'_, SqlitePool>,
    path: Option<String>,
) -> Result<String, String> {
    let path = match path {
        Some(p) => p,
        None => {
            // sélecteur natif côté Rust (dialog plugin, thread main requis)
            let app_for_dialog = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                use tauri_plugin_dialog::DialogExt;
                let (tx, rx) = std::sync::mpsc::channel();
                let app_inner = app_for_dialog.clone();
                let _ = app_for_dialog.run_on_main_thread(move || {
                    let picked = app_inner.dialog().file().blocking_pick_file();
                    let path = picked
                        .and_then(|f| f.into_path().ok())
                        .map(|p| p.display().to_string());
                    let _ = tx.send(path);
                });
                rx.recv().unwrap_or(None)
            })
            .await
            .map_err(|e| e.to_string())?
            .ok_or("aucun fichier sélectionné")?
        }
    };
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("fichier introuvable : {path}"));
    }
    let link = crate::gdrive::upload_file(&pool, &p).await?;
    Ok(link)
}

// --- Google Drive : explorateur, backup, restauration ---

#[tauri::command]
pub async fn gdrive_list_files(
    pool: State<'_, SqlitePool>,
    folder_id: Option<String>,
    query: Option<String>,
) -> Result<Vec<crate::gdrive::DriveFile>, String> {
    crate::gdrive::list_files(&pool, folder_id, query).await
}

#[tauri::command]
pub async fn gdrive_search_files(
    pool: State<'_, SqlitePool>,
    query: String,
) -> Result<Vec<crate::gdrive::DriveFile>, String> {
    crate::gdrive::search_files(&pool, query).await
}

#[tauri::command]
pub async fn gdrive_download(
    pool: State<'_, SqlitePool>,
    file_id: String,
) -> Result<String, String> {
    crate::gdrive::download_file(&pool, &file_id).await
}

#[tauri::command]
pub async fn gdrive_delete_file(
    pool: State<'_, SqlitePool>,
    file_id: String,
) -> Result<(), String> {
    crate::gdrive::delete_drive_file(&pool, &file_id).await
}

#[tauri::command]
pub async fn gdrive_create_folder(
    pool: State<'_, SqlitePool>,
    name: String,
) -> Result<String, String> {
    crate::gdrive::create_drive_folder(&pool, &name).await
}

#[tauri::command]
pub async fn gdrive_share_file(
    pool: State<'_, SqlitePool>,
    file_id: String,
) -> Result<String, String> {
    crate::gdrive::share_file(&pool, &file_id).await
}

#[tauri::command]
pub async fn gdrive_list_share_lists(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<crate::gdrive::ShareListInfo>, String> {
    crate::gdrive::list_share_lists(&pool).await
}

#[tauri::command]
pub async fn gdrive_append_link(
    pool: State<'_, SqlitePool>,
    file_id: Option<String>,
    name: Option<String>,
    title: String,
    url: String,
    added_at: String,
) -> Result<crate::gdrive::AppendLinkResult, String> {
    crate::gdrive::append_link(&pool, file_id, name, &title, &url, &added_at).await
}

#[tauri::command]
pub async fn gdrive_backup(
    pool: State<'_, SqlitePool>,
) -> Result<crate::gdrive::BackupResult, String> {
    crate::gdrive::backup_to_drive(&pool).await
}

#[tauri::command]
pub async fn gdrive_restore(
    pool: State<'_, SqlitePool>,
    file_id: Option<String>,
) -> Result<ImportSummary, String> {
    crate::gdrive::restore_from_drive(&pool, file_id).await
}

#[tauri::command]
pub async fn gdrive_set_backup_folder(
    pool: State<'_, SqlitePool>,
    folder_id: Option<String>,
) -> Result<(), String> {
    match folder_id.filter(|s| !s.is_empty()) {
        Some(id) => db::set_setting(&pool, "gdrive_backup_folder_id", &id).await,
        None => {
            sqlx::query("DELETE FROM settings WHERE key = ?")
                .bind("gdrive_backup_folder_id")
                .execute(&*pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn gdrive_set_autobackup(
    pool: State<'_, SqlitePool>,
    enabled: bool,
    interval_hours: u64,
) -> Result<(), String> {
    if interval_hours == 0 {
        return Err("l'intervalle doit être d'au moins 1 heure".into());
    }
    db::set_setting(&pool, "gdrive_autobackup_enabled", if enabled { "1" } else { "0" }).await?;
    db::set_setting(
        &pool,
        "gdrive_autobackup_interval_hours",
        &interval_hours.to_string(),
    )
    .await
}

#[tauri::command]
pub async fn gdrive_get_settings(
    pool: State<'_, SqlitePool>,
) -> Result<crate::gdrive::DriveSettings, String> {
    Ok(crate::gdrive::get_drive_settings(&pool).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap()
    }

    async fn import(pool: &SqlitePool, json: &str) -> ImportSummary {
        db::migrate(pool).await.unwrap();
        import_payload_from_str(pool, json).await.unwrap()
    }

    fn nr(url: &str, title: &str) -> NewResource {
        NewResource {
            url: url.into(),
            title: title.into(),
            description: String::new(),
            resource_type: "site".into(),
            category: String::new(),
            tags: vec![],
            notes: String::new(),
            favicon: String::new(),
            favorite: false,
            meta: Default::default(),
            folder_id: None,
            status: None,
        }
    }

    #[tokio::test]
    async fn forged_backup_cannot_plant_exe_launcher_on_a_site_tile() {
        let pool = test_pool().await;
        // url « exe: » + type « site » : le meta est vide, donc seul le
        // contrôle de l'URL peut attraper ce contournement
        let json = serde_json::json!({
            "resources": [{ "url": "exe:C:\\\\evil\\\\payload.exe", "title": "Faux site", "resourceType": "site" }],
            "folders": []
        });
        let s = import(&pool, &json.to_string()).await;
        assert_eq!(s.resources_added, 0, "la tuile lanceuse doit être refusée");
        assert_eq!(s.invalid, 1);
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM resources")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 0);
    }

    #[tokio::test]
    async fn forged_backup_cannot_plant_file_url_on_a_site_tile() {
        let pool = test_pool().await;
        let json = serde_json::json!({
            "resources": [{ "url": "file:C:\\\\evil\\\\x.bat", "title": "Faux site", "resourceType": "site" }],
            "folders": []
        });
        let s = import(&pool, &json.to_string()).await;
        assert_eq!(s.invalid, 1, "file: réservé au type fichier");
    }

    #[tokio::test]
    async fn legitimate_app_backup_still_restores() {
        let pool = test_pool().await;
        let json = serde_json::json!({
            "resources": [{ "url": "exe:C:\\\\Program Files\\\\App\\\\app.exe", "title": "Mon App", "resourceType": "app" }],
            "folders": []
        });
        let s = import(&pool, &json.to_string()).await;
        assert_eq!(s.resources_added, 1, "un vrai backup d'app doit passer");
    }

    #[tokio::test]
    async fn javascript_url_is_rejected() {
        let pool = test_pool().await;
        let json = serde_json::json!({
            "resources": [{ "url": "javascript:alert(1)", "title": "x", "resourceType": "site" }],
            "folders": []
        });
        let s = import(&pool, &json.to_string()).await;
        assert_eq!(s.invalid, 1);
    }

    #[test]
    fn canonicalize_dedupes_tracking_variants() {
        // www., schéma en casse, slash final et paramètres de tracking ne
        // doivent plus créer de doublons
        assert_eq!(canonicalize_url("HTTPS://WWW.Example.com/"), "https://example.com");
        assert_eq!(
            canonicalize_url("https://example.com/?utm_source=nl&utm_campaign=x"),
            "https://example.com"
        );
        assert_eq!(canonicalize_url("https://example.com/a?b=1&gclid=z"), "https://example.com/a?b=1");
        // garde : le chemin est sensible à la casse
        assert_eq!(canonicalize_url("https://github.com/Owner/Repo"), "https://github.com/Owner/Repo");
        // schémas internes intouchés (app, fichier, note)
        assert_eq!(canonicalize_url("exe:C:\\x\\app.exe"), "exe:C:\\x\\app.exe");
        assert_eq!(canonicalize_url("local:deadbeef"), "local:deadbeef");
    }

    #[tokio::test]
    async fn add_resource_dedupes_canonical_variants() {
        let pool = test_pool().await;
        db::migrate(&pool).await.unwrap();
        let r1 = normalize_url(nr("https://www.example.com/", "Example")).unwrap();
        db::add_resource(&pool, &r1).await.unwrap();
        // la variante « brute » doit être refusée par l'UNIQUE canonique
        let r2 = normalize_url(nr("https://example.com", "Example 2")).unwrap();
        let dup = db::add_resource(&pool, &r2).await;
        assert!(dup.is_err(), "la variante canonique fait doublon");
        // et le chemin stocké est bien canonique
        let stored: String = sqlx::query_scalar("SELECT url FROM resources LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(stored, "https://example.com");
    }

    #[tokio::test]
    async fn delete_goes_to_trash_and_restores() {
        let pool = test_pool().await;
        db::migrate(&pool).await.unwrap();
        let r = normalize_url(nr("https://a.com", "A")).unwrap();
        let created = db::add_resource(&pool, &r).await.unwrap();
        db::delete_resource(&pool, created.id).await.unwrap();
        // la ressource n'est plus dans resources mais est dans la corbeille
        assert_eq!(
            db::list_resources(&pool, &ResourceFilter { no_limit: true, ..Default::default() })
                .await
                .unwrap()
                .len(),
            0
        );
        let trash = db::list_trash(&pool).await.unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].resource.title, "A");
        // restauration : remet la ressource en circulation et vide sa ligne
        let restored = db::restore_trash(&pool, trash[0].trash_id).await.unwrap();
        assert_eq!(restored.title, "A");
        assert!(db::list_trash(&pool).await.unwrap().is_empty());
        assert_eq!(
            db::list_resources(&pool, &ResourceFilter { no_limit: true, ..Default::default() })
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn trash_expired_purge() {
        let pool = test_pool().await;
        db::migrate(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO deleted_resources (resource, deleted_at) VALUES (?, datetime('now', '-31 days'))",
        )
        .bind("{}")
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO deleted_resources (resource, deleted_at) VALUES (?, datetime('now'))",
        )
        .bind("{}")
        .execute(&pool)
        .await
        .unwrap();
        let n = db::purge_expired_trash(&pool, 30).await.unwrap();
        assert_eq!(n, 1, "seule l'entrée de plus de 30 jours est purgée");
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM deleted_resources")
            .fetch_one(&pool).await.unwrap(), 1);
    }
}
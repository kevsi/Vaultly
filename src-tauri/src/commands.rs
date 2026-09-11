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
    let created = db::add_resource(&pool, &resource).await?;
    // préchauffe la capture mshots : le premier affichage la génère côté
    // WordPress (10-30 s), les suivants sont instantanés
    let url = created.url.clone();
    tauri::async_runtime::spawn(async move {
        warm_screenshot(&url).await;
    });
    Ok(created)
}

/// Préchauffe la capture mshots d'une URL (tuiles « captures »).
/// Best-effort en tâche de fond : résultat ignoré, jamais d'erreur visible.
async fn warm_screenshot(url: &str) {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return;
    }
    let encoded: String =
        percent_encoding::utf8_percent_encode(url, percent_encoding::NON_ALPHANUMERIC)
            .collect();
    let shot = format!("https://s.wordpress.com/mshots/v1/{encoded}?w=400");
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Vaultly/0.2")
        .timeout(std::time::Duration::from_secs(25))
        .build();
    if let Ok(client) = client {
        // lire jusqu'au bout : la génération doit finir côté serveur
        if let Ok(resp) = client.get(&shot).send().await {
            let _ = resp.bytes().await;
        }
    }
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

/// Renomme un tag partout (fusion si le nouveau nom existe déjà).
#[tauri::command]
pub async fn rename_tag(
    pool: State<'_, SqlitePool>,
    old: String,
    new: String,
) -> Result<usize, String> {
    db::rename_tag(&pool, &old, &new).await
}

/// Supprime un tag de toutes les ressources.
#[tauri::command]
pub async fn remove_tag(pool: State<'_, SqlitePool>, tag: String) -> Result<usize, String> {
    db::remove_tag(&pool, &tag).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub name: String,
    pub count: i64,
}

/// Tags + compteurs pour le gestionnaire de tags.
#[tauri::command]
pub async fn tag_stats(pool: State<'_, SqlitePool>) -> Result<Vec<TagCount>, String> {
    Ok(db::tag_stats(&pool)
        .await?
        .into_iter()
        .map(|(name, count)| TagCount { name, count })
        .collect())
}


#[tauri::command]
pub async fn fetch_metadata(url: String) -> Result<crate::metadata::PageMetadata, String> {
    crate::metadata::fetch(&url).await
}

/// Smart Clip : devine le type et extrait les méta riches (titre, description,
/// image, tags) d'une URL pour pré-remplir la modale d'ajout.
#[tauri::command]
pub async fn sniff_resource(url: String) -> Result<crate::metadata::Sniff, String> {
    crate::metadata::sniff(&url).await
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

/// Fusionne tags par défaut + tags propres à la ligne (import CSV) +
/// dossier — sans doublon, ordre stable (défauts, ligne, dossier).
fn merge_import_tags(
    default_tags: &[String],
    row_tags: &[String],
    folder: &str,
) -> Vec<String> {
    let mut tags: Vec<String> = default_tags.to_vec();
    for t in row_tags {
        if !t.is_empty() && !tags.contains(t) {
            tags.push(t.clone());
        }
    }
    if !folder.is_empty() && !tags.iter().any(|t| t == folder) {
        // le dossier devient un tag pour rester cherchable
        tags.push(folder.to_string());
    }
    tags
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
        let tags = merge_import_tags(&request.default_tags, &b.tags, &b.folder);
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
/// Le host est percent-encodé : une URL contenant « & » ou « # » produisait
/// une requête tronquée/équipée de paramètres parasites.
pub(crate) fn favicon_for(url: &str) -> String {
    if url.starts_with("exe:") || url.starts_with("file:") || url.starts_with("local:") {
        return String::new();
    }
    let host = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("");
    // encodage strict (composant d'URL) : tout ce qui n'est pas un caractère
    // d'hôte sûr est échappé
    let safe: String = host
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    if safe.is_empty() {
        return String::new();
    }
    format!("https://www.google.com/s2/favicons?domain={safe}&sz=64")
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
pub async fn read_image_data_url(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, String> {
    // restriction au dossier de ressources : la webview ne doit pas pouvoir
    // lire un fichier quelconque du disque (renommé .png = exfiltration de
    // 4 Mo en base64 vers l'UI).
    let root = resources_root_dir(&app);
    let p = std::path::PathBuf::from(&path);
    let root_c = root.canonicalize().unwrap_or(root);
    let allowed = p.canonicalize().map(|c| c.starts_with(&root_c)).unwrap_or(false);
    if !allowed {
        return Err("l'image doit se trouver dans le dossier de ressources (Documents\\Vaultly)".into());
    }
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

/// Extensions qu'une ressource « app » a le droit de lancer. Même liste
/// que la garde d'import : un .hta/.ps1/.js ouvert via son handler par
/// défaut = exécution de code arbitraire, il ne doit jamais passer.
const LAUNCHABLE_EXTS: &[&str] = &["exe", "lnk", "bat", "cmd"];

fn launchable_ext(p: &std::path::Path) -> Option<String> {
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if LAUNCHABLE_EXTS.contains(&ext.as_str()) {
        Some(ext)
    } else {
        None
    }
}

/// Lancement synchrone réutilisé par le serveur MCP.
pub fn launch_executable_sync(path: &str) -> Result<(), String> {
    let p = std::path::PathBuf::from(path);
    // liste blanche d'extensions : sans elle, la webview (ou un client MCP
    // compromis) peut lancer N'IMPORTE quel fichier via son handler Windows
    // (.hta, .ps1, .js… = exécution arbitraire, pas seulement des exécutables).
    if launchable_ext(&p).is_none() {
        return Err(format!(
            "type de fichier non lançable : .{} (autorisés : exe, lnk, bat, cmd)",
            p.extension().and_then(|e| e.to_str()).unwrap_or("?")
        ));
    }
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

// --- Applications d'ouverture (navigateur + éditeur de notes externes) ---

/// Une application détectée proposable comme navigateur ou éditeur de notes.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenerApp {
    /// identifiant stable ("brave")
    pub id: String,
    /// nom d'affichage ("Brave")
    pub name: String,
    /// chemin complet de l'exécutable
    pub path: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Openers {
    pub browsers: Vec<OpenerApp>,
    pub note_apps: Vec<OpenerApp>,
}

/// Binaires qu'on ne lancera JAMAIS comme navigateur/notes, même configurés
/// à la main : avec un URL/chemin en unique argument positionnel, un shell
/// ou un interpréteur reste un pivot d'exécution de code.
const DENIED_BINARIES: &[&str] = &[
    "cmd", "powershell", "pwsh", "wscript", "cscript", "mshta", "rundll32",
    "regsvr32", "wt", "bash", "sh", "python", "pythonw", "perl", "ruby",
    "node", "wmic",
];

/// Valide un binaire configuré : existe, .exe, pas un shell/interpréteur.
/// Vérifié à l'enregistrement ET à chaque ouverture (la base peut être
/// éditée hors de l'app).
fn validate_opener_binary(path: &str) -> Result<std::path::PathBuf, String> {
    let p = std::path::PathBuf::from(path.trim());
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext != "exe" {
        return Err("seul un fichier .exe peut être configuré".into());
    }
    let stem = p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if DENIED_BINARIES.contains(&stem.as_str()) {
        return Err(format!(
            "{stem}.exe ne peut pas servir d'application d'ouverture"
        ));
    }
    if !p.is_file() {
        return Err(format!("fichier introuvable : {path}"));
    }
    Ok(p)
}

/// Premier chemin existant (fichier) parmi les candidats, si présent.
fn first_existing(candidates: &[std::path::PathBuf]) -> Option<String> {
    candidates
        .iter()
        .find(|p| p.is_file())
        .map(|p| p.display().to_string())
}

/// Chemins d'installation connus : Program Files, x86 et profil local.
fn program_bases() -> Vec<std::path::PathBuf> {
    let mut bases = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(var) {
            bases.push(std::path::PathBuf::from(base));
        }
    }
    bases
}

fn detect_browsers() -> Vec<OpenerApp> {
    // (id, nom, chemins relatifs aux bases ci-dessus)
    const KNOWN: &[(&str, &str, &[&str])] = &[
        ("brave", "Brave", &["BraveSoftware\\Brave-Browser\\Application\\brave.exe"]),
        (
            "chrome",
            "Google Chrome",
            &["Google\\Chrome\\Application\\chrome.exe"],
        ),
        (
            "edge",
            "Microsoft Edge",
            &["Microsoft\\Edge\\Application\\msedge.exe"],
        ),
        (
            "firefox",
            "Firefox",
            &["Mozilla Firefox\\firefox.exe"],
        ),
        (
            "opera",
            "Opera",
            &[
                "Opera\\opera.exe",
                "Programs\\Opera\\opera.exe",
            ],
        ),
        (
            "vivaldi",
            "Vivaldi",
            &["Vivaldi\\Application\\vivaldi.exe"],
        ),
    ];
    // Chrome existe aussi en installation par utilisateur (LOCALAPPDATA)
    let mut out = Vec::new();
    for (id, name, rels) in KNOWN {
        let mut cands = Vec::new();
        for base in program_bases() {
            for rel in *rels {
                cands.push(base.join(rel));
            }
        }
        // cas particulier : Chrome per-user sous LOCALAPPDATA
        if *id == "chrome" {
            if let Ok(local) = std::env::var("LOCALAPPDATA") {
                cands.push(
                    std::path::PathBuf::from(local)
                        .join("Google\\Chrome\\Application\\chrome.exe"),
                );
            }
        }
        if let Some(path) = first_existing(&cands) {
            out.push(OpenerApp {
                id: id.to_string(),
                name: name.to_string(),
                path,
            });
        }
    }
    out
}

fn detect_note_apps() -> Vec<OpenerApp> {
    let mut out = Vec::new();
    // Bloc-notes Windows (toujours présent)
    if let Ok(system_root) = std::env::var("SystemRoot") {
        let p = std::path::PathBuf::from(system_root).join("System32\\notepad.exe");
        if p.is_file() {
            out.push(OpenerApp {
                id: "notepad".into(),
                name: "Bloc-notes".into(),
                path: p.display().to_string(),
            });
        }
    }
    const KNOWN: &[(&str, &str, &[&str])] = &[
        (
            "notepad++",
            "Notepad++",
            &["Notepad++\\notepad++.exe"],
        ),
        (
            "vscode",
            "Visual Studio Code",
            &[
                "Microsoft VS Code\\Code.exe",
                "Programs\\Microsoft VS Code\\Code.exe",
            ],
        ),
        ("obsidian", "Obsidian", &["Obsidian\\Obsidian.exe"]),
        ("vscodium", "VSCodium", &["VSCodium\\VSCodium.exe"]),
    ];
    for (id, name, rels) in KNOWN {
        let cands: Vec<std::path::PathBuf> = program_bases()
            .iter()
            .flat_map(|b| rels.iter().map(|r| b.join(r)))
            .collect();
        if let Some(path) = first_existing(&cands) {
            out.push(OpenerApp {
                id: id.to_string(),
                name: name.to_string(),
                path,
            });
        }
    }
    out
}

#[tauri::command]
pub async fn detect_openers() -> Result<Openers, String> {
    Ok(Openers {
        browsers: detect_browsers(),
        note_apps: detect_note_apps(),
    })
}

/// Préférences d'ouverture : chemins vides = défauts (navigateur Windows,
/// lecteur de notes intégré).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPrefs {
    pub browser_path: String,
    pub note_app_path: String,
}

#[tauri::command]
pub async fn get_open_prefs(pool: State<'_, SqlitePool>) -> Result<OpenPrefs, String> {
    Ok(OpenPrefs {
        browser_path: db::get_setting(&pool, "open_browser_path")
            .await
            .unwrap_or_default(),
        note_app_path: db::get_setting(&pool, "note_app_path")
            .await
            .unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn set_open_prefs(
    pool: State<'_, SqlitePool>,
    browser_path: String,
    note_app_path: String,
) -> Result<(), String> {
    let browser_path = browser_path.trim().to_string();
    let note_app_path = note_app_path.trim().to_string();
    if !browser_path.is_empty() {
        validate_opener_binary(&browser_path)?;
    }
    if !note_app_path.is_empty() {
        validate_opener_binary(&note_app_path)?;
    }
    db::set_setting(&pool, "open_browser_path", &browser_path).await?;
    db::set_setting(&pool, "note_app_path", &note_app_path).await?;
    Ok(())
}

/// Nom de fichier sûr pour l'export d'une note : `12_mon-titre.html`.
fn safe_note_filename(id: i64, title: &str) -> String {
    let slug: String = title
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c
            } else if c == ' ' || c == '-' || c == '_' {
                '-'
            } else {
                '\0'
            }
        })
        .filter(|c| *c != '\0')
        .collect();
    let slug = slug.trim_matches('-').chars().take(60).collect::<String>();
    if slug.is_empty() {
        format!("{id}_note.html")
    } else {
        format!("{id}_{slug}.html")
    }
}

/// Ouvre une ressource ENTIÈREMENT côté Rust, d'après la base : la webview ne
/// donne qu'un id, jamais un chemin ni une URL. C'est le verrou des anciennes
/// commandes launch_executable/open_file_path qui acceptaient un chemin
/// arbitraire (pivot OS pour une webview compromise). La précédence est la
/// même que l'ancien openResource.ts : exePath → filePath → url exe:/file: →
/// local: → URL web. Deux réglages peuvent dérouter l'ouverture : un
/// navigateur par défaut (liens http) et une application de notes externe
/// (export HTML vers Documents\Vaultly\Notes puis lancement).
#[tauri::command]
pub async fn open_resource(pool: State<'_, SqlitePool>, resource_id: i64) -> Result<(), String> {
    let r = db::get_resource(&pool, resource_id).await?;
    let lower = r.url.to_lowercase();

    // note + application externe configurée : export HTML vers
    // Documents\Vaultly\Notes puis lancement. Les modifications faites
    // dehors ne reviennent PAS dans Vaultly (dit dans les réglages).
    // Sans app configurée : rien (le lecteur intégré gère l'UI).
    if r.resource_type == "note" {
        let pref = db::get_setting(&pool, "note_app_path")
            .await
            .unwrap_or_default();
        if pref.trim().is_empty() {
            return Ok(());
        }
        let exe = validate_opener_binary(pref.trim())?;
        let notes_dir = directories::UserDirs::new()
            .and_then(|d| {
                d.document_dir()
                    .map(|p| p.to_path_buf().join("Vaultly").join("Notes"))
            })
            .unwrap_or_else(std::env::temp_dir);
        std::fs::create_dir_all(&notes_dir).map_err(|e| e.to_string())?;
        let path = notes_dir.join(safe_note_filename(r.id, &r.title));
        let content = format!(
            "<!-- Exporté depuis Vaultly — les modifications de ce fichier ne reviennent pas dans Vaultly. -->\n{}",
            r.notes
        );
        tokio::fs::write(&path, content.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        std::process::Command::new(&exe)
            .arg(&path)
            .spawn()
            .map_err(|e| format!("ouverture impossible : {e}"))?;
        db::record_open(&pool, resource_id).await?;
        return Ok(());
    }

    let opened = if r.resource_type == "app" {
        if let Some(exe) = r.meta.get("exePath").filter(|s| !s.is_empty()) {
            launch_executable_sync(exe)?;
            true
        } else if let Some(path) = lower.strip_prefix("exe:") {
            launch_executable_sync(path.trim())?;
            true
        } else {
            false
        }
    } else {
        // exe: hors type app ne doit pas être retourné en lanceur (même
        // garde que normalize_url : défense si une ancienne ligne traîne)
        if lower.starts_with("exe:") {
            return Err("seule une ressource de type « app » peut lancer un exécutable".into());
        }
        false
    };

    let opened = if opened {
        opened
    } else if let Some(file) = r.meta.get("filePath").filter(|s| !s.is_empty()) {
        tauri_plugin_opener::open_path(file, None::<&str>)
            .map_err(|e| format!("ouverture impossible : {e}"))?;
        true
    } else if let Some(path) = lower.strip_prefix("file:") {
        tauri_plugin_opener::open_path(path.trim(), None::<&str>)
            .map_err(|e| format!("ouverture impossible : {e}"))?;
        true
    } else if lower.starts_with("local:") {
        // sans lien : rien à ouvrir, rien à compter
        false
    } else if lower.starts_with("http://") || lower.starts_with("https://") {
        // navigateur par défaut configuré ? sinon handler Windows.
        // Garde inchangée : seul un schéma web atteint open_url / l'exe.
        let pref = db::get_setting(&pool, "open_browser_path")
            .await
            .unwrap_or_default();
        if pref.trim().is_empty() {
            // garde de défense en profondeur : seul un schéma web atteint open_url
            tauri_plugin_opener::open_url(&r.url, None::<&str>)
                .map_err(|e| format!("ouverture impossible : {e}"))?;
        } else {
            let exe = validate_opener_binary(pref.trim())?;
            std::process::Command::new(&exe)
                .arg(&r.url)
                .spawn()
                .map_err(|e| format!("ouverture impossible : {e}"))?;
        }
        true
    } else {
        return Err(format!("schéma de lien non pris en charge : {}", r.url));
    };

    // compté seulement si l'ouverture a réussi (comportement openResource.ts)
    if opened {
        db::record_open(&pool, resource_id).await?;
    }
    Ok(())
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
pub async fn delete_folder(pool: State<'_, SqlitePool>, id: i64) -> Result<usize, String> {
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

// --- Rappels (« me rappeler le… ») ---

/// Pose (None = efface) un rappel sur une ressource.
#[tauri::command]
pub async fn set_remind_at(
    pool: State<'_, SqlitePool>,
    id: i64,
    remind_at: Option<String>,
) -> Result<(), String> {
    db::set_remind_at(&pool, id, remind_at).await
}

/// Rappels échus (non archivés) pour le contrôle au lancement.
#[tauri::command]
pub async fn due_reminders(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<db::Resource>, String> {
    db::due_reminders(&pool, 10).await
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
    // single-flight : la vérification ouvre des centaines de sockets ; deux
    // appels concurrents (UI + client MCP) se télescoperaient. Un seul à la
    // fois, relâché au retour (le garde fait le cleanup même sur `?`).
    static DEADLINK_BUSY: std::sync::atomic::AtomicBool =
        std::sync::atomic::AtomicBool::new(false);
    struct BusyGuard;
    impl Drop for BusyGuard {
        fn drop(&mut self) {
            DEADLINK_BUSY.store(false, std::sync::atomic::Ordering::SeqCst);
        }
    }
    if DEADLINK_BUSY
        .compare_exchange(false, true, std::sync::atomic::Ordering::SeqCst, std::sync::atomic::Ordering::SeqCst)
        .is_err()
    {
        return Err("une vérification des liens est déjà en cours".into());
    }
    let _busy = BusyGuard;

    // vérification exhaustive : pas de garde-fou LIMIT.
    let resources = db::list_resources(
        pool,
        &ResourceFilter {
            no_limit: true,
            ..Default::default()
        },
    )
    .await?;
    let client = crate::metadata::guarded_web_client();

    // concurrence bornée : sans sémaphore, des milliers de sockets seraient
    // ouvertes en même temps sur une grosse bibliothèque.
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(32));
    let mut set = tokio::task::JoinSet::new();
    for r in resources
        .iter()
        .filter(|r| r.url.starts_with("http") && crate::metadata::host_is_public(&r.url))
    {
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
pub async fn export_data(pool: State<'_, SqlitePool>, path: String) -> Result<usize, String> {
    // l'export ne doit pas écraser un fichier arbitraire (config d'une autre
    // app, script de démarrage…) : extension .json exigée.
    let p = std::path::PathBuf::from(path.trim());
    if p.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() != Some("json") {
        return Err("l'export doit être un fichier .json".into());
    }
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
    tokio::fs::write(&p, json)
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
pub async fn import_data(pool: State<'_, SqlitePool>, path: String) -> Result<ImportSummary, String> {
    // lecture limitée aux .json : import_data ne renvoie que des compteurs,
    // mais ne pas restreindre laisse la webview sonder l'existence/lisibilité
    // de n'importe quel fichier du disque (erreur « illisible » vs « introuvable »).
    let p = std::path::PathBuf::from(path.trim());
    if p.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() != Some("json") {
        return Err("l'import attend un fichier .json".into());
    }
    let text = tokio::fs::read_to_string(&p)
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

#[tauri::command]
pub async fn is_url_known(pool: State<'_, SqlitePool>, url: String) -> Result<bool, String> {
    // le stockage est canonique (canonicalize_url à l'écriture) : la
    // comparaison canonique ciblée remplace l'ancien scan LIKE de toute la
    // table à chaque copie dans le presse-papiers (O(n) par requête).
    let needle = canonicalize_url(&url);
    let known: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM resources WHERE url = ? COLLATE NOCASE",
    )
    .bind(&needle)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(known.is_some())
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

// --- Migration Google Drive → WebDAV (une fois) ---

/// Drive a été retiré de l'app (l'OAuth Google exige une console développeur
/// par utilisateur, hors de portée du grand public) : la boucle de démarrage
/// purge les anciennes traces pour libérer le port 8790 et nettoyer la base.
pub(crate) async fn purge_legacy_gdrive(pool: &SqlitePool) {
    let legacy: Vec<String> = sqlx::query_scalar(
        "SELECT key FROM settings WHERE key LIKE 'gdrive_%'",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    if legacy.is_empty() {
        return;
    }
    sqlx::query("DELETE FROM settings WHERE key LIKE 'gdrive_%'")
        .execute(pool)
        .await
        .ok();
    tracing::info!(
        "migration Drive → WebDAV : {} clé(s) de réglages Drive purgée(s)",
        legacy.len()
    );
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
        // un rappel posé avant suppression doit survivre à la restauration
        db::set_remind_at(&pool, created.id, Some("2030-01-01 09:00:00".to_string()))
            .await
            .unwrap();
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
        assert_eq!(
            restored.remind_at.as_deref(),
            Some("2030-01-01 09:00:00"),
            "le rappel ne doit pas être perdu par le cycle corbeille"
        );
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

    #[test]
    fn validate_opener_binary_gates_shells_and_types() {
        // extensions non-exe refusées
        assert!(validate_opener_binary("C:\\x\\outil.bat").is_err());
        assert!(validate_opener_binary("C:\\x\\notes.txt").is_err());
        // shells et interpréteurs refusés même en .exe
        assert!(validate_opener_binary("C:\\Windows\\System32\\cmd.exe").is_err());
        assert!(validate_opener_binary(
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
        )
        .is_err());
        // inexistant refusé
        assert!(validate_opener_binary("C:\\n\\existe\\pas.exe").is_err());
        // un vrai .exe passe
        let p = std::env::temp_dir().join("vaultly-test-tool.exe");
        std::fs::write(&p, b"fake").unwrap();
        assert!(validate_opener_binary(p.to_str().unwrap()).is_ok());
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn safe_note_filename_slugs_titles() {
        assert_eq!(
            safe_note_filename(7, "Mes idées géniales !"),
            "7_mes-idées-géniales.html"
        );
        assert_eq!(safe_note_filename(7, "!!!"), "7_note.html");
        assert_eq!(safe_note_filename(7, ""), "7_note.html");
    }

    #[test]
    fn merge_import_tags_dedupes_and_orders() {
        let s = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        // défauts, puis ligne, puis dossier ; doublons éliminés
        assert_eq!(
            merge_import_tags(&s(&["import"]), &s(&["lecture", "import"]), "Dev"),
            vec!["import", "lecture", "Dev"],
        );
        assert!(merge_import_tags(&[], &[], "").is_empty());
        assert_eq!(merge_import_tags(&[], &[], "D"), vec!["D"]);
    }
}
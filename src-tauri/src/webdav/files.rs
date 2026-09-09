//! Explorateur « cloud » : envoi d'un fichier local vers fichiers/, liste,
//! recherche, téléchargement vers le temporaire (les fonctions que l'ancien
//! module Google Drive offrait, sans OAuth).

use super::{core, decode_segment, encode_segment, valid_segment, WebDavConfig};
use crate::webdav;
use serde::Serialize;
use sqlx::SqlitePool;

/// Sous-dossier réservé aux fichiers envoyés depuis la bibliothèque.
pub const FILES_DIR: &str = "fichiers/";
/// Garde-fou mémoire : un upload depuis l'app reste un usage de documents.
const MAX_UPLOAD_BYTES: u64 = 4 * 1024 * 1024;
/// Plafond de téléchargement (comme l'ancien Drive).
const MAX_DOWNLOAD_BYTES: u64 = 500 * 1024 * 1024;

/// Un fichier vu par l'explorateur.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudFile {
    /// segment unique du nom (l'« id » WebDAV — jamais un chemin)
    pub name: String,
    pub size: Option<u64>,
    pub modified: Option<String>,
}

/// Extrait les entrées fichiers d'un multistatus PROPFIND : (nom décodé,
/// taille, date). Les répertoires (href finissant par « / ») sont écartés ;
/// les balises portent des namespaces variables (`<d:>`, `<S:>`) — comparés
/// par nom nu (find_href_open les gère pour href ; ici on scanne la balise).
fn parse_propfind(xml: &str) -> Vec<(String, Option<u64>, Option<String>)> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = core::find_href_open(rest) {
        let after = &rest[start..];
        let Some(close_rel) = after.find("</") else {
            break;
        };
        let close = start + close_rel; // index absolu dans `rest`
        let href = rest[start..close].trim();
        let is_dir = href.ends_with('/');
        let name = decode_segment(href.rsplit('/').next().unwrap_or(""));
        // fin de cette <response> (namespace quelconque) : borne des props
        let end = find_response_close(rest, close)
            .map(|c| c + 1)
            .unwrap_or(rest.len());
        let block = &rest[..end];
        let size = find_prop(block, "getcontentlength").and_then(|v| v.parse().ok());
        let modified = find_prop(block, "getlastmodified");
        if !is_dir && !name.is_empty() {
            out.push((name, size, modified));
        }
        if end >= rest.len() {
            break;
        }
        rest = &rest[end..];
    }
    out
}

fn find_prop(block: &str, prop: &str) -> Option<String> {
    let mut i = 0;
    while let Some(rel) = block[i..].find('<') {
        let open = i + rel;
        let gt = block[open..].find('>')?;
        let tag = &block[open + 1..open + gt];
        let bare = tag
            .rsplit(':')
            .next()
            .unwrap_or("")
            .split_whitespace()
            .next()
            .unwrap_or("");
        if !tag.starts_with('/') && !tag.ends_with('/') && bare == prop {
            let cs = open + gt + 1;
            let close = block[cs..].find("</")?;
            return Some(block[cs..cs + close].trim().to_string());
        }
        i = open + gt + 1;
    }
    None
}

/// Index absolu de la prochaine balise fermante « response » (tout namespace,
/// `</d:response>` comme `</S:response>`) à partir de `from`, ou None.
fn find_response_close(xml: &str, from: usize) -> Option<usize> {
    let mut i = from;
    while let Some(rel) = xml[i..].find("<") {
        let open = i + rel;
        let gt = xml[open..].find(">")?;
        let tag = &xml[open + 1..open + gt];
        let bare = tag.rsplit(':').next().unwrap_or("");
        if tag.starts_with('/') && bare.starts_with("response") {
            return Some(open);
        }
        i = open + gt + 1;
    }
    None
}

/// PROPFIND Depth:1 sur un sous-dossier du dossier configuré.
pub(crate) async fn propfind_dir(
    cfg: &WebDavConfig,
    subdir: &str,
) -> Result<Vec<(String, Option<u64>, Option<String>)>, String> {
    let url = format!("{}{}", cfg.base, subdir);
    let client = core::http_client();
    let propfind = reqwest::Method::from_bytes(b"PROPFIND")
        .map_err(|e| format!("méthode PROPFIND invalide : {e}"))?;
    let resp = core::retry2(|| {
        client
            .request(propfind.clone(), &url)
            .basic_auth(&cfg.user, Some(&cfg.password))
            .header("Depth", "1")
            .header("Content-Type", "application/xml")
            .body(core::PROPFIND_BODY)
    })
    .await?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("réponse illisible : {e}"))?;
    if !(status.is_success() || status.as_u16() == 207) {
        return Err(core::describe_status(status, &text));
    }
    Ok(parse_propfind(&text))
}

/// Copie un fichier local dans fichiers/ sous nom horodaté (deux homonymes
/// ne s'écrasent pas). Retourne le nom distant.
pub async fn upload_file(pool: &SqlitePool, path: &std::path::Path) -> Result<String, String> {
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("nom de fichier illisible")?;
    let clean: String = file_name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect();
    let clean = clean.trim();
    let remote = format!("{}-{}", core::backup_stamp(), clean);
    if clean.is_empty() || !valid_segment(&remote) {
        return Err("ce nom de fichier ne peut pas être envoyé".into());
    }
    let meta = tokio::fs::metadata(path)
        .await
        .map_err(|e| format!("lecture du fichier impossible : {e}"))?;
    if meta.len() > MAX_UPLOAD_BYTES {
        return Err("fichier trop volumineux pour l'envoi cloud (max 4 Mo)".into());
    }
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("lecture du fichier impossible : {e}"))?;
    webdav::store_object(pool, &format!("{FILES_DIR}{}", encode_segment(&remote)), &mime_from_ext(path), bytes)
        .await?;
    Ok(remote)
}

fn mime_from_ext(path: &std::path::Path) -> String {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "zip" => "application/zip",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        "txt" | "md" => "text/plain",
        "json" => "application/json",
        "html" => "text/html",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// Liste jusqu'à 100 fichiers de fichiers/, filtrés par sous-chaîne du nom.
pub async fn list_files(
    pool: &SqlitePool,
    query: Option<String>,
) -> Result<Vec<CloudFile>, String> {
    let cfg = webdav::load_config(pool)
        .await
        .ok_or("Cloud WebDAV non configuré (Réglages → Sauvegarde cloud)")?;
    let mut entries = match propfind_dir(&cfg, FILES_DIR).await {
        Ok(e) => e,
        // un dossier jamais créé = explorateur vide, pas une erreur bloquante
        Err(e) if e.contains("introuvable") || e.contains("404") => Vec::new(),
        Err(e) => return Err(e),
    };
    entries.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
    if let Some(q) = query.filter(|s| !s.trim().is_empty()) {
        let ql = q.trim().to_lowercase();
        entries.retain(|(name, _, _)| name.to_lowercase().contains(&ql));
    }
    Ok(entries
        .into_iter()
        .take(100)
        .map(|(name, size, modified)| CloudFile { name, size, modified })
        .collect())
}

/// Télécharge un fichier vers le dossier temporaire ; retourne le chemin.
pub async fn download_file(pool: &SqlitePool, name: &str) -> Result<String, String> {
    if !valid_segment(name) {
        return Err("nom de fichier invalide".into());
    }
    let bytes = webdav::fetch_object(pool, &format!("{FILES_DIR}{}", encode_segment(name))).await?;
    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err("fichier trop volumineux (max 500 Mo)".into());
    }
    let dest = std::env::temp_dir().join(format!("vaultly-dl-{name}"));
    tokio::fs::write(&dest, &bytes)
        .await
        .map_err(|e| format!("écriture temporaire impossible : {e}"))?;
    Ok(dest.display().to_string())
}

/// « Joindre depuis le cloud » : télécharge et range dans
/// Documents\Vaultly\Fichiers sous nom unique — la ressource locale pointe
/// alors sur un fichier durable (l'URL WebDAV est protégée par mot de passe,
/// elle ne serait pas cliquable ailleurs). Retourne le chemin local écrit.
pub async fn import_to_resources(
    app: &tauri::AppHandle,
    pool: &SqlitePool,
    name: &str,
) -> Result<String, String> {
    if !valid_segment(name) {
        return Err("nom de fichier invalide".into());
    }
    let bytes = webdav::fetch_object(pool, &format!("{FILES_DIR}{}", encode_segment(name))).await?;
    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err("fichier trop volumineux (max 500 Mo)".into());
    }
    let dir = crate::commands::resources_root_dir(app).join("Fichiers");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("création du dossier impossible : {e}"))?;
    // « 20260909-120000-rapport.pdf » → « rapport.pdf » ; collision → suffixe
    // (le nom uploadé porte l'horodatage sur deux segments séparés par « - »)
    let base = name
        .splitn(3, '-')
        .nth(2)
        .filter(|r| !r.is_empty())
        .unwrap_or(name)
        .trim()
        .to_string();
    let base = base.as_str();
    let (stem, ext) = match base.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && e.len() <= 10 => (s.to_string(), format!(".{e}")),
        _ => (base.to_string(), String::new()),
    };
    let mut dest = dir.join(format!("{stem}{ext}"));
    let mut n = 2;
    while tokio::fs::symlink_metadata(&dest).await.is_ok() {
        dest = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
        if n > 99 {
            return Err("trop de fichiers homonymes dans le dossier".into());
        }
    }
    tokio::fs::write(&dest, &bytes)
        .await
        .map_err(|e| format!("écriture impossible : {e}"))?;
    Ok(dest.display().to_string())
}

// --- commandes Tauri ---

#[tauri::command]
pub async fn cloud_upload_file(
    pool: tauri::State<'_, SqlitePool>,
    path: String,
) -> Result<String, String> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("fichier introuvable : {path}"));
    }
    upload_file(&pool, &p).await
}

#[tauri::command]
pub async fn cloud_list_files(
    pool: tauri::State<'_, SqlitePool>,
    query: Option<String>,
) -> Result<Vec<CloudFile>, String> {
    list_files(&pool, query).await
}

#[tauri::command]
pub async fn cloud_download_file(
    pool: tauri::State<'_, SqlitePool>,
    name: String,
) -> Result<String, String> {
    download_file(&pool, &name).await
}

/// « Joindre depuis le cloud » côté UI : rapatrie le fichier dans
/// Documents\Vaultly\Fichiers et crée la ressource « fichier » locale.
#[tauri::command]
pub async fn cloud_import_file(
    app: tauri::AppHandle,
    pool: tauri::State<'_, SqlitePool>,
    name: String,
) -> Result<serde_json::Value, String> {
    let path = import_to_resources(&app, &pool, &name).await?;
    let title = std::path::Path::new(&path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Fichier")
        .to_string();
    // ressource type fichier : url « file:… », comme la création manuelle
    let url = format!("file:{path}");
    let existing = crate::db::list_resources(
        &pool,
        &crate::db::ResourceFilter {
            query: url.clone(),
            no_limit: true,
            ..Default::default()
        },
    )
    .await
    .unwrap_or_default()
    .into_iter()
    .find(|r| r.url == url);
    let id = match existing {
        Some(r) => r.id,
        None => {
            let new = crate::db::NewResource {
                url,
                title: title.clone(),
                description: String::new(),
                resource_type: "fichier".into(),
                category: "Cloud".into(),
                tags: vec!["cloud".into()],
                notes: String::new(),
                favicon: String::new(),
                favorite: false,
                meta: Default::default(),
                folder_id: None,
                status: None,
            };
            let new = crate::commands::normalize_url(new)?;
            crate::db::add_resource(&pool, &new).await?.id
        }
    };
    Ok(serde_json::json!({ "id": id, "path": path, "title": title }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn propfind_parses_namespaces_sizes_and_dirs() {
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:S="http://apache.org/calcite/xml/ser">
 <d:response>
  <d:href>/dav/Koofr/fichiers/</d:href>
  <d:propstat><d:prop><d:getlastmodified>Sun, 01 Jan 2029 00:00:00 GMT</d:getlastmodified></d:prop></d:propstat>
 </d:response>
 <d:response>
  <d:href>/dav/Koofr/fichiers/rapport%202.pdf</d:href>
  <d:propstat><d:prop>
   <d:getlastmodified>Mon, 09 Sep 2026 10:00:00 GMT</d:getlastmodified>
   <d:getcontentlength>12345</d:getcontentlength>
  </d:prop></d:propstat>
 </d:response>
 <S:response>
  <S:href>/dav/Koofr/fichiers/vid%C3%A9o.mp4</S:href>
  <S:propstat><S:prop><S:getcontentlength>9</S:getcontentlength></S:prop></S:propstat>
 </S:response>
 <d:response><d:href>/dav/Koofr/fichiers/sansprops.txt</d:href></d:response>
</d:multistatus>"#;
        let entries = parse_propfind(xml);
        assert_eq!(entries.len(), 3, "le répertoire est exclu");
        assert_eq!(entries[0].0, "rapport 2.pdf", "href décodé");
        assert_eq!(entries[0].1, Some(12345));
        assert_eq!(
            entries[0].2.as_deref(),
            Some("Mon, 09 Sep 2026 10:00:00 GMT")
        );
        assert_eq!(entries[1].0, "vidéo.mp4");
        assert_eq!(entries[1].1, Some(9));
        assert_eq!(entries[2].1, None);
    }

    #[test]
    fn upload_name_never_escapes_the_dir() {
        // le nom distant passe par valid_segment AVANT tout PUT
        assert!(valid_segment("20260909-120000-rapport 2.pdf"));
        assert!(!valid_segment("../../evil"));
        assert!(!valid_segment("a/b"));
        // l'encodage neutralise de toute façon les séparateurs résiduels
        assert!(!encode_segment("a b/../c").contains('/'));
    }
}

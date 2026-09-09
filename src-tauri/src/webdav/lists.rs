//! Listes de liens partagées : fichiers JSON dans listes/ du dossier cloud,
//! équivalent WebDAV des « share lists » Google Drive. L'utilisateur choisit
//! un fichier par catégorie ; chaque partage ajoute une entrée (sans doublon).

use super::{encode_segment, valid_remote_name};
use crate::webdav;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

/// Sous-dossier réservé aux listes JSON.
pub const LISTS_DIR: &str = "listes/";
const LIST_PREFIX: &str = "vaultly-list-";
const LIST_SUFFIX: &str = ".json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareLinkEntry {
    #[serde(default)]
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareListInfo {
    /// nom du fichier JSON distant (l'« id » WebDAV)
    pub name: String,
    /// titre interne stocké dans le JSON (peut être unicode)
    pub title: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendLinkResult {
    pub name: String,
    pub added: bool,
    pub total: usize,
}

/// read-modify-write sérialisé : deux partages simultanés (UI + palette) ne
/// doivent pas faire perdre une entrée au second.
static LIST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn is_list_name(name: &str) -> bool {
    valid_remote_name(name, LIST_PREFIX, LIST_SUFFIX)
}

/// Nom de fichier de liste : ASCII sûr uniquement (les hrefs reviennent
/// encodés côté lecture, mais écrire en ASCII évite toute surprise entre
/// serveurs). Le titre complet est stocké DANS le JSON.
fn list_name_for(title: &str) -> Result<String, String> {
    let base = title
        .trim()
        .trim_end_matches(".json")
        .trim_end_matches(".JSON")
        .trim();
    if base.is_empty() {
        return Err("le nom de la liste est obligatoire".into());
    }
    let short: String = base
        .chars()
        .take(60)
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    Ok(format!("{LIST_PREFIX}{short}{LIST_SUFFIX}"))
}

/// Lit une liste en une requête : (titre interne, entrées).
async fn read_list_full(
    pool: &SqlitePool,
    name: &str,
) -> Result<(String, Vec<ShareLinkEntry>), String> {
    if !is_list_name(name) {
        return Err("nom de liste invalide".into());
    }
    let bytes = webdav::fetch_object(pool, &list_rel(name)).await?;
    let text = String::from_utf8(bytes)
        .map_err(|_| "la liste n'est pas un texte UTF-8 valide".to_string())?;
    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|_| "ce fichier JSON n'est pas une liste de liens valide".to_string())?;
    let title = json
        .get("name")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| fallback_title(name));
    Ok((title, parse_list(&json)?))
}

fn fallback_title(name: &str) -> String {
    name.trim_start_matches(LIST_PREFIX)
        .trim_end_matches(LIST_SUFFIX)
        .replace('_', " ")
}

fn list_rel(name: &str) -> String {
    format!("{LISTS_DIR}{}", encode_segment(name))
}

/// Parse des entrées : objet avec « links[] » ou tableau simple ; une entrée
/// sans url est ignorée.
fn parse_list(json: &serde_json::Value) -> Result<Vec<ShareLinkEntry>, String> {
    let arr = match json {
        serde_json::Value::Array(a) => a.clone(),
        serde_json::Value::Object(map) => map
            .get("links")
            .and_then(|v| v.as_array())
            .cloned()
            .ok_or_else(|| "ce fichier JSON n'est pas une liste de liens valide".to_string())?,
        _ => return Err("ce fichier JSON n'est pas une liste de liens valide".to_string()),
    };
    let mut out = Vec::new();
    for v in arr {
        let url = v
            .get("url")
            .and_then(|u| u.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if url.is_empty() {
            continue;
        }
        out.push(ShareLinkEntry {
            title: v.get("title").and_then(|t| t.as_str()).unwrap_or("").to_string(),
            url,
            added_at: v.get("addedAt").and_then(|a| a.as_str()).unwrap_or("").to_string(),
        });
    }
    Ok(out)
}

async fn write_list(pool: &SqlitePool, name: &str, doc: &serde_json::Value) -> Result<(), String> {
    if !is_list_name(name) {
        return Err("nom de liste invalide".into());
    }
    let bytes =
        serde_json::to_vec_pretty(doc).map_err(|e| format!("sérialisation impossible : {e}"))?;
    webdav::store_object(pool, &list_rel(name), "application/json", bytes).await
}

/// Liste les fichiers vaultly-list-*.json de listes/ (titre + count chacun).
pub async fn list_share_lists(pool: &SqlitePool) -> Result<Vec<ShareListInfo>, String> {
    let cfg = webdav::load_config(pool)
        .await
        .ok_or("Cloud WebDAV non configuré (Réglages → Sauvegarde cloud)")?;
    let entries =
        match super::files::propfind_dir(&cfg, LISTS_DIR).await {
            Ok(e) => e,
            Err(e) if e.contains("introuvable") || e.contains("404") => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
    let mut out = Vec::new();
    for (name, _, _) in entries {
        if !is_list_name(&name) {
            continue;
        }
        match read_list_full(pool, &name).await {
            Ok((title, list)) => out.push(ShareListInfo {
                name,
                title,
                count: list.len(),
            }),
            Err(e) => tracing::warn!("liste de liens {name} illisible : {e}"),
        }
    }
    out.sort_by_key(|a| a.title.to_lowercase());
    Ok(out)
}

/// Ajoute un lien à une liste existante (sans doublon) ; `new_list_title`
/// crée la liste si `name` est absent.
pub async fn append_link(
    pool: &SqlitePool,
    name: Option<String>,
    new_list_title: Option<String>,
    title: &str,
    url: &str,
    added_at: &str,
) -> Result<AppendLinkResult, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("l'URL à partager est vide".into());
    }
    let title = title.trim();
    let title = if title.is_empty() { url.clone() } else { title.to_string() };
    let target = match name.filter(|s| !s.is_empty()) {
        Some(n) => n,
        None => list_name_for(new_list_title.as_deref().unwrap_or(""))?,
    };
    if !is_list_name(&target) {
        return Err("nom de liste invalide".into());
    }

    let _guard = LIST_LOCK.lock().await;
    let mut entries = match read_list_full(pool, &target).await {
        Ok((_, e)) => e,
        // liste inexistante (404) ou illisible : on part d'une liste vide,
        // l'écriture la créera (ou réécrira un fichier abîmé — même forme)
        Err(_) => Vec::new(),
    };
    if entries.iter().any(|e| e.url == url) {
        return Ok(AppendLinkResult {
            name: target,
            added: false,
            total: entries.len(),
        });
    }
    entries.push(ShareLinkEntry {
        title,
        url,
        added_at: added_at.to_string(),
    });
    let doc = serde_json::json!({
        "name": fallback_title(&target),
        "updatedAt": added_at,
        "links": entries,
    });
    write_list(pool, &target, &doc).await?;
    Ok(AppendLinkResult {
        name: target,
        added: true,
        total: entries.len(),
    })
}

// --- commandes Tauri ---

#[tauri::command]
pub async fn cloud_list_share_lists(
    pool: tauri::State<'_, SqlitePool>,
) -> Result<Vec<ShareListInfo>, String> {
    list_share_lists(&pool).await
}

#[tauri::command]
pub async fn cloud_append_link(
    pool: tauri::State<'_, SqlitePool>,
    name: Option<String>,
    new_list_title: Option<String>,
    title: String,
    url: String,
    added_at: String,
) -> Result<AppendLinkResult, String> {
    append_link(&pool, name, new_list_title, &title, &url, &added_at).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::webdav::valid_segment;

    #[test]
    fn list_name_is_safe_ascii() {
        assert_eq!(
            list_name_for("Mes liens").unwrap(),
            "vaultly-list-Mes_liens.json"
        );
        assert_eq!(
            list_name_for("Design/AIAPI:*?").unwrap(),
            "vaultly-list-Design_AIAPI___.json"
        );
        assert!(list_name_for("  ").is_err());
        for t in ["A", "a/b", "🎉", &"x".repeat(80)] {
            if let Ok(n) = list_name_for(t) {
                assert!(is_list_name(&n), "{n} devrait être valide");
                assert!(valid_segment(&n));
            }
        }
    }

    #[test]
    fn parse_list_tolerates_both_shapes() {
        let parse = |s: &str| {
            let v: serde_json::Value = serde_json::from_str(s).unwrap();
            parse_list(&v)
        };
        let obj = r#"{"name":"X","links":[{"title":"a","url":"https://a.com","addedAt":"t"}]}"#;
        assert_eq!(parse(obj).unwrap().len(), 1);
        let arr = r#"[{"url":"https://b.com"}]"#;
        let l = parse(arr).unwrap();
        assert_eq!(l[0].url, "https://b.com");
        assert_eq!(l[0].title, "");
        assert!(parse(r#"[{"title":"x"}]"#).unwrap().is_empty());
        assert!(parse(r#"{"a":1}"#).is_err());
        let scalar: serde_json::Value = serde_json::from_str("42").unwrap();
        assert!(parse_list(&scalar).is_err());
    }

    #[test]
    fn name_validation_rejects_foreign_files() {
        assert!(is_list_name("vaultly-list-A.json"));
        assert!(!is_list_name("vaultly-backup-20260101.json"));
        assert!(!is_list_name("vaultly-list-a/b.json"));
        assert!(!is_list_name("vaultly-list-.json"));
    }
}

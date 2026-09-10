//! Client WebDAV minimal pour la sauvegarde : PUT/GET/PROPFIND/DELETE sur un
//! dossier compatible (Koofr, Nextcloud, Synology…). Pas d'OAuth ni de
//! console développeur : trois champs suffisent (URL, identifiant, mot de
//! passe en Basic auth — les tokens d'application à la Nextcloud conviennent
//! aussi). Le mot de passe est un secret DPAPI ; l'URL et l'identifiant sont
//! des settings. Seuls les fichiers `vaultly-backup-*.json` écrits par l'app
//! sont listés/prunés — jamais le reste du dossier distant.

use crate::db;
use serde::Serialize;
use sqlx::SqlitePool;
use std::time::Duration;

/// Seule forme acceptée pour un nom de fichier distant : le nom vient du XML
/// PROPFIND ou d'un clic dans l'UI, il ne doit jamais porter de chemin.
const BACKUP_PREFIX: &str = "vaultly-backup-";
const BACKUP_SUFFIX: &str = ".json";
/// Nombre de backups gardés sur le serveur distant (comme Drive).
const KEEP_BACKUPS: usize = 5;

#[derive(Debug, Clone)]
pub struct WebDavConfig {
    pub base: String,
    pub user: String,
    pub password: String,
}

/// URL de base validée + normalisée (terminée par « / »). http: est permis
/// pour un réseau local (NAS Synology/Nextcloud), https: est recommandé.
/// Ni requête ni ancre dans l'URL : elles casseraient la construction des
/// URLs d'objets.
pub fn normalize_base(raw: &str) -> Result<String, String> {
    let t = raw.trim();
    let lower = t.to_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err(
            "l'URL doit commencer par https:// (recommandé) ou http:// (réseau local)".into(),
        );
    }
    if t
        .chars()
        .any(|c| matches!(c, ' ' | '\\' | '?' | '#' | '<' | '>' | '"' | '\'' | '|'))
    {
        return Err("l'URL contient un caractère interdit (espace, ?, #, antislash…)".into());
    }
    let mut out = t.to_string();
    if !out.ends_with('/') {
        out.push('/');
    }
    Ok(out)
}

/// « vaultly-backup-20260909-120000.json » : préfixe + horodatage ASCII +
/// suffixe, rien d'autre (pas de '/', pas de '..', pas de segment arbitraire).
fn valid_backup_name(name: &str) -> bool {
    super::valid_remote_name(name, BACKUP_PREFIX, BACKUP_SUFFIX)
}

fn now_epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Horodatage UTC AAAAMMJJ-HHMMSS (tri lexicographique = chronologique).
pub(crate) fn backup_stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = crate::civil_from_secs_public(secs);
    format!("{y:04}{mo:02}{d:02}-{h:02}{mi:02}{s:02}")
}

pub async fn load_config(pool: &SqlitePool) -> Option<WebDavConfig> {
    let base = normalize_base(&db::get_setting(pool, "webdav_url").await?).ok()?;
    let user = db::get_setting(pool, "webdav_user").await?;
    let password = db::get_secret(pool, "webdav_pass").await?;
    if user.trim().is_empty() || password.is_empty() {
        return None;
    }
    Some(WebDavConfig {
        base,
        user: user.trim().to_string(),
        password,
    })
}

pub async fn is_configured(pool: &SqlitePool) -> bool {
    load_config(pool).await.is_some()
}

pub(crate) fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .unwrap_or_else(|e| {
            tracing::warn!("client WebDAV 60s indisponible, repli sans timeout : {e}");
            reqwest::Client::new()
        })
}

/// Deux tentatives avec backoff (Koofr limite le débit WebDAV côté gratuit).
/// Le builder étant consommé par `send`, `make` le reconstruit à chaque essai.
pub(crate) async fn retry2(
    make: impl Fn() -> reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    let mut last = String::from("inconnu");
    for attempt in 0..2 {
        match make().send().await {
            Ok(resp) => {
                let s = resp.status();
                if (s.as_u16() == 429 || s.is_server_error()) && attempt == 0 {
                    last = format!("le serveur a répondu {s}");
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }
                return Ok(resp);
            }
            Err(e) => {
                last = format!("réseau : {e}");
                if attempt == 0 {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }
            }
        }
    }
    Err(format!("WebDAV injoignable ({last})"))
}

/// Message d'erreur parlant selon le statut HTTP, avec un extrait du corps.
pub(crate) fn describe_status(status: reqwest::StatusCode, body: &str) -> String {
    let detail: String = body
        .chars()
        .filter(|c| !c.is_control())
        .take(140)
        .collect::<String>()
        .trim()
        .to_string();
    let base = match status.as_u16() {
        401 | 403 => "identifiants refusés (vérifie l'identifiant et le mot de passe WebDAV)"
            .to_string(),
        404 => "dossier introuvable — vérifie l'URL de base (elle doit pointer sur un dossier)"
            .to_string(),
        405 | 501 => "WebDAV non activé sur ce serveur".to_string(),
        409 => "le dossier parent n'existe pas".to_string(),
        429 => "débit WebDAV dépassé — le serveur limite les requêtes, réessaie dans un instant"
            .to_string(),
        507 => "stockage distant saturé".to_string(),
        c => format!("serveur WebDAV : erreur {c}"),
    };
    if detail.is_empty() {
        base
    } else {
        format!("{base} — {detail}")
    }
}

fn ensure_ok(status: reqwest::StatusCode, body: &str) -> Result<(), String> {
    if status.is_success() || status.as_u16() == 207 {
        Ok(())
    } else {
        Err(describe_status(status, body))
    }
}

/// Extrait les noms de fichiers backup d'une réponse PROPFIND. Les balises
/// `<href>` portent un namespace variable (`<d:href>`, `<S:href>`…) ; on
/// compare le nom nu après le dernier « : ». Les href sont des URLs (ou des
/// chemins) — on ne garde que le dernier segment ; nos noms sont ASCII purs,
/// un nom encodé (%XX) est simplement ignoré, jamais résolu à l'aveugle.
fn extract_backup_names(xml: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut rest = xml;
    while let Some(start) = find_href_open(rest) {
        let after = &rest[start..];
        let Some(close) = after.find("</") else {
            break;
        };
        let href = after[..close].trim();
        let last = href.rsplit('/').next().unwrap_or("");
        if valid_backup_name(last) && !out.iter().any(|n| n == last) {
            out.push(last.to_string());
        }
        rest = &after[close..];
    }
    out
}

/// Position du contenu du prochain élément « href » (avec ou sans namespace),
/// ou None s'il n'y en a plus. Ignore les balises auto-fermantes
/// (`<d:href/>` : le contenu est vide mais le texte suivant n'appartient pas
/// à l'élément).
pub(crate) fn find_href_open(xml: &str) -> Option<usize> {
    let mut i = 0;
    while let Some(rel) = xml[i..].find('<') {
        let open = i + rel;
        let gt = xml[open..].find('>')?;
        let tag = &xml[open + 1..open + gt];
        if !tag.starts_with('/') && !tag.ends_with('/') {
            let bare = tag.rsplit(':').next().unwrap_or("").split_whitespace().next().unwrap_or("");
            if bare == "href" {
                return Some(open + gt + 1);
            }
        }
        i = open + gt + 1;
    }
    None
}

pub(crate) const PROPFIND_BODY: &str =
    "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>";

/// Liste les backups présents, du plus récent au plus ancien (l'horodatage
/// du nom est triable lexicographiquement).
pub async fn list_backups(pool: &SqlitePool) -> Result<Vec<String>, String> {
    let cfg = load_config(pool)
        .await
        .ok_or("WebDAV non configuré (Réglages → Sauvegarde cloud)")?;
    let client = http_client();
    // PROPFIND n'est pas une méthode HTTP standard : http::Method n'en a
    // pas de constante, on la construit depuis ses octets.
    let propfind = reqwest::Method::from_bytes(b"PROPFIND")
        .map_err(|e| format!("méthode PROPFIND invalide : {e}"))?;
    let resp = retry2(|| {
        client
            .request(propfind.clone(), &cfg.base)
            .basic_auth(&cfg.user, Some(&cfg.password))
            .header("Depth", "1")
            .header("Content-Type", "application/xml")
            .body(PROPFIND_BODY)
    })
    .await?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("réponse WebDAV illisible : {e}"))?;
    ensure_ok(status, &text)?;
    let mut names = extract_backup_names(&text);
    names.sort();
    names.reverse();
    Ok(names)
}

async fn delete_backup(pool: &SqlitePool, name: &str) -> Result<(), String> {
    let cfg = load_config(pool).await.ok_or("WebDAV non configuré")?;
    if !valid_backup_name(name) {
        return Err("nom de fichier de backup invalide".into());
    }
    let url = format!("{}{}", cfg.base, name);
    let client = http_client();
    let resp = retry2(|| {
        client
            .delete(&url)
            .basic_auth(&cfg.user, Some(&cfg.password))
    })
    .await?;
    let status = resp.status();
    // 404 = déjà parti entre-temps : ce n'est pas une erreur pour la prune
    if status.is_success() || status.as_u16() == 404 {
        return Ok(());
    }
    let body = resp.text().await.unwrap_or_default();
    Err(describe_status(status, &body))
}

/// Sauvegarde la bibliothèque (ressources + dossiers) en JSON sur le serveur.
/// Retourne le nom du fichier écrit. Prune à `KEEP_BACKUPS` les plus récents,
/// uniquement des fichiers `vaultly-backup-*.json` — jamais autre chose.
pub async fn backup(pool: &SqlitePool) -> Result<String, String> {
    let cfg = load_config(pool)
        .await
        .ok_or("WebDAV non configuré (Réglages → Sauvegarde cloud)")?;
    let resources = db::list_resources(
        pool,
        &db::ResourceFilter {
            no_limit: true,
            ..Default::default()
        },
    )
    .await?;
    let folders = db::list_folders(pool).await?;
    let data = crate::commands::ExportData {
        resources,
        folders,
        version: env!("CARGO_PKG_VERSION").into(),
    };
    let bytes =
        serde_json::to_vec_pretty(&data).map_err(|e| format!("sérialisation impossible : {e}"))?;
    let name = format!("{BACKUP_PREFIX}{0}{BACKUP_SUFFIX}", backup_stamp());
    let url = format!("{}{}", cfg.base, name);
    let client = http_client();
    let body = bytes.clone();
    let resp = retry2(|| {
        client
            .put(&url)
            .basic_auth(&cfg.user, Some(&cfg.password))
            .header("Content-Type", "application/json")
            .body(body.clone())
    })
    .await?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(describe_status(status, &text));
    }
    // prune bornée : un échec ici ne doit pas faire échouer la sauvegarde
    match list_backups(pool).await {
        Ok(all) => {
            for old in all.iter().skip(KEEP_BACKUPS) {
                if let Err(e) = delete_backup(pool, old).await {
                    tracing::warn!("prune du backup WebDAV {old} échouée : {e}");
                }
            }
        }
        Err(e) => tracing::warn!("prune des backups WebDAV impossible : {e}"),
    }
    db::set_setting(pool, "webdav_last_backup_at", &now_epoch().to_string())
        .await
        .ok();
    Ok(name)
}

/// Restaure depuis un backup WebDAV (le plus récent si `name` est None).
pub async fn restore(
    pool: &SqlitePool,
    name: Option<String>,
) -> Result<crate::commands::ImportSummary, String> {
    let cfg = load_config(pool)
        .await
        .ok_or("WebDAV non configuré (Réglages → Sauvegarde cloud)")?;
    let name = match name.filter(|s| !s.is_empty()) {
        Some(n) => {
            if !valid_backup_name(&n) {
                return Err("nom de fichier de backup invalide".into());
            }
            n
        }
        None => list_backups(pool)
            .await?
            .into_iter()
            .next()
            .ok_or("aucun backup WebDAV trouvé")?,
    };
    let url = format!("{}{}", cfg.base, name);
    let client = http_client();
    let resp = retry2(|| {
        client
            .get(&url)
            .basic_auth(&cfg.user, Some(&cfg.password))
    })
    .await?;
    let status = resp.status();
    let bytes = if status.is_success() {
        resp.bytes()
            .await
            .map_err(|e| format!("lecture du backup impossible : {e}"))?
    } else {
        let text = resp.text().await.unwrap_or_default();
        return Err(describe_status(status, &text));
    };
    let text = String::from_utf8(bytes.to_vec())
        .map_err(|_| "le backup WebDAV n'est pas un texte UTF-8 valide".to_string())?;
    crate::commands::import_payload_from_str(pool, &text).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavStatus {
    pub configured: bool,
    /// l'URL enregistrée (donnée non sensible — le mot de passe, lui, ne
    /// sort JAMAIS du processus)
    pub url: String,
    pub autobackup_enabled: bool,
    pub autobackup_interval_hours: u64,
    pub last_backup_at: Option<i64>,
}

// --- commandes Tauri ---

#[tauri::command]
pub async fn webdav_status(pool: tauri::State<'_, SqlitePool>) -> Result<WebDavStatus, String> {
    let configured = is_configured(&pool).await;
    Ok(WebDavStatus {
        configured,
        url: db::get_setting(&pool, "webdav_url")
            .await
            .unwrap_or_default(),
        autobackup_enabled: db::get_setting(&pool, "webdav_autobackup_enabled")
            .await
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false),
        autobackup_interval_hours: db::get_setting(&pool, "webdav_autobackup_interval_hours")
            .await
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|n| *n > 0)
            .unwrap_or(24),
        last_backup_at: db::get_setting(&pool, "webdav_last_backup_at")
            .await
            .and_then(|v| v.parse::<i64>().ok()),
    })
}

/// Enregistre la configuration : password vide = conserve l'existant (pour
/// ne pas obliger à re-coller le secret quand on corrige juste l'URL).
#[tauri::command]
pub async fn webdav_set_config(
    pool: tauri::State<'_, SqlitePool>,
    url: String,
    user: String,
    password: String,
) -> Result<(), String> {
    let base = normalize_base(&url)?;
    // http vers un hôte distant = identifiants Basic en clair : on n'interdit
    // pas (les NAS en LAN http sont un cas légitime) mais on le trace et on le
    // signale en UI. https doit rester la norme pour un serveur public.
    if base.starts_with("http://") && crate::metadata::host_is_public(&base) {
        tracing::warn!(
            "WebDAV configuré en http non chiffré vers un hôte distant ({base}) : les identifiants circulent en clair"
        );
    }
    let user = user.trim().to_string();
    if user.is_empty() {
        return Err("l'identifiant est obligatoire".into());
    }
    if password.is_empty() && load_config(&pool).await.is_none() {
        return Err("le mot de passe est obligatoire au premier enregistrement".into());
    }
    db::set_setting(&pool, "webdav_url", &base).await?;
    db::set_setting(&pool, "webdav_user", &user).await?;
    if !password.is_empty() {
        db::set_secret(&pool, "webdav_pass", &password).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn webdav_clear_config(pool: tauri::State<'_, SqlitePool>) -> Result<(), String> {
    for key in [
        "webdav_url",
        "webdav_user",
        "webdav_pass",
        "webdav_autobackup_enabled",
        "webdav_autobackup_interval_hours",
        "webdav_last_backup_at",
    ] {
        sqlx::query("DELETE FROM settings WHERE key = ?")
            .bind(key)
            .execute(&*pool)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Teste la connexion : PROPFIND sur le dossier. Retourne le nombre de
/// backups Vaultly déjà présents (0 = serveur vide mais accessible).
#[tauri::command]
pub async fn webdav_test_connection(pool: tauri::State<'_, SqlitePool>) -> Result<usize, String> {
    Ok(list_backups(&pool).await?.len())
}

#[tauri::command]
pub async fn webdav_backup(pool: tauri::State<'_, SqlitePool>) -> Result<String, String> {
    backup(&pool).await
}

#[tauri::command]
pub async fn webdav_list_backups(pool: tauri::State<'_, SqlitePool>) -> Result<Vec<String>, String> {
    list_backups(&pool).await
}

#[tauri::command]
pub async fn webdav_restore(
    pool: tauri::State<'_, SqlitePool>,
    name: Option<String>,
) -> Result<crate::commands::ImportSummary, String> {
    restore(&pool, name).await
}

#[tauri::command]
pub async fn webdav_set_autobackup(
    pool: tauri::State<'_, SqlitePool>,
    enabled: bool,
    interval_hours: u64,
) -> Result<(), String> {
    if interval_hours == 0 {
        return Err("l'intervalle doit être d'au moins 1 heure".into());
    }
    db::set_setting(&pool, "webdav_autobackup_enabled", if enabled { "1" } else { "0" }).await?;
    db::set_setting(&pool, "webdav_autobackup_interval_hours", &interval_hours.to_string())
        .await
}


#[cfg(test)] #[path = "tests.rs"] mod tests;

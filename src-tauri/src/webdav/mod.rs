//! Client WebDAV « cloud » de Vaultly : sauvegarde (core), explorateur de
//! fichiers (files), listes de liens partagées (lists). Le dossier distant
//! configuré est la racine de tout ; l'app n'écrit que dans fichiers/,
//! listes/, et ses backups vaultly-backup-*.json à la racine.

pub mod core;
pub mod files;
pub mod lists;

pub use core::*;

use sqlx::SqlitePool;

/// Filtre de noms issu d'un PROPFIND : segments valides (ASCII sûr, sans
/// chemin), préfixe et suffixe exigés — la garde anti-traversal sur les
/// hrefs renvoyés par le serveur : on ne retient que NOS fichiers.
pub fn valid_remote_name(name: &str, prefix: &str, suffix: &str) -> bool {
    let Some(stem) = name.strip_prefix(prefix).and_then(|s| s.strip_suffix(suffix)) else {
        return false;
    };
    !stem.is_empty()
        && stem.len() < 100
        && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Un nom de fichier que l'on accepte de manipuler : le caractère dangereux
/// est le séparateur de chemin (« / » construirait une URL hors de la base) ;
/// « . »/« .. » seuls, les antislashs et les caractères de contrôle aussi.
/// Les espaces, accents et symboles sont sans risque : ils sont
/// percent-encodés à la construction de l'URL.
pub fn valid_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() < 255
        && s != "."
        && s != ".."
        && !s.contains('/')
        && !s.contains('\\')
        && !s.contains("..")
        && !s.chars().any(|c| (c as u32) < 0x20 || c == '\u{7f}')
}

/// Encode un segment de chemin (tout ce qui n'est pas sûr devient %XX).
pub fn encode_segment(s: &str) -> String {
    s.as_bytes()
        .iter()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
                (*b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

/// Décode les %XX d'un href PROPFIND (le serveur encode les noms non ASCII).
pub fn decode_segment(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// MKCOL du sous-dossier s'il manque (beaucoup de serveurs refusent un PUT
/// dans un parent absent, 409). Toute erreur est tolérée : soit le dossier
/// existe déjà (405), soit le serveur crée implicitement — le PUT suivant
/// donnera la vraie erreur s'il le faut.
pub(crate) async fn ensure_dir(pool: &SqlitePool, subdir: &str) {
    let Some(cfg) = load_config(pool).await else {
        return;
    };
    let url = format!("{}{}", cfg.base, subdir);
    let client = core::http_client();
    let mkcol = match reqwest::Method::from_bytes(b"MKCOL") {
        Ok(m) => m,
        Err(_) => return,
    };
    let _ = core::retry2(|| {
        client
            .request(mkcol.clone(), &url)
            .basic_auth(&cfg.user, Some(&cfg.password))
    })
    .await;
}

/// Limite dure de tout GET sortant : fichiers (import) comme backups (restore).
const MAX_FETCH_BYTES: u64 = 500 * 1_048_576; // 500 Mo

/// GET borné d'un objet : le serveur (compromis, mal configuré, ou MITM en
/// http) ne doit jamais pouvoir faire allouer une taille non plafonnée à
/// l'app. Content-Length est vérifié AVANT lecture, et la somme des chunks
/// est coupée en direct (les deux sont indépendamment contournables, d'où
/// la double garde).
pub(crate) async fn read_capped(
    resp: reqwest::Response,
    max: u64,
    label: &str,
) -> Result<Vec<u8>, String> {
    if let Some(len) = resp.content_length() {
        if len > max {
            return Err(format!("{label} trop volumineux (max {} Mo)", max / 1_048_576));
        }
    }
    let mut acc: Vec<u8> = Vec::new();
    let stream = resp.bytes_stream();
    use futures_util::StreamExt;
    let mut stream = std::pin::pin!(stream);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("lecture {label} impossible : {e}"))?;
        if (acc.len() as u64) + chunk.len() as u64 > max {
            return Err(format!("{label} trop volumineux (max {} Mo)", max / 1_048_576));
        }
        acc.extend_from_slice(&chunk);
    }
    Ok(acc)
}

/// Texte d'erreur serveur borné (64 Ko) : un corps malveillant ou une
/// réponse d'erreur géante ne doit jamais être accumulée en mémoire.
pub(crate) async fn read_err_text(resp: reqwest::Response) -> String {
    read_capped(resp, 64 * 1024, "réponse WebDAV")
        .await
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default()
}

/// Corps XML (PROPFIND) borné : les listes légitimes pèsent quelques Ko.
pub(crate) async fn read_capped_text(
    resp: reqwest::Response,
    max: u64,
) -> Result<String, String> {
    read_capped(resp, max, "réponse WebDAV")
        .await
        .map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// GET d'un objet du dossier configuré : octets ou erreur traduite.
pub(crate) async fn fetch_object(
    pool: &SqlitePool,
    rel_path: &str,
) -> Result<Vec<u8>, String> {
    let cfg = load_config(pool)
        .await
        .ok_or("Cloud WebDAV non configuré (Réglages → Sauvegarde cloud)")?;
    let url = format!("{}{}", cfg.base, rel_path);
    let client = core::http_client();
    let resp = core::retry2(|| client.get(&url).basic_auth(&cfg.user, Some(&cfg.password))).await?;
    let status = resp.status();
    if !status.is_success() {
        let text = read_err_text(resp).await;
        return Err(core::describe_status(status, &text));
    }
    read_capped(resp, MAX_FETCH_BYTES, "fichier cloud").await
}

/// PUT d'un objet dans le dossier configuré (mkdir du sous-dossier si besoin).
pub(crate) async fn store_object(
    pool: &SqlitePool,
    rel_path: &str,
    content_type: &str,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let cfg = load_config(pool)
        .await
        .ok_or("Cloud WebDAV non configuré (Réglages → Sauvegarde cloud)")?;
    // sous-dossier (« fichiers/x.png » → mkdir « fichiers/ »)
    if let Some((dir, _)) = rel_path.split_once('/') {
        ensure_dir(pool, &format!("{dir}/")).await;
    }
    let url = format!("{}{}", cfg.base, rel_path);
    let client = core::http_client();
    let body = bytes.clone();
    let ct = content_type.to_string();
    let resp = core::retry2(|| {
        client
            .put(&url)
            .basic_auth(&cfg.user, Some(&cfg.password))
            .header("Content-Type", ct.clone())
            .body(body.clone())
    })
    .await?;
    let status = resp.status();
    if !status.is_success() {
        let text = read_err_text(resp).await;
        return Err(core::describe_status(status, &text));
    }
    Ok(())
}


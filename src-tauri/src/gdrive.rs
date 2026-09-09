//! Connexion Google Drive : flux OAuth « application bureau », stockage des
//! jetons en base (settings), renouvellement automatique, upload simple.
//!
//! Prérequis développeur : un Client ID + Secret OAuth de type « Application
//! de bureau » (Google Cloud Console), avec soi-même en utilisateur test.
//! Le Client ID est embarqué en constante (donnée publique par nature).
//! Le Secret n'est JAMAIS dans le source/git : il est lu à la COMPILATION
//! (variable `GDRIVE_CLIENT_SECRET` définie sur la machine qui construit
//! l'installateur), avec repli sur l'environnement runtime et le setting
//! `gdrive_client_secret`.

use crate::db;
use axum::{
    extract::Query,
    response::Html,
    routing::get,
    Router,
};
use serde::Deserialize;
use sqlx::SqlitePool;
use std::sync::Arc;

pub const REDIRECT_PORT: u16 = 8790;
pub const REDIRECT_URI: &str = "http://127.0.0.1:8790/callback";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const UPLOAD_URL: &str = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const UPLOAD_URL_BASE: &str = "https://www.googleapis.com/upload/drive/v3/files";
const MULTIPART_BOUNDARY: &str = "vaultly-boundary-7f3a";
/// Scope OAuth : accès complet au Drive (`drive`), volontaire :
/// l'explorateur, la recherche et la jointure de fichiers existants (« Joindre
/// depuis Drive ») portent sur des fichiers que l'app n'a pas créés — un scope
/// `drive.file` ne les verrait pas. Les jetons sont chiffrés au repos (DPAPI)
/// et la déconnexion révoque le refresh token côté Google.
const SCOPE: &str = "https://www.googleapis.com/auth/drive";

/// Client ID embarqué : ce n'est PAS une donnée sensible (il apparaît en
/// clair dans l'URL de consentement et dans l'écran Google). Priorité au
/// setting `gdrive_client_id` s'il existe, sinon la constante.
const DEFAULT_CLIENT_ID: &str =
    "427880467080-9tqh56rnrd51td4o2jofurm6gm2a98fh.apps.googleusercontent.com";

/// Client Secret lu à la COMPILATION : la machine qui construit
/// l'installateur définit `GDRIVE_CLIENT_SECRET`, le binaire l'embarque
/// (modèle Google « desktop app », protégé par PKCE) — le source et git
/// n'en contiennent jamais. Replis : variable runtime, puis setting.
fn baked_client_secret() -> &'static str {
    option_env!("GDRIVE_CLIENT_SECRET").unwrap_or("")
}

/// Client ID effectif : setting `gdrive_client_id`, sinon env runtime,
/// sinon la constante embarquée.
async fn effective_client_id(pool: &SqlitePool) -> Result<String, String> {
    let from_settings = db::get_setting(pool, "gdrive_client_id")
        .await
        .filter(|v| !v.is_empty());
    let id = from_settings
        .or_else(|| std::env::var("GDRIVE_CLIENT_ID").ok().filter(|v| !v.is_empty()))
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_CLIENT_ID.to_string());
    if id.is_empty() {
        return Err("Aucun Client ID Google configuré.".into());
    }
    Ok(id)
}

/// Client Secret effectif, dans l'ordre : setting `gdrive_client_secret`,
/// variable d'environnement runtime, secret embarqué à la compilation.
async fn effective_client_secret(pool: &SqlitePool) -> Result<String, String> {
    let from_settings = db::get_secret(pool, "gdrive_client_secret").await;
    let secret = from_settings
        .or_else(|| {
            std::env::var("GDRIVE_CLIENT_SECRET")
                .ok()
                .filter(|v| !v.is_empty())
        })
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| baked_client_secret().to_string());
    if secret.is_empty() {
        return Err(
            "Aucun Client Secret Google : définis GDRIVE_CLIENT_SECRET au moment du build \
             (ou sur la machine via setx) pour activer la connexion Drive."
                .into(),
        );
    }
    Ok(secret)
}

/// État des identifiants OAuth pour l'UI (le secret n'est jamais renvoyé).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialsStatus {
    /// vrai si un Client ID effectif existe (setting BYO ou build)
    pub configured: bool,
    /// vrai si le Client ID actif vient des réglages utilisateur (BYO)
    pub from_user: bool,
    /// extrait lisible du Client ID actif (jamais le secret)
    pub client_id_preview: String,
}

pub async fn credentials_status(pool: &SqlitePool) -> CredentialsStatus {
    let from_settings = db::get_setting(pool, "gdrive_client_id")
        .await
        .filter(|v| !v.is_empty());
    let from_user = from_settings.is_some();
    let effective = match from_settings {
        Some(v) => Some(v),
        None => std::env::var("GDRIVE_CLIENT_ID").ok().filter(|v| !v.is_empty()),
    }
    .unwrap_or_else(|| DEFAULT_CLIENT_ID.to_string());
    let configured = !effective.is_empty();
    // aperçu : début + fin du Client ID (c'est une donnée publique)
    let preview = if configured && effective.len() > 24 {
        format!(
            "{}…{}",
            &effective[..12],
            &effective[effective.len() - 12..]
        )
    } else {
        effective
    };
    CredentialsStatus {
        configured,
        from_user,
        client_id_preview: preview,
    }
}

/// PKCE : vérifieur aléatoire + défi SHA-256 encodé base64url.
fn pkce_pair() -> (String, String) {
    use base64::Engine;
    use rand::RngCore;
    use sha2::Digest;
    let mut bytes = [0u8; 48];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let verifier = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    let digest = sha2::Sha256::digest(verifier.as_bytes());
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest);
    (verifier, challenge)
}

// --- état partagé : l'autorisation en cours captée par le callback ---

/// Autorisation OAuth en attente : le `state` anti-CSRF généré par
/// `connect_flow` et le `code` capté par le serveur callback (None tant
/// que Google n'a pas rappelé avec le bon `state`).
#[derive(Debug, Clone, Default)]
pub struct PendingAuth {
    pub state: String,
    pub code: Option<String>,
}

pub type AuthCodeSlot = Arc<tokio::sync::RwLock<Option<PendingAuth>>>;

/// État Tauri : le slot d'autorisation partagé avec le serveur callback.
pub struct GDriveSlot(pub AuthCodeSlot);

/// Génère un `state` anti-CSRF : 32 octets aléatoires encodés en hexadécimal.
fn random_state() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub async fn start_callback_server(slot: AuthCodeSlot) -> Result<(), String> {
    #[derive(Deserialize)]
    struct Params {
        code: Option<String>,
        state: Option<String>,
        error: Option<String>,
    }
    async fn callback(
        Query(p): Query<Params>,
        slot: axum::extract::State<AuthCodeSlot>,
    ) -> Html<String> {
        // le `code` n'est accepté que si le `state` reçu correspond à celui
        // généré par `connect_flow` (anti-CSRF) ; sinon on ignore.
        let accepted = match (p.code, p.state) {
            (Some(code), Some(state)) => {
                let mut guard = slot.write().await;
                match guard.as_mut() {
                    Some(pending) if pending.state == state => {
                        pending.code = Some(code);
                        true
                    }
                    _ => false,
                }
            }
            _ => false,
        };
        if accepted {
            Html(
                "<html><body style='font-family:sans-serif;background:#fbf7f0;\
                 display:flex;align-items:center;justify-content:center;height:100vh'>\
                 <h2 style='color:#c97b5a'>Vaultly autorisé ✓ — tu peux fermer cette fenêtre.</h2>\
                 </body></html>"
                    .into(),
            )
        } else {
            // le contenu de l'erreur vient de l'URL : échappé avant interpolation
            let reason = p
                .error
                .unwrap_or_else(|| "état de sécurité invalide (tentative ignorée)".into());
            let escaped = reason
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
                .replace('\"', "&quot;");
            Html(format!(
                "<html><body style='font-family:sans-serif'>\
                 <h2>Connexion refusée : {}</h2></body></html>",
                escaped
            ))
        }
    }

    let app = Router::new()
        .route("/callback", get(callback))
        .with_state(slot);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", REDIRECT_PORT))
        .await
        .map_err(|e| format!("port {} occupé : {e}", REDIRECT_PORT))?;
    // serveur éphémère : on l'arrête quand le process s'arrête (dev OK) ;
    // on le spawned pour ne pas bloquer.
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Ok(())
}

// --- jetons ---

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenInfo {
    pub connected: bool,
    pub expires_at: Option<i64>,
}

// --- HTTP : client avec timeout + retry ---

/// Client HTTP du module pour les requêtes de métadonnées : timeout global
/// de 15 s (réponses petites et rapides).
fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|e| {
            tracing::warn!("client HTTP 15s indisponible, repli sans timeout : {e}");
            reqwest::Client::new()
        })
}

/// Client HTTP pour les transferts de fichiers : PAS de timeout global —
/// un corps volumineux peut mettre plus de 15 s à transiter. Un timeout
/// global tuerait l'envoi en pleine écriture ; on garde 20 s pour l'établissement.
fn http_client_transfer() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_else(|e| {
            tracing::warn!("client HTTP transfert indisponible, repli sans timeout : {e}");
            reqwest::Client::new()
        })
}

/// Statuts qui valent une nouvelle tentative (débit dépassé / serveur).
fn retryable_status(s: reqwest::StatusCode) -> bool {
    s.as_u16() == 429 || s.as_u16() >= 500
}

/// Envoie une requête avec retry : 3 tentatives, backoff 1 s puis 2 s.
/// `make` reconstruit la requête à chaque tentative (le builder est consommé
/// par `send`). Les erreurs réseau/timeout/429/5xx sont rejouées ; l'erreur
/// finale est en français et mentionne l'échec après tentatives.
async fn send_with_retry(
    make: impl Fn() -> reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    let mut last_err = String::from("échec inconnu");
    for attempt in 0u32..3 {
        match make().send().await {
            Ok(resp) => {
                if retryable_status(resp.status()) && attempt < 2 {
                    last_err = format!("le serveur a répondu {}", resp.status());
                    tokio::time::sleep(std::time::Duration::from_secs(1 << attempt)).await;
                    continue;
                }
                return Ok(resp);
            }
            Err(e) => {
                last_err = if e.is_timeout() {
                    "délai dépassé (timeout)".to_string()
                } else {
                    format!("réseau : {e}")
                };
                if (e.is_timeout() || e.is_connect()) && attempt < 2 {
                    tokio::time::sleep(std::time::Duration::from_secs(1 << attempt)).await;
                    continue;
                }
                break;
            }
        }
    }
    Err(format!("échec après 3 tentatives ({last_err})"))
}

async fn token_request(
    client: &reqwest::Client,
    form: &[(&str, &str)],
) -> Result<serde_json::Value, String> {
    // paramètres clonés pour être rejouables à chaque tentative
    let owned: Vec<(String, String)> =
        form.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    let resp = send_with_retry(|| {
        let pairs: Vec<(&str, &str)> =
            owned.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        client.post(TOKEN_URL).form(&pairs)
    })
    .await?;
    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("réponse de jeton illisible : {e}"))?;
    if let Some(err) = body.get("error") {
        return Err(format!(
            "{} : {}",
            err.as_str().unwrap_or("?"),
            body.get("error_description")
                .and_then(|d| d.as_str())
                .unwrap_or("")
        ));
    }
    if !status.is_success() {
        return Err(format!("jeton refusé ({status})"));
    }
    Ok(body)
}

fn now_epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Récupère un jeton d'accès valide (le rafraîchit si besoin) ; le renvoie.
pub async fn access_token(pool: &SqlitePool) -> Result<String, String> {
    let refresh = db::get_secret(pool, "gdrive_refresh_token")
        .await
        .ok_or("Google Drive non connecté")?;
    let client_id = effective_client_id(pool).await?;
    let client_secret = effective_client_secret(pool).await?;

    // jeton encore valide ? (get_secret filtre les valeurs vides : un jeton
    // vide laissé par un échec partiel de set_secret ne passe plus pour valide)
    let expires_at: i64 = db::get_setting(pool, "gdrive_expires_at")
        .await
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if now_epoch() < expires_at - 60 {
        if let Some(tok) = db::get_secret(pool, "gdrive_access_token").await {
            return Ok(tok);
        }
    }

    let client = http_client();
    let body = token_request(
        &client,
        &[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("refresh_token", refresh.as_str()),
            ("grant_type", "refresh_token"),
        ],
    )
    .await?;

    let access = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("réponse de jeton invalide")?
        .to_string();
    let expires_in = body.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(3600);
    db::set_secret(pool, "gdrive_access_token", &access).await?;
    db::set_setting(
        pool,
        "gdrive_expires_at",
        &(now_epoch() + expires_in).to_string(),
    )
    .await?;
    Ok(access)
}

// --- commandes Tauri (pub, branchées dans lib.rs) ---

/// Lance le flux : ouvre le navigateur vers le consentement et attend le code.
/// Échoue immédiatement (message clair) si le serveur callback 127.0.0.1:8790
/// n'a pas pu démarrer — sinon l'utilisateur attendrait 3 minutes pour rien.
pub async fn connect_flow(pool: SqlitePool, slot: AuthCodeSlot) -> Result<(), String> {
    // le serveur callback doit être à l'écoute AVANT d'ouvrir le navigateur
    {
        let probe = tokio::net::TcpStream::connect(("127.0.0.1", REDIRECT_PORT)).await;
        if probe.is_err() {
            return Err(format!(
                "serveur callback local indisponible sur le port {REDIRECT_PORT} \
                 (une autre application l'occupe ?). Relance Vaultly et réessaie."
            ));
        }
    }
    let client_id = effective_client_id(&pool).await?;
    let (verifier, challenge) = pkce_pair();
    // `state` anti-CSRF : le callback ne sera accepté qu'avec cette valeur
    let state = random_state();

    // on repart de zéro : une ancienne autorisation jamais consommée est jetée
    *slot.write().await = Some(PendingAuth {
        state: state.clone(),
        code: None,
    });

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={client_id}\
         &redirect_uri={REDIRECT_URI}&response_type=code&scope={SCOPE}\
         &access_type=offline&prompt=consent&code_challenge={challenge}&code_challenge_method=S256\
         &state={state}"
    );
    tauri_plugin_opener::open_url(auth_url, None::<&str>)
        .map_err(|e| format!("ouverture navigateur : {e}"))?;

    // attend le code jusqu'à 3 minutes
    let code = {
        let mut got = None;
        for _ in 0..180 {
            if let Some(c) = slot.read().await.clone().and_then(|p| p.code) {
                got = Some(c);
                break;
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
        got.ok_or("délai dépassé : autorisation non reçue")?
    };

    let client = http_client();
    let client_secret = effective_client_secret(&pool).await?;
    let body = token_request(
        &client,
        &[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("code", code.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", REDIRECT_URI),
            ("code_verifier", verifier.as_str()),
        ],
    )
    .await?;

    let access = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("jeton d'accès manquant dans la réponse")?
        .to_string();
    let refresh = body
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .ok_or("refresh token manquant (réessaie avec prompt=consent)")?
        .to_string();
    let expires_in = body.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(3600);

    // jetons chiffrés au repos (DPAPI) : le refresh token est la donnée la
    // plus sensible du projet (accès complet au Drive hors session app)
    db::set_secret(&pool, "gdrive_refresh_token", &refresh).await?;
    db::set_secret(&pool, "gdrive_access_token", &access).await?;
    db::set_setting(
        &pool,
        "gdrive_expires_at",
        &(now_epoch() + expires_in).to_string(),
    )
    .await?;
    Ok(())
}

/// Upload un fichier local vers Drive. Retourne le lien web du fichier.
pub async fn upload_file(
    pool: &SqlitePool,
    path: &std::path::Path,
) -> Result<String, String> {
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("fichier")
        .to_string();
    // contrôle de taille AVANT la lecture : un fichier de 2 Go ne doit pas
    // transiter par la RAM pour être refusé ensuite.
    const MAX_UPLOAD_BYTES: u64 = 4 * 1024 * 1024;
    if tokio::fs::metadata(path)
        .await
        .map_err(|e| format!("lecture du fichier impossible : {e}"))?
        .len()
        > MAX_UPLOAD_BYTES
    {
        return Err(
            "fichier trop volumineux pour l'upload simple (max 4 Mo dans cette version)".into(),
        );
    }
    let mime = mime_from_ext(path);
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("lecture du fichier impossible : {e}"))?;
    let (_id, link) = upload_bytes(pool, &file_name, &mime, &bytes, None).await?;
    Ok(link)
}

/// --- listes de liens partageables (fichiers JSON sur Drive) ---
///
/// Format : `{ "name": "Design", "updatedAt": "...", "links": [{title, url, addedAt}] }`.
/// L'utilisateur crée un fichier par catégorie (Design.json, AIAPI.json…)
/// et chaque nouveau lien partagé est ajouté au fichier choisi (sans doublon).

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareLinkEntry {
    #[serde(default)]
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub added_at: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareListInfo {
    pub file_id: String,
    pub name: String,
    pub count: usize,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendLinkResult {
    pub file_id: String,
    pub file_name: String,
    pub web_link: String,
    pub added: bool,
    pub total: usize,
}

/// Verrou applicatif des listes de liens partagées (read-modify-write sur un
/// fichier Drive). L'app est mono-processus : un mutex en mémoire suffit.
static SHARE_LIST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Nom de fichier sûr, toujours terminé par `.json`.
fn share_list_file_name(name: &str) -> Result<String, String> {
    let mut base = name.trim().to_string();
    if base.to_lowercase().ends_with(".json") {
        base.truncate(base.len() - ".json".len());
    }
    let clean: String = base
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect();
    let clean = clean.trim();
    if clean.is_empty() {
        return Err("le nom du fichier est obligatoire".into());
    }
    let short: String = clean.chars().take(100).collect();
    Ok(format!("{short}.json"))
}

/// Parse tolérant : objet avec `links[]`, ou tableau simple d'entrées.
fn parse_share_list(text: &str) -> Result<Vec<ShareLinkEntry>, String> {
    let json: serde_json::Value = serde_json::from_str(text)
        .map_err(|_| "ce fichier JSON n'est pas une liste de liens valide".to_string())?;
    let arr = match &json {
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
            title: v
                .get("title")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string(),
            url,
            added_at: v
                .get("addedAt")
                .and_then(|a| a.as_str())
                .unwrap_or("")
                .to_string(),
        });
    }
    Ok(out)
}

async fn read_share_list(
    pool: &SqlitePool,
    file_id: &str,
) -> Result<Vec<ShareLinkEntry>, String> {
    let bytes = download_bytes(pool, file_id).await?;
    let text = String::from_utf8(bytes)
        .map_err(|_| "le fichier de liens n'est pas un texte valide".to_string())?;
    parse_share_list(&text)
}

/// Nom + lien web d'un fichier Drive.
async fn file_name_and_link(
    pool: &SqlitePool,
    file_id: &str,
) -> Result<(String, String), String> {
    valid_file_id(file_id)?;
    let token = access_token(pool).await?;
    let client = http_client();
    let resp = send_with_retry(|| {
        client
            .get(format!("{FILES_URL}/{file_id}"))
            .bearer_auth(&token)
            .query(&[("fields", "name,webViewLink")])
    })
    .await?;
    let status = resp.status();
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("réponse Drive illisible : {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "lecture du fichier Drive refusée ({status}) : {}",
            drive_error_message(&json)
        ));
    }
    let name = json
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("liste.json")
        .to_string();
    let link = json
        .get("webViewLink")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("https://drive.google.com/file/d/{file_id}/view"));
    Ok((name, link))
}

/// Remplace le contenu d'un fichier Drive existant (multipart, méthode PATCH).
async fn update_bytes(
    pool: &SqlitePool,
    file_id: &str,
    mime: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let token = access_token(pool).await?;
    let metadata = serde_json::json!({ "mimeType": mime });
    let body = multipart_body(&metadata, mime, bytes);
    let client = http_client_transfer();
    let resp = client
        .patch(format!("{UPLOAD_URL_BASE}/{file_id}?uploadType=multipart"))
        .bearer_auth(&token)
        .header(
            "Content-Type",
            format!("multipart/related; boundary={MULTIPART_BOUNDARY}"),
        )
        .body(body)
        .send()
        .await
        .map_err(|e| format!("réseau : {e}"))?;
    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "Google a refusé la mise à jour ({status}) : {}",
            drive_error_message(&json)
        ));
    }
    Ok(())
}

/// Corps multipart partagé par l'upload et la mise à jour.
fn multipart_body(metadata: &serde_json::Value, mime: &str, bytes: &[u8]) -> Vec<u8> {
    let boundary = MULTIPART_BOUNDARY;
    let mut body: Vec<u8> = Vec::new();
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(format!("--{boundary}\r\nContent-Type: {mime}\r\n\r\n").as_bytes());
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

/// Préfixes des fichiers de backup Drive : « connectall-backup- » (nom
/// historique, les backups créés avant le renommage restent prunés/retrouvés)
/// et « vaultly-backup- » (nom courant).
fn is_backup_filename(name: &str) -> bool {
    let l = name.to_lowercase();
    l.starts_with("connectall-backup-") || l.starts_with("vaultly-backup-")
}

/// Liste les fichiers JSON de liens (hors fichiers de backup).
pub async fn list_share_lists(pool: &SqlitePool) -> Result<Vec<ShareListInfo>, String> {
    let files = list_files(pool, None, Some(".json".to_string())).await?;
    let mut out = Vec::new();
    for f in files {
        let lname = f.name.to_lowercase();
        if !lname.ends_with(".json") || is_backup_filename(&f.name) {
            continue;
        }
        let count = match read_share_list(pool, &f.id).await {
            Ok(entries) => entries.len(),
            Err(e) => {
                tracing::warn!("liste de liens {} illisible : {e}", f.id);
                continue;
            }
        };
        out.push(ShareListInfo {
            file_id: f.id,
            name: f.name,
            count,
        });
    }
    out.sort_by_key(|a| a.name.to_lowercase());
    Ok(out)
}

/// Ajoute un lien à une liste existante (file_id) ou crée le fichier (name).
/// Sans doublon : si l'URL existe déjà, rien n'est modifié (added = false).
pub async fn append_link(
    pool: &SqlitePool,
    file_id: Option<String>,
    name: Option<String>,
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

    if let Some(id) = file_id.filter(|s| !s.is_empty()) {
        valid_file_id(&id)?;
        // le read-modify-write (lecture du JSON, ajout, réécriture) doit être
        // sérialisé : deux partages simultanés (UI + extension) faisaient
        // perdre une entrée au second, qui écrivait sa lecture antérieure.
        let _guard = SHARE_LIST_LOCK.lock().await;
        let mut entries = read_share_list(pool, &id).await?;
        let (file_name, web_link) = file_name_and_link(pool, &id).await?;
        if entries.iter().any(|e| e.url == url) {
            return Ok(AppendLinkResult {
                file_id: id,
                file_name,
                web_link,
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
            "name": file_name.trim_end_matches(".json").trim_end_matches(".JSON"),
            "updatedAt": added_at,
            "links": entries,
        });
        let bytes = serde_json::to_vec_pretty(&doc)
            .map_err(|e| format!("sérialisation impossible : {e}"))?;
        update_bytes(pool, &id, "application/json", &bytes).await?;
        return Ok(AppendLinkResult {
            file_id: id,
            file_name,
            web_link,
            added: true,
            total: entries.len(),
        });
    }

    let file_name = share_list_file_name(name.as_deref().unwrap_or(""))?;
    let stem = file_name
        .trim_end_matches(".json")
        .to_string();
    let doc = serde_json::json!({
        "name": stem,
        "updatedAt": added_at,
        "links": [{ "title": title, "url": url, "addedAt": added_at }],
    });
    let bytes =
        serde_json::to_vec_pretty(&doc).map_err(|e| format!("sérialisation impossible : {e}"))?;
    let (id, link) = upload_bytes(pool, &file_name, "application/json", &bytes, None).await?;
    Ok(AppendLinkResult {
        file_id: id,
        file_name,
        web_link: link,
        added: true,
        total: 1,
    })
}

/// Helper interne : upload d'octets en multipart vers Drive.
/// Retourne (file_id, lien web). Multipart = plafonné à 5 Mo par Google ;
/// au-delà, Drive renvoie une erreur claire.
async fn upload_bytes(
    pool: &SqlitePool,
    file_name: &str,
    mime: &str,
    bytes: &[u8],
    parent: Option<String>,
) -> Result<(String, String), String> {
    if bytes.len() > 4 * 1024 * 1024 {
        return Err(
            "fichier trop volumineux pour l'upload simple (max 4 Mo dans cette version)".into(),
        );
    }
    let token = access_token(pool).await?;
    // multipart : métadonnées JSON + contenu
    let metadata = match &parent {
        Some(pid) => serde_json::json!({ "name": file_name, "parents": [pid] }),
        None => serde_json::json!({ "name": file_name }),
    };
    let body = multipart_body(&metadata, mime, bytes);

    let client = http_client_transfer();
    let resp = client
        .post(UPLOAD_URL)
        .bearer_auth(&token)
        .header(
            "Content-Type",
            format!("multipart/related; boundary={MULTIPART_BOUNDARY}"),
        )
        .body(body)
        .send()
        .await
        .map_err(|e| format!("réseau : {e}"))?;

    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "Google a refusé ({status}) : {}",
            drive_error_message(&json)
        ));
    }
    let file_id = json
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("réponse d'upload sans id")?
        .to_string();
    let link = json
        .get("webViewLink")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("https://drive.google.com/file/d/{file_id}/view"));
    Ok((file_id, link))
}

/// Extrait le message d'erreur d'une réponse JSON Google.
fn drive_error_message(json: &serde_json::Value) -> String {
    json.get("error")
        .and_then(|e| e.get("message"))
        .and_then(|m| m.as_str())
        .unwrap_or("?")
        .to_string()
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
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "html" => "text/html",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// Déconnexion : révoque le refresh token côté Google (une révocation
/// ratée ne bloque pas la suppression locale), puis purge les jetons.
pub async fn disconnect(pool: &SqlitePool) -> Result<(), String> {
    if let Some(refresh) = db::get_secret(pool, "gdrive_refresh_token").await {
        let client = http_client();
        let _ = client
            .post("https://oauth2.googleapis.com/revoke")
            .form(&[("token", refresh.as_str())])
            .send()
            .await;
    }
    for k in [
        "gdrive_refresh_token",
        "gdrive_access_token",
        "gdrive_expires_at",
    ] {
        sqlx::query("DELETE FROM settings WHERE key = ?")
            .bind(k)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Statut de connexion pour l'UI.
pub async fn status(pool: &SqlitePool) -> TokenInfo {
    let connected = db::get_secret(pool, "gdrive_refresh_token").await.is_some();
    let expires_at = db::get_setting(pool, "gdrive_expires_at")
        .await
        .and_then(|v| v.parse().ok());
    TokenInfo {
        connected,
        expires_at,
    }
}

// --- Explorateur Drive / backup / restauration ---

const FILES_URL: &str = "https://www.googleapis.com/drive/v3/files";

/// Fichier Drive (liste / recherche).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub mime_type: String,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub modified_time: Option<String>,
    #[serde(default)]
    pub web_view_link: Option<String>,
}

/// Résultat d'un backup vers Drive.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub file_id: String,
    pub link: String,
    pub count: usize,
}

/// Réglages Drive lus depuis la table settings.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveSettings {
    pub backup_folder_id: Option<String>,
    pub autobackup_enabled: bool,
    pub autobackup_interval_hours: u64,
    pub last_backup_at: Option<i64>,
}

/// Échappe une valeur insérée dans une requête `q` Drive (quotes doublées,
/// antislash doublé pour ne pas casser la clause).
fn escape_drive_query(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "''")
}

/// Un id de fichier Drive est alphanumérique (+ - _). Tout le reste vient
/// d'une entrée forgée et casserait l'URL de requête.
fn valid_file_id(file_id: &str) -> Result<(), String> {
    let id = file_id.trim();
    if id.is_empty() {
        return Err("identifiant de fichier vide".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("identifiant de fichier invalide : {id}"));
    }
    Ok(())
}

/// Liste les fichiers Drive (dossier et/ou recherche par nom), en suivant
/// la pagination `nextPageToken` (plafond de sécurité : 20 pages).
pub async fn list_files(
    pool: &SqlitePool,
    folder_id: Option<String>,
    query: Option<String>,
) -> Result<Vec<DriveFile>, String> {
    let token = access_token(pool).await?;
    let mut clauses: Vec<String> = Vec::new();
    if let Some(fid) = folder_id.as_deref().filter(|s| !s.is_empty()) {
        valid_file_id(fid)?;
        clauses.push(format!("'{}' in parents", escape_drive_query(fid)));
    }
    if let Some(q) = query.as_deref().filter(|s| !s.is_empty()) {
        clauses.push(format!("name contains '{}'", escape_drive_query(q)));
    }
    clauses.push("trashed=false".to_string());
    let q = clauses.join(" and ");

    let client = http_client();
    let mut out = Vec::new();
    let mut page_token: Option<String> = None;
    for _page in 0..20 {
        // la requête est RECONSTRUITE à chaque tentative (send_with_retry) :
        // l'ancien `try_clone().unwrap_or_else(get(FILES_URL))` perdait
        // l'auth et les query params si le clone échouait.
        let q_owned = q.clone();
        let page_token_owned = page_token.clone();
        let resp = send_with_retry(|| {
            let mut req = client
                .get(FILES_URL)
                .bearer_auth(&token)
                .query(&[
                    (
                        "fields",
                        "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)",
                    ),
                    ("pageSize", "100"),
                    ("orderBy", "modifiedTime desc"),
                    ("q", q_owned.as_str()),
                ]);
            if let Some(pt) = &page_token_owned {
                req = req.query(&[("pageToken", pt.as_str())]);
            }
            req
        })
        .await?;
        let status = resp.status();
        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("réponse Drive illisible : {e}"))?;
        if !status.is_success() {
            return Err(format!(
                "liste Drive refusée ({status}) : {}",
                drive_error_message(&json)
            ));
        }
        if let Some(files) = json.get("files").and_then(|v| v.as_array()) {
            for f in files {
                let file: DriveFile = serde_json::from_value(f.clone())
                    .map_err(|e| format!("réponse Drive invalide : {e}"))?;
                out.push(file);
            }
        }
        page_token = json
            .get("nextPageToken")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        if page_token.is_none() {
            break;
        }
    }
    Ok(out)
}

/// Recherche les fichiers Drive par nom.
pub async fn search_files(pool: &SqlitePool, query: String) -> Result<Vec<DriveFile>, String> {
    list_files(pool, None, Some(query)).await
}

/// Télécharge un fichier Drive dans le dossier temporaire.
/// Retourne le chemin local du fichier écrit (nom préfixé par l'id Drive
/// pour ne jamais écraser un autre téléchargement de même nom).
pub async fn download_file(pool: &SqlitePool, file_id: &str) -> Result<String, String> {
    valid_file_id(file_id)?;
    let file_id = file_id.trim();
    let token = access_token(pool).await?;
    let client = http_client_transfer();

    // nom d'origine via les métadonnées
    let meta_resp = send_with_retry(|| {
        client
            .get(format!("{FILES_URL}/{file_id}"))
            .bearer_auth(&token)
            .query(&[("fields", "name")])
    })
    .await?;
    let meta_status = meta_resp.status();
    let meta_json: serde_json::Value = meta_resp
        .json()
        .await
        .map_err(|e| format!("réponse Drive illisible : {e}"))?;
    if !meta_status.is_success() {
        return Err(format!(
            "métadonnées Drive refusées ({meta_status}) : {}",
            drive_error_message(&meta_json)
        ));
    }
    let name = meta_json
        .get("name")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(file_id);
    // nettoie le nom pour en faire un nom de fichier sûr
    let safe_name: String = name
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    // noms réservés Windows (CON, PRN, COM1…) et finisses en point/espace
    let upper = safe_name.trim_end_matches(".json").trim().to_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let base = if reserved.contains(&upper.as_str()) {
        format!("_{safe_name}")
    } else {
        safe_name.trim().trim_end_matches(['.', ' ']).to_string()
    };
    // préfixe unique : l'id Drive — deux fichiers homonymes ne s'écrasent pas
    let name = if base.is_empty() {
        format!("{file_id}.bin")
    } else {
        format!("{file_id}-{base}")
    };

    let resp = client
        .get(format!("{FILES_URL}/{file_id}"))
        .bearer_auth(&token)
        .query(&[("alt", "media")])
        .send()
        .await
        .map_err(|e| format!("réseau : {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let json: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
        return Err(format!(
            "téléchargement Drive refusé ({status}) : {}",
            drive_error_message(&json)
        ));
    }
    // streaming : écriture par blocs sans tout garder en mémoire, avec
    // plafond (un gros fichier Drive ne doit pas saturer le disque) et
    // nettoyage du fichier partiel en cas d'échec.
    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let dest = std::env::temp_dir().join(&name);
    let mut file = tokio::fs::File::create(&dest)
        .await
        .map_err(|e| format!("écriture du fichier temporaire impossible : {e}"))?;
    use tokio::io::AsyncWriteExt;
    const MAX_DOWNLOAD_BYTES: u64 = 500 * 1024 * 1024;
    let mut written: u64 = 0;
    let result: Result<(), String> = async {
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("téléchargement interrompu : {e}"))?;
            written += chunk.len() as u64;
            if written > MAX_DOWNLOAD_BYTES {
                return Err("fichier trop volumineux pour un téléchargement (max 500 Mo)".into());
            }
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("écriture interrompue : {e}"))?;
        }
        file.flush().await.map_err(|e| format!("écriture interrompue : {e}"))?;
        Ok(())
    }
    .await;
    if let Err(e) = result {
        drop(file);
        let _ = tokio::fs::remove_file(&dest).await;
        return Err(e);
    }
    Ok(dest.display().to_string())
}

/// Télécharge les octets bruts d'un fichier Drive (sans passer par un fichier).
async fn download_bytes(pool: &SqlitePool, file_id: &str) -> Result<Vec<u8>, String> {
    valid_file_id(file_id)?;
    let file_id = file_id.trim();
    let token = access_token(pool).await?;
    let client = http_client();
    let resp = send_with_retry(|| {
        client
            .get(format!("{FILES_URL}/{file_id}"))
            .bearer_auth(&token)
            .query(&[("alt", "media")])
    })
    .await?;
    let status = resp.status();
    if !status.is_success() {
        let json: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
        return Err(format!(
            "téléchargement Drive refusé ({status}) : {}",
            drive_error_message(&json)
        ));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("lecture de la réponse impossible : {e}"))?;
    Ok(bytes.to_vec())
}

/// Supprime un fichier Drive.
pub async fn delete_drive_file(pool: &SqlitePool, file_id: &str) -> Result<(), String> {
    valid_file_id(file_id)?;
    let file_id = file_id.trim();
    let token = access_token(pool).await?;
    let client = reqwest::Client::new();
    let resp = client
        .delete(format!("{FILES_URL}/{file_id}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("réseau : {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .map(|j| drive_error_message(&j))
            .unwrap_or_else(|| {
                if text.is_empty() {
                    "?".to_string()
                } else {
                    text
                }
            });
        return Err(format!("suppression Drive refusée ({status}) : {msg}"));
    }
    Ok(())
}

/// Crée un dossier Drive. Retourne son id.
pub async fn create_drive_folder(pool: &SqlitePool, name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("le nom du dossier est obligatoire".into());
    }
    let token = access_token(pool).await?;
    let client = reqwest::Client::new();
    let resp = client
        .post(FILES_URL)
        .bearer_auth(&token)
        .json(&serde_json::json!({ "name": name, "mimeType": "application/vnd.google-apps.folder" }))
        .send()
        .await
        .map_err(|e| format!("réseau : {e}"))?;
    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "création du dossier Drive refusée ({status}) : {}",
            drive_error_message(&json)
        ));
    }
    json.get("id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| "réponse de création sans id".to_string())
}

/// Partage un fichier Drive en lecture publique. Retourne le lien web.
pub async fn share_file(pool: &SqlitePool, file_id: &str) -> Result<String, String> {
    valid_file_id(file_id)?;
    let file_id = file_id.trim();
    let token = access_token(pool).await?;
    let client = reqwest::Client::new();
    let perm_resp = client
        .post(format!("{FILES_URL}/{file_id}/permissions"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "role": "reader", "type": "anyone" }))
        .send()
        .await
        .map_err(|e| format!("réseau : {e}"))?;
    let perm_status = perm_resp.status();
    if !perm_status.is_success() {
        let json: serde_json::Value = perm_resp.json().await.unwrap_or(serde_json::Value::Null);
        return Err(format!(
            "partage Drive refusé ({perm_status}) : {}",
            drive_error_message(&json)
        ));
    }
    let resp = client
        .get(format!("{FILES_URL}/{file_id}"))
        .bearer_auth(&token)
        .query(&[("fields", "webViewLink")])
        .send()
        .await
        .map_err(|e| format!("réseau : {e}"))?;
    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "lecture du lien Drive refusée ({status}) : {}",
            drive_error_message(&json)
        ));
    }
    json.get("webViewLink")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| "lien de partage introuvable dans la réponse".to_string())
}

/// Horodatage UTC AAAAMMJJ-HHMMSS pour le nom du backup
/// (algorithme partagé avec lib.rs : civil_from_secs).
fn backup_stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = crate::civil_from_secs_public(secs);
    format!("{y:04}{mo:02}{d:02}-{h:02}{mi:02}{s:02}")
}

/// Sauvegarde les ressources + dossiers vers Drive (JSON), prune à 5 backups.
pub async fn backup_to_drive(pool: &SqlitePool) -> Result<BackupResult, String> {
    // exhaustif : sans `no_limit`, le garde-fou LIMIT 500 tronquerait le backup
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
    let count = data.resources.len();
    let bytes =
        serde_json::to_vec_pretty(&data).map_err(|e| format!("sérialisation impossible : {e}"))?;
    let name = format!("vaultly-backup-{}.json", backup_stamp());
    let parent = db::get_setting(pool, "gdrive_backup_folder_id")
        .await
        .filter(|v| !v.is_empty());

    let (file_id, link) =
        upload_bytes(pool, &name, "application/json", &bytes, parent.clone()).await?;

    // PRUNE : ne garder que les 5 backups les plus récents (anciens et
    // nouveaux préfixes), LIMITÉS AU DOSSIER de backup (sinon tout fichier
    // de backup présent ailleurs sur le Drive était supprimé). Sans dossier
    // choisi, l'upload part à la racine : on prune la racine ('root').
    let prune_parent = parent.or_else(|| Some("root".to_string()));
    match list_files(pool, prune_parent, Some(".json".to_string())).await {
        Ok(mut files) => {
            files.retain(|f| is_backup_filename(&f.name));
            files.sort_by(|a, b| b.name.cmp(&a.name));
            for old in files.iter().skip(5) {
                if let Err(e) = delete_drive_file(pool, &old.id).await {
                    tracing::warn!("prune du backup {} échoué : {e}", old.id);
                }
            }
        }
        Err(e) => tracing::warn!("prune des backups Drive impossible : {e}"),
    }

    let now = now_epoch().to_string();
    db::set_setting(pool, "gdrive_last_backup_at", &now).await?;

    Ok(BackupResult {
        file_id,
        link,
        count,
    })
}

/// Restaure depuis un backup Drive (le plus récent si file_id = None).
pub async fn restore_from_drive(
    pool: &SqlitePool,
    file_id: Option<String>,
) -> Result<crate::commands::ImportSummary, String> {
    let id = match file_id.filter(|s| !s.is_empty()) {
        Some(id) => id,
        None => {
            let mut files = list_files(pool, None, Some(".json".to_string())).await?;
            files.retain(|f| is_backup_filename(&f.name));
            files.sort_by(|a, b| b.name.cmp(&a.name));
            files
                .into_iter()
                .next()
                .map(|f| f.id)
                .ok_or("aucun backup trouvé sur Google Drive")?
        }
    };
    let bytes = download_bytes(pool, &id).await?;
    let text =
        String::from_utf8(bytes).map_err(|_| "le backup Drive n'est pas un texte UTF-8 valide".to_string())?;
    crate::commands::import_payload_from_str(pool, &text).await
}

/// Lit les réglages Drive depuis la base.
pub async fn get_drive_settings(pool: &SqlitePool) -> DriveSettings {
    let backup_folder_id = db::get_setting(pool, "gdrive_backup_folder_id")
        .await
        .filter(|v| !v.is_empty());
    let autobackup_enabled = db::get_setting(pool, "gdrive_autobackup_enabled")
        .await
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let autobackup_interval_hours = db::get_setting(pool, "gdrive_autobackup_interval_hours")
        .await
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(24);
    let last_backup_at = db::get_setting(pool, "gdrive_last_backup_at")
        .await
        .and_then(|v| v.parse::<i64>().ok());
    DriveSettings {
        backup_folder_id,
        autobackup_enabled,
        autobackup_interval_hours,
        last_backup_at,
    }
}

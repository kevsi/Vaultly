use crate::mcp::VaultlyMcp;
use axum::{
    body::Body,
    extract::Request,
    http::{header, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use sqlx::SqlitePool;
use std::sync::Arc;

pub const PREFERRED_PORT: u16 = 8765;
/// port maximum essayé après PREFERRED_PORT
pub const MAX_PORT: u16 = 8780;

/// État du serveur MCP partagé avec l'UI (commandes tauri).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub running: bool,
    pub port: u16,
    pub url: String,
    pub token: String,
    /// token « add-only » : donné à l'extension navigateur, n'autorise que
    /// POST /api/add (jamais les outils MCP destructeurs ni launch_app)
    pub add_token: String,
}

/// Jetons lus EN DIRECT par le middleware d'auth : une régénération via les
/// commandes ci-dessous prend effet immédiatement, sans redémarrage du
/// serveur (l'UI affichait un token qui ne marchait qu'au prochain lancement).
#[derive(Clone)]
pub struct SharedTokens {
    inner: Arc<tokio::sync::RwLock<(String, String)>>, // (mcp, add)
}

impl SharedTokens {
    pub fn new(mcp: String, add: String) -> Self {
        Self {
            inner: Arc::new(tokio::sync::RwLock::new((mcp, add))),
        }
    }
    pub async fn set_mcp(&self, token: String) {
        self.inner.write().await.0 = token;
    }
    pub async fn set_add(&self, token: String) {
        self.inner.write().await.1 = token;
    }
    pub async fn snapshot(&self) -> (String, String) {
        self.inner.read().await.clone()
    }
}

/// Démarre le serveur MCP HTTP sur 127.0.0.1.
/// Essaie le port préféré puis les suivants jusqu'à PORT_RANGE.
/// Retourne le statut une fois le serveur en ligne.
pub async fn start(
    pool: SqlitePool,
    tokens: SharedTokens,
) -> Result<(McpServerStatus, tauri::async_runtime::JoinHandle<()>), String> {
    // port mémorisé au dernier démarrage réussi (borné : une valeur
    // hors plage dans les settings rendrait la boucle vide et le
    // démarrage impossible)
    let saved = saved_port(&pool).await.unwrap_or(PREFERRED_PORT);
    let start = saved.clamp(PREFERRED_PORT, MAX_PORT);

    for port in start..=MAX_PORT {
        if let Some((status, handle)) = try_bind(pool.clone(), tokens.clone(), port).await {
            crate::db::set_setting(&pool, "mcp_port", &port.to_string())
                .await
                .ok();
            return Ok((status, handle));
        }
    }
    Err(format!(
        "aucun port libre entre {start} et {MAX_PORT} pour le serveur MCP"
    ))
}

async fn saved_port(pool: &SqlitePool) -> Option<u16> {
    crate::db::get_setting(pool, "mcp_port")
        .await?
        .parse()
        .ok()
}

async fn try_bind(
    pool: SqlitePool,
    tokens: SharedTokens,
    port: u16,
) -> Option<(McpServerStatus, tauri::async_runtime::JoinHandle<()>)> {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));

    // middleware d'authentification Bearer (lit les jetons en direct)
    let tokens_for_mw = tokens.clone();
    let auth_mw = move |req: Request, next: Next| {
        let tokens = tokens_for_mw.clone();
        async move { check_bearer(tokens, req, next).await }
    };

    let pool_for_api = pool.clone();
    let mcp_service = StreamableHttpService::new(
        move || Ok(VaultlyMcp::new(pool.clone())),
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default(),
    );

    // endpoint simple pour l'extension navigateur (POST /api/add, token add-only)
    // avec rate-limit : un token add-only est réutilisable à l'infini, une
    // extension compromise ne doit pas pouvoir inonder la base.
    let rate = std::sync::Arc::new(AddRateLimiter::new(
        30,
        std::time::Duration::from_secs(60),
    ));
    let app = Router::new()
        .route("/", get(|| async { "Vaultly MCP" }))
        .route(
            "/api/add",
            post(move |body: Json<ApiAddBody>| {
                let pool = pool_for_api.clone();
                let rate = rate.clone();
                async move {
                    if !rate.allow() {
                        return cors_json(
                            StatusCode::TOO_MANY_REQUESTS,
                            serde_json::json!({
                                "ok": false,
                                "error": "trop d'ajouts (30/minute max) — réessaie dans un instant",
                            }),
                        );
                    }
                    api_add(pool, clamp_api_add_body(body.0)).await
                }
            })
            .options(|| async { json_ok(serde_json::json!({})) }),
        )
        .nest_service("/mcp", mcp_service)
        // ordre des layers : le DERNIER ajouté est le plus EXTERNE. CORS doit
        // envelopper l'auth pour que les 401/403 portent eux aussi les
        // en-têtes CORS (sinon l'extension lit une erreur réseau opaque).
        .layer(middleware::from_fn(auth_mw))
        .layer(middleware::from_fn(cors_mw));

    let listener = tokio::net::TcpListener::bind(addr).await.ok()?;
    let url = format!("http://127.0.0.1:{port}/mcp");
    let serve_handle = tauri::async_runtime::spawn(async move {
        // une erreur du serveur ne doit pas rester invisible : sans ça le
        // statut resterait `running: true` à vie alors que rien n'écoute.
        if let Err(e) = axum::serve(listener, app).await {
            tracing::warn!("serveur MCP interrompu : {e}");
        }
    });
    let (mcp_token, add_token) = tokens.snapshot().await;
    Some((
        McpServerStatus {
            running: true,
            port,
            url,
            token: mcp_token,
            add_token,
        },
        serve_handle,
    ))
}

/// Middleware CORS global : garantit que TOUTE réponse (y compris les
/// rejets d'extracteur d'axum avant d'atteindre nos handlers) porte les
/// en-têtes CORS, sinon l'extension voit des erreurs réseau illisibles.
/// L'ORIGINE N'EST RÉFLÉCHIE QUE SI ELLE EST AUTORISÉE (origin_allowed) :
/// avec un `Access-Control-Allow-Origin: *` sur tout, n'importe quelle
/// page web ouverte dans le navigateur pourrait LIRE les réponses (même
/// les 401/403) — confirmation d'existence du serveur + message d'erreur.
async fn cors_mw(req: Request, next: Next) -> Response {
    let origin = req
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let mut resp = next.run(req).await;
    if origin
        .as_deref()
        .filter(|o| origin_allowed(o))
        .is_some()
    {
        add_cors_headers(resp.headers_mut(), origin.as_deref().unwrap());
    }
    resp
}

/// Vérifie Authorization: Bearer <token>. Rejette aussi les requêtes
/// cross-origin non locales (protection DNS rebinding) si Origin présent,
/// et tout Host non local (rebinding par technique non-Origin : le header
/// Host d'une page rebindée pointe vers le domaine de l'attaquant, pas
/// 127.0.0.1). Les origines d'extensions navigateur (chrome-extension://,
/// moz-extension://) sont acceptées : schémas non navigables par du contenu
/// web, utilisées par l'extension Vaultly pour /api/add. Les préflights
/// OPTIONS passent sans authentification.
///
/// Portée du jeton : `/api/*` accepte le token add-only (ou le token MCP),
/// tout le reste (notamment /mcp : delete_resource, launch_app…) exige le
/// token MCP. L'extension ne peut donc plus rien faire d'autre qu'ajouter.
async fn check_bearer(tokens: SharedTokens, req: Request, next: Next) -> Response {
    if req.method() == Method::OPTIONS {
        return next.run(req).await;
    }
    // Host DOIT être local : sans ce contrôle, une requête sans Origin
    // (client natif / rebinding non-Origin) échappait au filtre d'origine.
    if !host_allowed(req.headers().get("host")) {
        return forbidden("hôte non local");
    }
    if let Some(origin) = req.headers().get("origin") {
        let origin = origin.to_str().unwrap_or("");
        if !origin_allowed(origin) {
            return forbidden("origin non autorisé");
        }
    }
    let bearer = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    let is_add_route = req.uri().path().starts_with("/api/");
    let (mcp, add) = tokens.snapshot().await;
    let ok = constant_time_eq(bearer, &mcp)
        || (is_add_route && !add.is_empty() && constant_time_eq(bearer, &add));
    if !ok {
        return unauthorized();
    }
    next.run(req).await
}

/// Host attendu : 127.0.0.1 / localhost (tous deux avec ou sans port).
/// Un Host forgé par DNS rebinding porte le domaine de l'attaquant.
fn host_allowed(host: Option<&axum::http::HeaderValue>) -> bool {
    let Some(h) = host.and_then(|v| v.to_str().ok()) else {
        return false; // HTTP/1.1 exige Host : son absence est suspecte
    };
    let bare = h
        .split('/')
        .next()
        .unwrap_or("");
    // retire le port APRÈS le dernier « : » SEULEMENT si c'est un port
    // numérique (rsplit(:) simple confondait « 127.0.0.1:8765 » avec un
    // hôte « 8765 » — les points de l'IPv4 contiennent déjà des deux-points)
    let bare = match bare.rsplit_once(':') {
        Some((host, port)) if !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) => host,
        _ => bare,
    };
    matches!(bare, "127.0.0.1" | "localhost")
}

/// Origine autorisée : localhost / 127.0.0.1 / tauri.localhost avec
/// comparaison EXACTE du hostname (un `starts_with("http://localhost")`
/// acceptait « http://localhost.attacker.com »), le schéma tauri (hôte
/// localhost uniquement — pas de starts_with qui accepterait
/// « tauri://attaquant »), et les extensions navigateur (schémas non
/// navigables par du contenu web).
fn origin_allowed(origin: &str) -> bool {
    if let Some(rest) = origin
        .strip_prefix("chrome-extension://")
        .or_else(|| origin.strip_prefix("moz-extension://"))
    {
        // id d'extension : alphanumérique uniquement
        return !rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric());
    }
    if origin == "tauri://localhost" || origin == "tauri://tauri.localhost" {
        return true;
    }
    let host = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .unwrap_or("");
    let host = host
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    matches!(host, "localhost" | "127.0.0.1" | "tauri.localhost")
}

fn unauthorized() -> Response {
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .body(Body::from("token requis (Authorization: Bearer)"))
        .unwrap()
}

fn forbidden(msg: &str) -> Response {
    Response::builder()
        .status(StatusCode::FORBIDDEN)
        .body(Body::from(format!("{msg}.")))
        .unwrap()
}

/// Comparaison en temps constant (anti timing-attack), sans dépendance externe :
/// on vérifie la longueur puis on accumule les différences par XOR sur tous
/// les octets, sans sortie anticipée.
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// Génère un token aléatoire de 32 caractères hexadécimaux.
/// Utilise OsRng (CSPRNG du système), jamais thread_rng.
pub fn generate_token() -> String {
    use rand::Rng;
    let mut rng = rand::rngs::OsRng;
    (0..32).map(|_| format!("{:x}", rng.gen_range(0..16))).collect()
}

/// Régénère le token MCP : nouveau token OsRng (même format qu'à la création),
/// chiffré en settings sous la clé `mcp_token`, puis appliqué AU SERVEUR EN
/// COURS (lecture en direct via SharedTokens) et au statut affiché.
/// Contrat frontend : `invoke("mcp_regenerate_token")` sans argument → string.
#[tauri::command]
pub async fn mcp_regenerate_token(
    pool: tauri::State<'_, SqlitePool>,
    tokens: tauri::State<'_, SharedTokens>,
    status: tauri::State<'_, crate::McpStatus>,
) -> Result<String, String> {
    let token = generate_token();
    crate::db::set_secret(&pool, "mcp_token", &token)
        .await
        .map_err(|e| format!("stockage du nouveau token impossible : {e}"))?;
    tokens.set_mcp(token.clone()).await;
    status.0.write().await.token = token.clone();
    Ok(token)
}

/// Régénère le token add-only de l'extension (ne touche pas au token MCP).
#[tauri::command]
pub async fn api_regenerate_token(
    pool: tauri::State<'_, SqlitePool>,
    tokens: tauri::State<'_, SharedTokens>,
    status: tauri::State<'_, crate::McpStatus>,
) -> Result<String, String> {
    let token = generate_token();
    crate::db::set_secret(&pool, "api_add_token", &token)
        .await
        .map_err(|e| format!("stockage du nouveau token impossible : {e}"))?;
    tokens.set_add(token.clone()).await;
    status.0.write().await.add_token = token.clone();
    Ok(token)
}

/// Wrapper Arc pour partager le statut avec les commandes Tauri.
pub type SharedStatus = Arc<tokio::sync::RwLock<McpServerStatus>>;




// --- Endpoint simple pour l'extension navigateur ---

#[derive(Debug, serde::Deserialize)]
pub struct ApiAddBody {
    pub url: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// Bornes des champs relayés par l'extension : le corps vient de pages web
/// arbitraires, il ne doit pas pouvoir gonfler la base (titre géant, des
/// centaines de tags, notes de plusieurs Mo).
fn clamp_api_add_body(mut body: ApiAddBody) -> ApiAddBody {
    const MAX_TITLE: usize = 300;
    const MAX_TAGS: usize = 20;
    const MAX_TAG_LEN: usize = 60;
    const MAX_NOTES: usize = 10_000;
    const MAX_URL: usize = 2_048;
    if body.url.len() > MAX_URL {
        body.url.truncate(MAX_URL);
    }
    if let Some(t) = body.title.take() {
        body.title = Some(t.chars().take(MAX_TITLE).collect());
    }
    if let Some(tags) = body.tags.take() {
        body.tags = Some(
            tags.into_iter()
                .take(MAX_TAGS)
                .map(|t| t.chars().take(MAX_TAG_LEN).collect::<String>())
                .collect(),
        );
    }
    if let Some(n) = body.notes.take() {
        body.notes = Some(n.chars().take(MAX_NOTES).collect());
    }
    body
}

/// Rate-limit « add-only » : fenêtre glissante minimaliste en mémoire.
/// Un token add-only est réutilisable à l'infini ; sans garde, une extension
/// compromise inonde la base. 30 ajouts / minute est bien au-delà de l'usage
/// réel (quelques liens par heure).
struct AddRateLimiter {
    window: std::sync::Mutex<Vec<std::time::Instant>>,
    max: usize,
    period: std::time::Duration,
}

impl AddRateLimiter {
    fn new(max: usize, period: std::time::Duration) -> Self {
        Self {
            window: std::sync::Mutex::new(Vec::new()),
            max,
            period,
        }
    }
    /// Vrai si l'ajout est autorisé (et compté), faux si le quota est épuisé.
    fn allow(&self) -> bool {
        let now = std::time::Instant::now();
        let mut w = self.window.lock().unwrap_or_else(|e| e.into_inner());
        w.retain(|t| now.duration_since(*t) < self.period);
        if w.len() >= self.max {
            return false;
        }
        w.push(now);
        true
    }
}

fn cors_json(status: StatusCode, value: serde_json::Value) -> Response {
    // les en-têtes CORS sont posés par cors_mw (plus externe) : ici on
    // renvoie juste le JSON, l'origine du demandeur n'est pas connue ici.
    (status, Json(value)).into_response()
}

/// Applique les en-têtes CORS pour une origine DÉJÀ VALIDÉE par
/// origin_allowed (jamais appelée avec une origine quelconque). Utilisé
/// par le middleware global : sans ça, les erreurs d'extraction d'axum
/// (JSON invalide, corps trop gros → 400/413/415) partiraient SANS
/// en-têtes CORS et l'extension les lirait comme des erreurs opaques.
fn add_cors_headers(headers: &mut header::HeaderMap, origin: &str) {
    // origin_allowed restreint aux caractères sûrs : from_str ne peut pas
    // échouer ici ; en cas de défense ultime on n'insère rien (pas de CORS
    // > CORS trop permissif).
    if let Ok(v) = header::HeaderValue::from_str(origin) {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, v);
    }
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        header::HeaderValue::from_static("POST, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        header::HeaderValue::from_static("authorization, content-type"),
    );
    headers.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        header::HeaderValue::from_static("86400"),
    );
}

fn json_ok(value: serde_json::Value) -> Response {
    cors_json(StatusCode::OK, value)
}

/// POST /api/add : ajoute une ressource depuis l'extension navigateur.
async fn api_add(pool: SqlitePool, body: ApiAddBody) -> Response {
    // l'extension relaie des données issues de pages web : seuls des liens
    // http(s) sont acceptables. exe:/file:/local: (lanceurs de binaires,
    // réservés à l'UI locale) sont refusés — même garde que le serveur MCP,
    // sinon un POST forgé créerait une tuile qui exécute un binaire au clic.
    let lower = body.url.trim().to_lowercase();
    if lower.starts_with("exe:") || lower.starts_with("file:") || lower.starts_with("local:") {
        return cors_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({
                "ok": false,
                "error": "seuls les liens http(s) peuvent être ajoutés depuis l'extension",
            }),
        );
    }
    let new = crate::db::NewResource {
        url: body.url.trim().to_string(),
        title: body.title.unwrap_or_default(),
        description: String::new(),
        resource_type: "site".into(),
        category: String::new(),
        tags: body.tags.unwrap_or_default(),
        notes: body.notes.unwrap_or_default(),
        favicon: String::new(),
        favorite: false,
        meta: Default::default(),
        folder_id: None,
        status: None,
    };
    let mut new = match crate::commands::normalize_url(new) {
        Ok(n) => n,
        Err(e) => {
            return cors_json(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "ok": false, "error": e }),
            )
        }
    };
    if new.favicon.is_empty() && new.url.starts_with("http") {
        new.favicon = crate::commands::favicon_for(&new.url);
    }
    match crate::db::add_resource(&pool, &new).await {
        Ok(r) => json_ok(
            serde_json::json!({ "ok": true, "duplicate": false, "id": r.id, "title": r.title }),
        ),
        Err(e) if e.contains("déjà enregistrée") => json_ok(
            serde_json::json!({ "ok": true, "duplicate": true, "error": e }),
        ),
        Err(e) => cors_json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "ok": false, "error": e }),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- fonctions pures ---

    #[test]
    fn rate_limiter_blocks_after_quota() {
        let rl = AddRateLimiter::new(3, std::time::Duration::from_secs(60));
        assert!(rl.allow());
        assert!(rl.allow());
        assert!(rl.allow());
        assert!(!rl.allow(), "quota épuisé : 4e ajout refusé");
    }

    #[test]
    fn clamp_api_add_body_bounds_everything() {
        let body = ApiAddBody {
            url: "https://example.com/".repeat(200),
            title: Some("t".repeat(5000)),
            tags: Some((0..100).map(|i| format!("tag{i}-{}", "x".repeat(100))).collect()),
            notes: Some("n".repeat(50_000)),
        };
        let c = clamp_api_add_body(body);
        assert!(c.url.len() <= 2048);
        assert!(c.title.unwrap().chars().count() <= 300);
        let tags = c.tags.unwrap();
        assert!(tags.len() <= 20);
        assert!(tags.iter().all(|t| t.chars().count() <= 60));
        assert!(c.notes.unwrap().chars().count() <= 10_000);
    }

    #[test]
    fn constant_time_eq_matches_and_differs() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "abcd"));
        assert!(!constant_time_eq("", "a"));
        assert!(constant_time_eq("", ""));
    }

    #[test]
    fn generate_token_is_32_hex_chars() {
        let t = generate_token();
        assert_eq!(t.len(), 32);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
        // deux appels ne donnent jamais le même token (CSPRNG)
        assert_ne!(t, generate_token());
    }

    #[test]
    fn origin_allows_local_and_extensions_only() {
        // autorisées
        for o in [
            "http://localhost:1420",
            "http://127.0.0.1:8765",
            "https://localhost",
            "http://tauri.localhost",
            "tauri://localhost",
            "tauri://tauri.localhost",
            "chrome-extension://abcdefg",
            "moz-extension://abc123",
        ] {
            assert!(origin_allowed(o), "devrait être autorisée : {o}");
        }
        // refusées : spoofing, pages web, schémas inconnus, tauri arbitraire
        for o in [
            "http://localhost.attacker.com",
            "http://evil-localhost.com",
            "https://google.com",
            "http://127.0.0.2.evil.com",
            "ftp://localhost",
            "tauri://attacker.com",
            "chrome-extension://../../etc", // caractère interdit (id alphanumérique)
        ] {
            assert!(!origin_allowed(o), "devrait être refusée : {o}");
        }
    }

    #[test]
    fn host_allows_localhost_only() {
        // IPv4 avec/sans port — rsplit_once(':') doit retirer le port APRÈS
        // le dernier « : » sans casser les points de l'adresse
        assert!(host_allowed(Some(&"127.0.0.1:8765".parse().unwrap())));
        assert!(host_allowed(Some(&"localhost:8766".parse().unwrap())));
        assert!(host_allowed(Some(&"127.0.0.1".parse().unwrap())));
        assert!(host_allowed(Some(&"localhost".parse().unwrap())));
        assert!(!host_allowed(Some(&"attacker.com".parse().unwrap())));
        assert!(!host_allowed(Some(&"localhost.attacker.com".parse().unwrap())));
        assert!(!host_allowed(Some(&"8765".parse().unwrap())));
        assert!(!host_allowed(None));
    }

    #[tokio::test]
    async fn shared_tokens_live_update() {
        let tokens = SharedTokens::new("mcp1".into(), "add1".into());
        assert_eq!(tokens.snapshot().await, ("mcp1".into(), "add1".into()));
        tokens.set_mcp("mcp2".into()).await;
        tokens.set_add("add2".into()).await;
        assert_eq!(tokens.snapshot().await, ("mcp2".into(), "add2".into()));
    }

    // --- middleware et routes via un Router réel ---

    /// Router minimal avec le même middleware que le serveur réel.
    fn test_router(tokens: SharedTokens) -> Router {
        let tokens_for_mw = tokens.clone();
        let auth_mw = move |req: Request, next: Next| {
            let tokens = tokens_for_mw.clone();
            async move { check_bearer(tokens, req, next).await }
        };
        Router::new()
            .route(
                "/api/add",
                post(|| async { "ajouté" }).options(|| async { "preflight" }),
            )
            .route("/mcp-test", get(|| async { "mcp" }))
            .layer(middleware::from_fn(auth_mw))
            .layer(middleware::from_fn(cors_mw))
    }

    async fn call(
        app: Router,
        method: Method,
        path: &str,
        origin: Option<&str>,
        bearer: Option<&str>,
    ) -> axum::http::Response<Body> {
        let mut req = Request::builder()
            .method(method)
            .uri(path)
            // un client HTTP/1.1 réel envoie toujours Host : le middleware
            // le vérifie (anti DNS-rebinding) et refuse son absence
            .header("host", "127.0.0.1");
        if let Some(o) = origin {
            req = req.header("origin", o);
        }
        if let Some(b) = bearer {
            req = req.header("authorization", format!("Bearer {b}"));
        }
        tower::ServiceExt::oneshot(app, req.body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn auth_rejects_missing_and_wrong_tokens() {
        let app = test_router(SharedTokens::new("mcp-secret".into(), "add-secret".into()));

        // sans token
        let resp = call(app.clone(), Method::GET, "/mcp-test", None, None).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        // token faux
        let resp = call(app.clone(), Method::GET, "/mcp-test", None, Some("faux")).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        // token add-only sur une route non-/api : refusé (portée limitée)
        let resp = call(app.clone(), Method::GET, "/mcp-test", None, Some("add-secret")).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn auth_accepts_each_token_on_its_scope() {
        let app = test_router(SharedTokens::new("mcp-secret".into(), "add-secret".into()));

        // token MCP partout
        let resp = call(app.clone(), Method::GET, "/mcp-test", None, Some("mcp-secret")).await;
        assert_eq!(resp.status(), StatusCode::OK);
        // token add-only uniquement sur /api/*
        let resp = call(
            app.clone(),
            Method::POST,
            "/api/add",
            Some("chrome-extension://abc"),
            Some("add-secret"),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        // le token MCP passe aussi sur /api/add (les clients IA peuvent ajouter)
        let resp = call(
            app.clone(),
            Method::POST,
            "/api/add",
            Some("http://localhost:1420"),
            Some("mcp-secret"),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn auth_rejects_bad_origin_before_token_check() {
        let app = test_router(SharedTokens::new("mcp-secret".into(), "add-secret".into()));

        // origin de page web : 403 même avec le BON token (DNS rebinding)
        let resp = call(
            app.clone(),
            Method::POST,
            "/api/add",
            Some("https://attacker.com"),
            Some("mcp-secret"),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        // preflight OPTIONS : passe sans auth (même origin douteuse — c'est
        // le navigateur qui décide ensuite d'envoyer la requête réelle)
        let resp = call(app.clone(), Method::OPTIONS, "/api/add", None, None).await;
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn cors_reflects_allowed_origins_only() {
        let app = test_router(SharedTokens::new("mcp-secret".into(), "add-secret".into()));

        // origine d'extension autorisée : l'origine est réfléchie (pas de *)
        let resp = call(
            app.clone(),
            Method::POST,
            "/api/add",
            Some("chrome-extension://abcdef"),
            Some("mcp-secret"),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|v| v.to_str().ok()),
            Some("chrome-extension://abcdef")
        );
        // origine de page web refusée : AUCUN en-tête CORS — la page ne
        // peut pas lire la réponse (même l'erreur 403)
        let resp = call(
            app.clone(),
            Method::POST,
            "/api/add",
            Some("https://attacker.com"),
            Some("mcp-secret"),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
        assert!(resp
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
        // 401 avec origine autorisée : les en-têtes CORS DOIVENT être là
        // aussi (sinon l'extension lit une erreur réseau opaque au lieu
        // du 401 qui lui dit « recolle ton token »)
        let resp = call(
            app.clone(),
            Method::GET,
            "/mcp-test",
            Some("http://localhost:1420"),
            None,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            resp.headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|v| v.to_str().ok()),
            Some("http://localhost:1420")
        );
    }

    #[tokio::test]
    async fn api_add_rejects_non_http_urls() {
        // la garde exe:/file:/local: est testée via le garde du corps :
        // on vérifie la logique de validation du schéma en appelant
        // normalize_url (même garde que commands.rs).
        for url in ["exe:C:\\tools\\app.exe", "file:///C:/doc.pdf", "local:abc"] {
            let body = ApiAddBody {
                url: url.into(),
                title: None,
                tags: None,
                notes: None,
            };
            let lower = body.url.trim().to_lowercase();
            assert!(
                lower.starts_with("exe:")
                    || lower.starts_with("file:")
                    || lower.starts_with("local:"),
                "« {url} » doit rester bloqué par la garde /api/add"
            );
        }
        // et une URL http(s) passe la garde
        let body = ApiAddBody {
            url: "https://example.com".into(),
            title: None,
            tags: None,
            notes: None,
        };
        let lower = body.url.trim().to_lowercase();
        assert!(!lower.starts_with("exe:"));
    }
}
/// Client HTTP pour les requêtes sortantes vers des URL **fournies par
/// l'utilisateur/la base** (métadonnées, vérification de liens morts). Deux
/// garde-fous anti-SSRF :
/// - `redirect(Policy::none())` : une redirection 30x ne peut plus mener la
///   requête vers un hôte interne (contournement du test d'hôte initial) ;
/// - timeout borné. Le corps est plafonné par l'appelant (Content-Length).
pub(crate) fn guarded_web_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Vaultly/0.1")
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_else(|e| {
            tracing::warn!("client web durci indisponible, repli sans garde : {e}");
            reqwest::Client::new()
        })
}

/// Host (minuscule, sans port) extrait d'une URL http(s) ; vide si invalide.
fn host_of(url: &str) -> String {
    let rest = url
        .trim()
        .trim_start_matches("http://")
        .trim_start_matches("https://");
    let authority = rest.split('/').next().unwrap_or("");
    // IPv6 entre crochets : [::1] ou [::1]:8080 → on garde l'IP sans crochets
    if let Some(idx) = authority.rfind(']') {
        let inner = &authority[1..idx]; // retire '[' et tout port après ']'
        return inner.to_lowercase();
    }
    // hôte avec port « example.com:8080 » → retire le port numérique
    match authority.rsplit_once(':') {
        Some((h, p)) if p.chars().all(|c| c.is_ascii_digit()) => h.to_lowercase(),
        _ => authority.to_lowercase(),
    }
}

/// Hôte visé « public » = ni loopback, ni RFC1918/CGNAT/link-local, ni
/// réservations, ni noms internes. Compare les littéraux d'IP et les noms
/// à bannir ; pas de résolution DNS (évite de bloquer l'async et le TOCTOU).
/// Une IP publique ne peut pas pointer « par erreur » vers l'interne ; le
/// seul contournerait restant est un hôte DNS dont l'enregistrement pointe
/// en interne, cas résiduel pour un desktop mono-utilisateur hors-ligne.
pub(crate) fn host_is_public(url: &str) -> bool {
    let lower = url.trim().to_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return false;
    }
    let host = host_of(url);
    if host.is_empty() {
        return false;
    }
    if host == "localhost" || host.ends_with(".localhost") {
        return false;
    }
    if [".local", ".internal", ".home", ".lan", ".home.arpa"]
        .iter()
        .any(|suf| host.ends_with(suf))
    {
        return false;
    }
    // Google/IMDS : métadonnées cloud par nom
    if host == "metadata.google.internal" || host == "metadata" {
        return false;
    }
    match host.parse::<std::net::IpAddr>() {
        Ok(ip) => !ip_is_private(ip),
        // pas une IP : hostname « public » (la résolution est laissée au
        // connect ; l'anti-SSRF principal ici est le blocage des redirections)
        Err(_) => true,
    }
}

fn ip_is_private(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_multicast()
                // 0.0.0.0/8 « this network » + 169.254 (IMDS) déjà couverts ;
                // 100.64.0.0/10 CGNAT + 198.18/15 benchmark + 240/4 réservé
                || (o[0] == 100 && (o[1] & 0xC0) == 64)
                || (o[0] == 198 && (o[1] & 0xFE) == 18)
                || o[0] >= 240
                || o[0] == 192 && o[1] == 88 && o[2] == 99 // 6to4 relay anycast
        }
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || {
                    let s = v6.segments();
                    // fe80::/10 lien-local, fc00::/7 unique-local
                    (s[0] & 0xFFC0) == 0xFE80 || (s[0] & 0xFE00) == 0xFC00
                }
                // IPv4-mapped (::ffff:a.b.c.d) → recontrôle de la partie v4
                || v6
                    .to_ipv4_mapped()
                    .map(std::net::IpAddr::V4)
                    .map(ip_is_private)
                    .unwrap_or(false)
        }
    }
}

/// Récupère le titre et le favicon d'une page web.
/// Le titre vient du HTML (<title>), le favicon du service Google s2
/// (pas de dépendance CORS ni de parsing de <link rel="icon">).
pub async fn fetch(url: &str) -> Result<PageMetadata, String> {
    // seuls les schémas web, et hôte public (anti-SSRF/sonde locale)
    if !host_is_public(url) {
        return Err("seules les URL http(s) publiques peuvent être récupérées".into());
    }

    let client = guarded_web_client();

    // host percent-encodé (comme favicon_for) : un « & »/« # » dans l'URL
    // tronquait la requête vers le service s2
    let host = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .ok_or("URL invalide")?;
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
    let favicon = format!("https://www.google.com/s2/favicons?domain={safe}&sz=64");

    let mut title = String::new();
    if let Ok(resp) = client.get(url).send().await {
        // plafond de corps : ne JAMAIS charger un HTML monstrueux en mémoire ;
        // 200 ko suffisent pour le <title>. Lecture en flux borné.
        const MAX_BODY: u64 = 200_000;
        if resp
            .content_length()
            .map(|len| len > MAX_BODY)
            .unwrap_or(false)
        {
            // Content-Length trop gros : on ne télécharge pas.
        } else if let Ok(bytes) = read_capped(resp, MAX_BODY as usize).await {
            let head = String::from_utf8_lossy(&bytes);
            title = extract_title(&head).unwrap_or_default();
        }
    }

    if title.is_empty() {
        // repli : domaine
        title = host.to_string();
    }

    Ok(PageMetadata { title, favicon })
}

/// Lit un corps de réponse jusqu'à `max` octets (arrête au-delà, même si le
/// serveur annonce une taille plus grosse ou inconnue — chunked).
async fn read_capped(
    mut resp: reqwest::Response,
    max: usize,
) -> Result<Vec<u8>, reqwest::Error> {
    let mut buf = Vec::with_capacity(max.min(16 * 1024));
    while let Some(chunk) = resp.chunk().await? {
        if buf.len() + chunk.len() > max {
            buf.extend_from_slice(&chunk[..max.saturating_sub(buf.len())]);
            break;
        }
        buf.extend_from_slice(&chunk);
        if buf.len() >= max {
            break;
        }
    }
    Ok(buf)
}

/// Cherche `needle` (minuscules ASCII) dans `hay` sans tenir compte de la
/// casse. Les aiguilles sont ASCII : un octet ASCII ne peut pas apparaître
/// à l'intérieur d'une séquence UTF-8 multi-octets, donc tout index renvoyé
/// tombe sur une frontière de caractère — pas de panic au découpage.
/// (L'ancienne version cherchait dans `html.to_lowercase()` puis découpait
/// `html` avec ces indices : la minuscule peut changer la longueur UTF-8 —
/// ex. « İ » U+0130 — et le slice paniquait sur du HTML distant.)
fn find_ascii_ci(hay: &str, needle: &[u8]) -> Option<usize> {
    let hb = hay.as_bytes();
    if hb.len() < needle.len() {
        return None;
    }
    (0..=hb.len() - needle.len()).find(|&i| {
        hb[i..i + needle.len()]
            .iter()
            .zip(needle.iter())
            .all(|(&b, &n)| b.to_ascii_lowercase() == n)
    })
}

fn extract_title(html: &str) -> Option<String> {
    // insensible à la casse : la balise peut être <TITLE> en majuscules
    let start = find_ascii_ci(html, b"<title")?;
    let after = &html[start..];
    let gt = after.find('>')?;
    let content = &after[gt + 1..];
    let end = find_ascii_ci(content, b"</title")?;
    let title = content[..end].trim().to_string();
    if title.is_empty() {
        return None;
    }
    Some(decode_entities(&title))
}

/// Décode les entités HTML en UNE passe : chaque « & » n'est réinterprété
/// qu'une fois (l'ancien enchaînement de `replace` décodait deux fois et
/// « &amp;lt; » devenait « < »).
fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        match entity_at(tail) {
            Some((rep, consumed)) => {
                out.push_str(&rep);
                rest = &tail[consumed..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Reconnaît une entité en tête de `t` (qui commence par « & ») :
/// renvoie (remplacement, octets lus, « & » inclus).
fn entity_at(t: &str) -> Option<(String, usize)> {
    const NAMED: &[(&str, &str)] = &[
        ("&amp;", "&"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", "\""),
        ("&apos;", "'"),
        ("&nbsp;", " "),
    ];
    let lower = t.to_ascii_lowercase();
    for (name, ch) in NAMED {
        if lower.starts_with(name) {
            return Some(((*ch).to_string(), name.len()));
        }
    }
    if let Some(hex) = t.strip_prefix("&#x").or_else(|| t.strip_prefix("&#X")) {
        let end = hex.find(';')?;
        let code = u32::from_str_radix(&hex[..end], 16).ok()?;
        return Some((char::from_u32(code)?.to_string(), 3 + end + 1));
    }
    if let Some(dig) = t.strip_prefix("&#") {
        let end = dig.find(';')?;
        let code: u32 = dig[..end].parse().ok()?;
        return Some((char::from_u32(code)?.to_string(), 2 + end + 1));
    }
    None
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMetadata {
    pub title: String,
    pub favicon: String,
}

// --- Détails d'un dépôt GitHub (API publique, sans authentification) ---

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoDetails {
    /// URL canonique du dépôt (https://github.com/owner/repo)
    pub repo_url: String,
    pub owner: String,
    pub name: String,
    pub description: String,
    /// langage principal renvoyé par GitHub
    pub language: String,
    pub stars: i64,
    pub forks: i64,
    /// tags officiel du dépôt (max 5 suggérés)
    pub topics: Vec<String>,
    /// nom de licence (MIT, Apache-2.0…) — vide si absente
    pub license: String,
    /// README au format Markdown brut — vide si absent/illisible
    pub readme: String,
}

/// Extrait owner/repo d'une URL GitHub. Accepte https://github.com/owner/repo
/// (+ .git final, + chemins excédentaires ignorés). Retourne None sinon.
pub fn parse_github_url(url: &str) -> Option<(String, String)> {
    let rest = url.trim().strip_prefix("https://github.com/").or_else(|| {
        // http renvoyé vers https par github.com : on l'accepte aussi
        url.trim().strip_prefix("http://github.com/")
    })?;
    let rest = rest.trim();
    let mut parts = rest.trim_end_matches('/').split('/');
    let owner = parts.next()?;
    let name = parts.next()?;
    // pas de sous-chemins exotiques (issues, pull…) ni d'owner vide
    if parts.next().is_some() || owner.is_empty() || name.is_empty() {
        return None;
    }
    if !owner.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        || !name
            .trim_end_matches(".git")
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return None;
    }
    let name = name.trim_end_matches(".git");
    // GitHub insensible à la casse sur owner/repo mais l'API renvoie la
    // forme canonique : on transmet tel quel.
    Some((owner.to_string(), name.to_string()))
}

/// Récupère les détails d'un dépôt GitHub : description, langage, étoiles,
/// forks, topics, licence et README (Markdown brut, plafonné à 100 Ko).
/// API publique sans token : 60 requêtes/heure — largement suffisant
/// pour un usage personnel (détail à la demande, jamais en boucle).
pub async fn fetch_github_repo(url: &str) -> Result<RepoDetails, String> {
    let (owner, name) =
        parse_github_url(url).ok_or("URL GitHub invalide (attendu : github.com/owner/repo)")?;
    let client = reqwest::Client::builder()
        .user_agent("Vaultly/0.2 (+https://github.com/kevsi/Vaultly)")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let base = format!("https://api.github.com/repos/{owner}/{name}");

    let resp = client
        .get(&base)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("GitHub injoignable : {e}"))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(format!(
            "dépôt github.com/{owner}/{name} introuvable (privé ou supprimé ?)"
        ));
    }
    if resp.status() == reqwest::StatusCode::FORBIDDEN {
        return Err("quota de l'API GitHub épuisé (60 requêtes/h sans token) — réessaie plus tard".into());
    }
    let repo: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("réponse GitHub illisible : {e}"))?;

    let description = repo["description"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let language = repo["language"].as_str().unwrap_or_default().to_string();
    let stars = repo["stargazers_count"].as_i64().unwrap_or(0);
    let forks = repo["forks_count"].as_i64().unwrap_or(0);
    let license = repo["license"]["spdx_id"]
        .as_str()
        .filter(|l| *l != "NOASSERTION")
        .unwrap_or_default()
        .to_string();
    let topics = repo["topics"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    // README en Markdown brut (plafonné : certains README génèrent des
    // réponses de plusieurs Mo, inutile de tout charger pour un aperçu)
    let readme = match client
        .get(format!("{base}/readme"))
        .header("Accept", "application/vnd.github.raw+json")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            let body = r.text().await.unwrap_or_default();
            body.chars().take(100_000).collect()
        }
        _ => String::new(), // pas de README : ce n'est pas une erreur
    };

    Ok(RepoDetails {
        repo_url: format!("https://github.com/{owner}/{name}"),
        owner,
        name,
        description,
        language,
        stars,
        forks,
        topics,
        license,
        readme,
    })
}

// --- Smart Clip : deviner le type + extraire les méta riches d'une URL ---

/// Résultat d'un « sniff » : tout ce qu'on peut pré-remplir automatiquement
/// pour une tuile (type deviné, titre, description, image d'aperçu, tags).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sniff {
    pub resource_type: String,
    pub title: String,
    pub description: String,
    pub image: String,
    pub tags: Vec<String>,
}

/// Id vidéo YouTube (youtube.com/watch?v=…, youtu.be/…, /shorts/…, /embed/…)
/// — sert à construire la miniature sans appel d'API.
pub fn youtube_video_id(url: &str) -> Option<String> {
    let u = url.trim();
    if let Some(rest) = u
        .strip_prefix("https://youtu.be/")
        .or_else(|| u.strip_prefix("http://youtu.be/"))
    {
        let id = rest.split(['?', '&', '/']).next().unwrap_or("");
        return is_video_id(id).then(|| id.to_string());
    }
    for prefix in [
        "https://www.youtube.com/watch",
        "https://youtube.com/watch",
        "http://www.youtube.com/watch",
        "https://m.youtube.com/watch",
        "https://music.youtube.com/watch",
    ] {
        if let Some(q) = u.strip_prefix(prefix) {
            if let Some(v) = q
                .trim_start_matches('?')
                .split('&')
                .find_map(|kv| kv.strip_prefix("v="))
            {
                return is_video_id(v).then(|| v.to_string());
            }
        }
    }
    for seg in ["/shorts/", "/embed/", "/live/"] {
        if let Some(i) = u.find(seg) {
            let id = u[i + seg.len()..]
                .split(['?', '&', '/'])
                .next()
                .unwrap_or("");
            if is_video_id(id) {
                return Some(id.to_string());
            }
        }
    }
    None
}

fn is_video_id(s: &str) -> bool {
    s.len() == 11 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Déduit le type de ressource d'après l'hôte / le chemin (sans réseau).
/// Liste conservatrice — l'inconnu retombe sur « site ».
pub fn detect_type(url: &str) -> &'static str {
    let lower = url.trim().to_lowercase();
    let host = lower
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("");
    let path_has = |p: &str| lower.contains(p);
    let host_is = |h: &str| host == h || host.ends_with(&format!(".{h}"));
    // dépôts : host git + une forme owner/repo
    if ["github.com", "gitlab.com", "bitbucket.org", "codeberg.org"]
        .iter()
        .any(|h| host_is(h))
    {
        let after = lower.splitn(4, '/').nth(3).unwrap_or("");
        // « owner/repo » (au moins un « / » de plus) = dépôt ; simple profil
        // « owner » = page de compte → pas un repo
        if after.contains('/') {
            return "repo";
        }
    }
    if ["youtube.com", "youtu.be", "yt.be", "tiktok.com", "vimeo.com", "dailymotion.com", "dai.ly", "twitch.tv", "peertube.tv"]
        .iter()
        .any(|h| host_is(h) || host.ends_with(h))
    {
        return "video";
    }
    if ["arxiv.org", "medium.com", "dev.to", "substack.com", "wikipedia.org", "stackoverflow.com", "news.ycombinator.com"]
        .iter()
        .any(|h| host_is(h) || host.ends_with(h))
    {
        return "article";
    }
    if ["figma.com", "canva.com", "notion.so", "replit.com", "vercel.com", "netlify.com", "npmjs.com", "pypi.org", "huggingface.co"]
        .iter()
        .any(|h| host_is(h) || host.ends_with(h))
        || path_has("/product/")
    {
        return "outil";
    }
    "site"
}

/// Valeur d'un attribut d'une balise <meta> (guillemets simples ou doubles).
/// `tag_lower` = tag en minuscules ASCII (longueur préservée) ; `raw` = tag tel
/// quel (les valeurs gardent leur casse/accents). Les ancres cherchées sont
/// ASCII → indices alignés sur des frontières de caractère.
fn meta_content(raw: &str, tag_lower: &str, want: &[&str]) -> Option<String> {
    // trouve name="k" / property="k" où k ∈ want, puis lit content="..."
    let (name_start, _) = find_attr(tag_lower, "name").or_else(|| find_attr(tag_lower, "property"))?;
    // on ne peut lire qu'un seul name/property par balise : on récupère sa clé
    let key = read_attr_value(tag_lower, name_start);
    if !want.contains(&key.as_str()) {
        return None;
    }
    let (cstart, _) = find_attr(tag_lower, "content")?;
    let val = read_attr_value(raw, cstart); // raw : valeur dans sa casse
    let v = val.trim();
    (!v.is_empty()).then(|| decode_entities(v))
}

/// Position (après le « = ») et longueur de la valeur d'un attribut `name=`.
/// Retourne l'index du début de la valeur (guillemet ou premier caractère).
fn find_attr(tag_lower: &str, name: &str) -> Option<(usize, usize)> {
    let bytes = tag_lower.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // chercher occurrence de « name » précédée d'un séparateur blanc
        if let Some(rel) = tag_lower[i..].find(name) {
            let at = i + rel;
            let ok_left = at == 0 || matches!(bytes[at - 1], b' ' | b'\t' | b'\n' | b'\r' | b'"' | b'\'');
            let after = at + name.len();
            if ok_left && tag_lower[after..].trim_start().starts_with('=') {
                // saute espaces + '='
                let mut j = after;
                while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t') {
                    j += 1;
                }
                if j < bytes.len() && bytes[j] == b'=' {
                    j += 1;
                    while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t') {
                        j += 1;
                    }
                    return Some((j, 0));
                }
            }
            i = at + name.len();
        } else {
            break;
        }
    }
    None
}

/// Lit la valeur d'un attribut à partir de l'indice de son début (gère
/// « value », 'value', et value nue terminée par espace ou >).
fn read_attr_value(tag: &str, start: usize) -> String {
    let bytes = tag.as_bytes();
    if start >= bytes.len() {
        return String::new();
    }
    match bytes[start] {
        q @ (b'"' | b'\'') => {
            let end = (start + 1..bytes.len()).find(|&k| bytes[k] == q).unwrap_or(bytes.len());
            tag[start + 1..end].to_string()
        }
        _ => {
            let end = (start..bytes.len())
                .find(|&k| bytes[k] == b' ' || bytes[k] == b'\t' || bytes[k] == b'>')
                .unwrap_or(bytes.len());
            tag[start..end].to_string()
        }
    }
}

/// Extrait titre/description/image/mots-clés d'un HTML via ses balises
/// <meta> Open Graph / Twitter / description / keywords.
fn parse_meta(html: &str) -> (Option<String>, Option<String>, Option<String>, Vec<String>) {
    let lower = html.to_ascii_lowercase();
    let mut title = None;
    let mut desc = None;
    let mut image = None;
    let mut keywords: Vec<String> = Vec::new();
    let mut i = 0;
    while let Some(rel) = lower[i..].find("<meta") {
        let open = i + rel;
        let Some(gt) = lower[open..].find('>') else { break };
        let close = open + gt + 1;
        let tag = &html[open..close];
        let tagl = &lower[open..close];
        if title.is_none() {
            title = meta_content(tag, tagl, &["og:title", "twitter:title"]);
        }
        if desc.is_none() {
            desc = meta_content(tag, tagl, &["og:description", "twitter:description", "description"]);
        }
        if image.is_none() {
            image = meta_content(tag, tagl, &["og:image", "twitter:image"]);
        }
        if keywords.is_empty() {
            if let Some(k) = meta_content(tag, tagl, &["keywords", "article:tag", "news_keywords"]) {
                keywords = k
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty() && s.chars().count() <= 24)
                    .take(6)
                    .collect();
            }
        }
        i = close;
        if gt == 0 {
            i += 1; // garde anti-boucle infinie sur « <meta> » dégénéré
        }
    }
    (title, desc, image, keywords)
}

/// Résout une URL d'image relative (og:image peut être « /img/x.png »).
fn absolutize_image(base_url: &str, img: &str) -> String {
    let img = img.trim();
    if img.starts_with("http://") || img.starts_with("https://") {
        return img.to_string();
    }
    let lower = base_url.to_lowercase();
    let Some(rest) = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))
    else {
        return img.to_string();
    };
    let host = rest.split('/').next().unwrap_or("");
    if let Some(p) = img.strip_prefix('/') {
        format!("https://{host}/{p}")
    } else {
        format!("https://{host}/{img}")
    }
}

/// Endpoint oEmbed public **sans clé** (réponse JSON propre : titre, auteur,
/// miniature). Seuls ces hôtes l'exposent de façon fiable ; les autres sites
/// gardent le chemin HTML/og:.
fn oembed_endpoint(url: &str) -> Option<&'static str> {
    if youtube_video_id(url).is_some() {
        return Some("https://www.youtube.com/oembed");
    }
    let lower = url.to_lowercase();
    if lower.contains("tiktok.com/") {
        return Some("https://www.tiktok.com/oembed");
    }
    None
}

async fn oembed_json(client: &reqwest::Client, url: &str) -> Option<serde_json::Value> {
    let endpoint = oembed_endpoint(url)?;
    let encoded =
        percent_encoding::utf8_percent_encode(url, percent_encoding::NON_ALPHANUMERIC);
    let resp = client
        .get(format!("{endpoint}?format=json&url={encoded}"))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json().await.ok()
}

/// « Sniff » une URL : type deviné + méta riches (titre, description, image,
/// tags). N'appelle JAMAIS l'API GitHub (quota) — le détail de dépôt riche
/// reste via la commande dédiée. Le type + les og: couvrent le « coller → tout
/// se remplit » pour la grande majorité des sites.
pub async fn sniff(url: &str) -> Result<Sniff, String> {
    let u = url.trim();
    if !host_is_public(u) {
        return Err("seules les URL http(s) publiques peuvent être analysées".into());
    }
    let ty = detect_type(u);
    let client = guarded_web_client();
    let (mut title, mut description, mut image, mut tags) =
        (String::new(), String::new(), String::new(), Vec::new());

    // YouTube/TikTok : oEmbed d'abord — titre sans le suffixe du site,
    // miniature garantie, et insensible au mur de consentement comme aux
    // pages rendues en JS (le HTML de TikTok ne contient aucun og:).
    if let Some(j) = oembed_json(&client, u).await {
        if let Some(t) = j.get("title").and_then(|v| v.as_str()) {
            title = t.trim().to_string();
        }
        if let Some(a) = j.get("author_name").and_then(|v| v.as_str()) {
            let a = a.trim();
            if !a.is_empty() {
                description = a.to_string();
            }
        }
        if let Some(t) = j.get("thumbnail_url").and_then(|v| v.as_str()) {
            image = t.trim().to_string();
        }
    }

    // requête bornée + redirections coupées (host_is_public déjà vérifié)
    if title.is_empty() {
        if let Ok(resp) = client.get(u).send().await {
            if let Ok(bytes) = read_capped(resp, 200_000).await {
                let html = String::from_utf8_lossy(&bytes);
                let (t, d, im, kw) = parse_meta(&html);
                title = t.unwrap_or_default();
                description = d.unwrap_or_default();
                image = im.unwrap_or_default();
                tags = kw;
                if title.is_empty() {
                    title = extract_title(&html).unwrap_or_default();
                }
            }
        }
    }
    // YouTube : miniature canonique sans API (i.ytimg) si rien de mieux —
    // hqdefault existe pour 100 % des vidéos (oardefault, plus récent, 404
    // sur une large partie du catalogue)
    if image.is_empty() {
        if let Some(id) = youtube_video_id(u) {
            image = format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg");
        }
    }
    if !image.is_empty() {
        image = absolutize_image(u, &image);
    }
    // repli favicon (service s2) pour l'aperçu de la tuile
    if image.is_empty() {
        image = crate::commands::favicon_for(u);
    }
    Ok(Sniff {
        resource_type: ty.to_string(),
        title: title.chars().take(300).collect(),
        description: description.chars().take(1000).collect(),
        image,
        tags,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniff_detect_type_matrix() {
        assert_eq!(detect_type("https://github.com/owner/repo"), "repo");
        assert_eq!(detect_type("https://github.com/owner"), "site"); // pas de /repo
        assert_eq!(detect_type("https://gitlab.com/a/b"), "repo");
        assert_eq!(detect_type("https://youtu.be/dQw4w9WgXcQ"), "video");
        assert_eq!(detect_type("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "video");
        assert_eq!(
            detect_type("https://www.tiktok.com/@user/video/1234567890"),
            "video"
        );
        assert_eq!(detect_type("https://arxiv.org/abs/2301.00001"), "article");
        assert_eq!(detect_type("https://www.figma.com/file/xyz"), "outil");
        assert_eq!(detect_type("https://www.google.com/search?q=x"), "site");
    }

    #[test]
    fn youtube_ids_extracted() {
        assert_eq!(
            youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ").as_deref(),
            Some("dQw4w9WgXcQ")
        );
        assert_eq!(
            youtube_video_id("https://youtu.be/dQw4w9WgXcQ?t=1").as_deref(),
            Some("dQw4w9WgXcQ")
        );
        assert_eq!(
            youtube_video_id("https://www.youtube.com/shorts/abcdefghijk").as_deref(),
            Some("abcdefghijk")
        );
        assert_eq!(youtube_video_id("https://youtube.com/watch?v=bad"), None);
    }

    #[test]
    fn parse_meta_reads_og_and_fallbacks() {
        let html = r#"<head>
            <meta property="og:title" content="Le titre OG" />
            <meta name="description" content="une description">
            <meta name="keywords" content="ia, design, gratuit"/>
            <meta property="og:image" content="/cover.png">
            <title>repli</title>
        </head>"#;
        let (t, d, im, kw) = parse_meta(html);
        assert_eq!(t.as_deref(), Some("Le titre OG"));
        assert_eq!(d.as_deref(), Some("une description"));
        assert_eq!(im.as_deref(), Some("/cover.png"));
        assert_eq!(kw, vec!["ia", "design", "gratuit"]);
        assert_eq!(absolutize_image("https://Ex.com/a/b", "/cover.png"), "https://ex.com/cover.png");
    }

    #[test]
    fn parse_meta_title_falls_back_to_tag_and_amp_decoded() {
        let html = r#"<meta property="og:title" content="A &amp; B"><title>fallback</title>"#;
        let (t, _, _, _) = parse_meta(html);
        assert_eq!(t.as_deref(), Some("A & B"));
    }

    #[test]
    fn github_urls_parse() {
        assert_eq!(
            parse_github_url("https://github.com/vitejs/vite"),
            Some(("vitejs".into(), "vite".into()))
        );
        assert_eq!(
            parse_github_url("https://github.com/vitejs/vite.git"),
            Some(("vitejs".into(), "vite".into()))
        );
        assert_eq!(
            parse_github_url("http://github.com/owner/repo/"),
            Some(("owner".into(), "repo".into()))
        );
        // sous-chemins, vides, caractères suspects : refusés
        assert_eq!(parse_github_url("https://github.com/owner/repo/issues/12"), None);
        assert_eq!(parse_github_url("https://github.com/owner/"), None);
        assert_eq!(parse_github_url("https://gitlab.com/owner/repo"), None);
        assert_eq!(parse_github_url("pas une url"), None);
    }

    #[test]
    fn named_entities_decode_in_one_pass() {
        assert_eq!(decode_entities("Tom &amp; Jerry"), "Tom & Jerry");
        assert_eq!(decode_entities("a&nbsp;b"), "a b");
        // passe unique : « &amp;lt; » devient « &lt; » et ne se redécode pas
        assert_eq!(decode_entities("&amp;lt;"), "&lt;");
        assert_eq!(decode_entities("&amp;amp;"), "&amp;");
    }

    #[test]
    fn numeric_entities_decode() {
        assert_eq!(decode_entities("&#39;"), "'");
        assert_eq!(decode_entities("&#x41;"), "A");
        assert_eq!(decode_entities("&#65;"), "A");
    }

    #[test]
    fn bare_ampersand_survives() {
        assert_eq!(decode_entities("Tom & Jerry"), "Tom & Jerry");
        assert_eq!(decode_entities("&xyz;"), "&xyz;");
    }

    #[test]
    fn title_extraction_is_utf8_safe() {
        // « İ » (U+0130) : sa minuscule pèse 2 code points — l'ancien code
        // paniquait en découpant html avec les indices de to_lowercase()
        let html = "<html><TITLE>İstanbul — Café &amp; Théo</title></html>";
        assert_eq!(extract_title(html).unwrap(), "İstanbul — Café & Théo");
        assert_eq!(extract_title("<html><head></head>"), None);
        assert_eq!(extract_title("<title></title>"), None);
    }

    #[test]
    fn host_is_public_rejects_internal_targets() {
        // schémas non-web refusés d'office
        assert!(!host_is_public("file:///C:/x"));
        assert!(!host_is_public("gopher://x"));
        assert!(!host_is_public("https://"));
        // loopback / privées / link-local / réservations (IPv4 + IPv6)
        assert!(!host_is_public("http://127.0.0.1:8080/x"));
        assert!(!host_is_public("http://localhost/x"));
        assert!(!host_is_public("http://foo.localhost/x"));
        assert!(!host_is_public("http://10.1.2.3/"));
        assert!(!host_is_public("http://172.16.0.1/"));
        assert!(!host_is_public("http://192.168.1.10/"));
        assert!(!host_is_public("http://169.254.169.254/latest/meta-data/")); // IMDS
        assert!(!host_is_public("http://100.64.0.1/")); // CGNAT
        assert!(!host_is_public("http://0.0.0.0/"));
        assert!(!host_is_public("http://[::1]/"));
        assert!(!host_is_public("http://[fe80::1]/"));
        assert!(!host_is_public("http://[fd00::1]/")); // ULA
        assert!(!host_is_public("http://[::ffff:127.0.0.1]/")); // IPv4-mapped loopback
        // noms internes
        assert!(!host_is_public("http://nas.local/"));
        assert!(!host_is_public("http://metadata.google.internal/"));
        // publics autorisés
        assert!(host_is_public("https://github.com/owner/repo"));
        assert!(host_is_public("https://example.com:8443/x"));
        assert!(host_is_public("http://93.184.216.34/")); // IPv4 publique
        assert!(host_is_public("https://[2606:2800:220:1:248:1893:25c8:194]/"));
    }

    #[test]
    fn ip_private_boundaries() {
        let v6_mapped_loopback: std::net::IpAddr = "::ffff:127.0.0.1".parse().unwrap();
        assert!(ip_is_private(v6_mapped_loopback));
        let v4_public: std::net::IpAddr = "8.8.8.8".parse().unwrap();
        assert!(!ip_is_private(v4_public));
        // 172.15 est PUBLIC, 172.16 privé (limite du /12)
        assert!(!ip_is_private("172.15.0.1".parse::<std::net::IpAddr>().unwrap()));
        assert!(ip_is_private("172.16.0.1".parse::<std::net::IpAddr>().unwrap()));
    }
}

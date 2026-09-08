/// Récupère le titre et le favicon d'une page web.
/// Le titre vient du HTML (<title>), le favicon du service Google s2
/// (pas de dépendance CORS ni de parsing de <link rel="icon">).
pub async fn fetch(url: &str) -> Result<PageMetadata, String> {
    // seuls les schémas web : evite qu'un schéma exotique (file:, gopher:,
    // un chemin local…) parte dans reqwest ou serve de sonde locale
    let lower = url.trim().to_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("seules les URL http(s) peuvent être récupérées".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Vaultly/0.1")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let host = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .ok_or("URL invalide")?;

    let favicon = format!("https://www.google.com/s2/favicons?domain={host}&sz=64");

    let mut title = String::new();
    if let Ok(resp) = client.get(url).send().await {
        if let Ok(body) = resp.text().await {
            // page géante : on ne garde que le début, ça suffit pour <title>
            // et ça évite un pic mémoire sur un HTML monstrueux.
            let head: String = body.chars().take(200_000).collect();
            title = extract_title(&head).unwrap_or_default();
        }
    }

    if title.is_empty() {
        // repli : domaine
        title = host.to_string();
    }

    Ok(PageMetadata { title, favicon })
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

#[cfg(test)]
mod tests {
    use super::*;

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
}

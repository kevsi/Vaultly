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

#[cfg(test)]
mod tests {
    use super::*;

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

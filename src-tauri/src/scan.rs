use rand::RngCore;
use serde::Deserialize;

/// Un favori importé depuis un navigateur (ou un fichier : HTML, CSV).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedBookmark {
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub folder: String,
    /// tags propres à la ligne (CSV) — fusionnés aux tags par défaut
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_true")]
    pub selected: bool,
}

fn default_true() -> bool {
    true
}

/// Un profil navigateur détecté sur la machine.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfile {
    pub browser: String, // "chrome" | "edge" | "firefox"
    pub name: String,    // nom du profil
    pub count: usize,    // nombre de favoris trouvés
    pub bookmarks: Vec<ImportedBookmark>,
}

fn user_data_dir(browser: &str) -> Option<std::path::PathBuf> {
    let home = std::env::var("USERPROFILE").ok()?;
    let base = match browser {
        "chrome" => "AppData/Local/Google/Chrome/User Data",
        "edge" => "AppData/Local/Microsoft/Edge/User Data",
        // Brave est basé sur Chromium : même format de fichier Bookmarks
        "brave" => "AppData/Local/BraveSoftware/Brave-Browser/User Data",
        _ => return None,
    };
    Some(std::path::PathBuf::from(home).join(base))
}

/// Détecte et lit les favoris Chrome/Edge (fichier Bookmarks JSON).
pub fn read_chromium(browser: &str) -> Vec<BrowserProfile> {
    let base = match user_data_dir(browser) {
        Some(b) => b,
        None => return vec![],
    };

    let mut out = Vec::new();
    let entries = match std::fs::read_dir(&base) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_profile = name == "Default" || name.starts_with("Profile ");
        if !is_profile {
            continue;
        }
        // Chromium sépare les favoris locaux (Bookmarks) des favoris
        // synchronisés au compte Google (AccountBookmarks) : lire les deux,
        // puis dédoublonner (la synchro compte recopie souvent les mêmes
        // favoris dans les deux fichiers).
        let mut bookmarks = Vec::new();
        for file in ["Bookmarks", "AccountBookmarks"] {
            let path = entry.path().join(file);
            let json = match std::fs::read_to_string(&path) {
                Ok(j) => j,
                Err(_) => continue,
            };
            let root: ChromiumBookmarks = match serde_json::from_str(&json) {
                Ok(r) => r,
                Err(_) => continue,
            };
            for (root_name, node) in &root.roots {
                // les clés techniques de Chromium deviennent des dossiers lisibles
                let label = match root_name.as_str() {
                    "bookmark_bar" => "Barre de favoris",
                    "other" => "Autres favoris",
                    "synced" => "Mobile",
                    other => other,
                };
                collect_chromium(node, label, &mut bookmarks, 0);
            }
        }
        let mut seen = std::collections::HashSet::new();
        bookmarks.retain(|b| seen.insert(b.url.clone()));
        let count = bookmarks.len();
        if count > 0 {
            out.push(BrowserProfile {
                browser: browser.into(),
                name,
                count,
                bookmarks,
            });
        }
    }
    out
}

fn collect_chromium(node: &ChromiumNode, folder: &str, out: &mut Vec<ImportedBookmark>, depth: u32) {
    // garde-fou : un fichier Bookmarks forgé et profondément imbriqué ne doit
    // pas faire déborder la pile (récursion → abort du process).
    if depth > 64 {
        return;
    }
    if let Some(children) = &node.children {
        for child in children {
            let child_name = child.name.clone().unwrap_or_default();
            let sub_folder = if folder.is_empty() {
                child_name
            } else {
                format!("{folder}/{child_name}")
            };
            collect_chromium(child, &sub_folder, out, depth + 1);
        }
    } else if node.url_type.as_deref() == Some("url") {
        if let Some(url) = &node.url {
            // on ne garde que le web : pas de chrome://, chrome-extension://, file://…
            if !url.starts_with("http://") && !url.starts_with("https://") {
                return;
            }
            let title = node.name.clone().unwrap_or_else(|| url.clone());
            // les racines techniques de Chrome deviennent des dossiers lisibles
            let folder_clean = folder
                .replace("Bookmarks Bar", "Barre de favoris")
                .replace("Other", "Autres favoris")
                .replace("Mobile bookmarks", "Mobile")
                .replace("//", "/");
            let folder_clean = folder_clean.trim_matches('/').to_string();
            out.push(ImportedBookmark {
                title,
                url: url.clone(),
                folder: folder_clean,
                tags: Vec::new(),
                selected: true,
            });
        }
    }
}

#[derive(Debug, Deserialize)]
struct ChromiumBookmarks {
    #[serde(default)]
    roots: std::collections::HashMap<String, ChromiumNode>,
}

#[derive(Debug, Deserialize)]
struct ChromiumNode {
    #[serde(default)]
    children: Option<Vec<ChromiumNode>>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default, rename = "type")]
    url_type: Option<String>,
}

/// Détecte et lit les favoris Firefox (places.sqlite).
pub fn read_firefox() -> Vec<BrowserProfile> {
    let home = match std::env::var("USERPROFILE") {
        Ok(h) => h,
        Err(_) => return vec![],
    };
    let profiles_root = std::path::PathBuf::from(&home)
        .join("AppData/Roaming/Mozilla/Firefox/Profiles");
    let entries = match std::fs::read_dir(&profiles_root) {
        Ok(e) => e,
        Err(_) => return vec![],
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let places = entry.path().join("places.sqlite");
        if !places.exists() {
            continue;
        }
        // Firefox verrouille places.sqlite quand il tourne : copie temporaire.
        // Le fichier -wal (write-ahead log) contient les derniers favoris non
        // encore compactés : copier les deux, sinon des favoris récents manquent.
        // Nom UNIQUE (suffixe aléatoire) : deux scans concurrents ne se
        // marchent pas sur le même fichier, et un crash ne laisse qu'une
        // copie orpheline identifiable.
        let mut rnd = [0u8; 4];
        rand::rngs::OsRng.fill_bytes(&mut rnd);
        let suffix: String = rnd.iter().map(|b| format!("{b:02x}")).collect();
        let tmp = std::env::temp_dir().join(format!(
            "vaultly-places-{}-{suffix}.sqlite",
            entry.file_name().to_string_lossy()
        ));
        let tmp_wal = tmp.with_extension("sqlite-wal");
        if std::fs::copy(&places, &tmp).is_err() {
            continue;
        }
        // le -wal n'existe pas toujours ; copier aussi le -shm si présent
        // évite une erreur de recovery sur la copie.
        let wal_src = places.with_extension("sqlite-wal");
        let _ = std::fs::copy(&wal_src, &tmp_wal);
        let shm_src = places.with_extension("sqlite-shm");
        let tmp_shm = tmp.with_extension("sqlite-shm");
        let _ = std::fs::copy(&shm_src, &tmp_shm);
        let bookmarks = read_places_sqlite(&tmp);
        let _ = std::fs::remove_file(&tmp);
        let _ = std::fs::remove_file(&tmp_wal);
        let _ = std::fs::remove_file(&tmp_shm);
        let count = bookmarks.len();
        if count > 0 {
            out.push(BrowserProfile {
                browser: "firefox".into(),
                name: entry.file_name().to_string_lossy().to_string(),
                count,
                bookmarks,
            });
        }
    }
    out
}

fn read_places_sqlite(path: &std::path::Path) -> Vec<ImportedBookmark> {
    // pas de .expect : un échec de création du runtime doit vider la liste,
    // pas paniquer la tâche de scan
    let Ok(rt) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        return vec![];
    };
    let path = path.to_path_buf();
    rt.block_on(async move {
        let url = format!("sqlite://{}", path.display());
        let pool = match sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
        {
            Ok(p) => p,
            Err(_) => return vec![],
        };
        // titre + url + dossier (nom du parent bookmark, type=2)
        let rows: Vec<(String, String, Option<String>)> = match sqlx::query_as(
            "SELECT b.title, p.url, parent.title FROM moz_bookmarks b \
             JOIN moz_places p ON b.fk = p.id \
             LEFT JOIN moz_bookmarks parent ON b.parent = parent.id AND parent.type = 2 \
             WHERE b.type = 1 AND p.url LIKE 'http%' ORDER BY p.url",
        )
        .fetch_all(&pool)
        .await
        {
            Ok(r) => r,
            Err(_) => return vec![],
        };
        pool.close().await;
        // doublons possibles dans places.sqlite (plusieurs entrées, même URL)
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for (title, url, folder) in rows {
            if !seen.insert(url.clone()) {
                continue;
            }
            out.push(ImportedBookmark {
                title: if title.is_empty() { url.clone() } else { title },
                url,
                folder: folder.unwrap_or_default(),
                tags: Vec::new(),
                selected: true,
            });
        }
        out
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brave_detection_finds_bookmarks_on_this_machine() {
        // skip si Brave n'est pas installé (test portable sur d'autres machines)
        let Some(dir) = user_data_dir("brave") else { return };
        if !dir.join("Default").join("Bookmarks").exists() {
            return;
        }
        let profiles = read_chromium("brave");
        assert!(!profiles.is_empty(), "profil Brave détecté");
        assert!(
            profiles.iter().all(|p| p.count >= 1),
            "au moins un favori lu dans le fichier Bookmarks"
        );
    }

    #[test]
    fn chrome_detection_reads_account_bookmarks_on_this_machine() {
        // Chrome peut ne stocker les favoris QUE dans AccountBookmarks
        // (favoris de compte synchronisé) — vérifie qu'on les lit.
        let Some(dir) = user_data_dir("chrome") else { return };
        let has_any = dir.join("Default").join("Bookmarks").exists()
            || dir.join("Default").join("AccountBookmarks").exists();
        if !has_any {
            return;
        }
        let profiles = read_chromium("chrome");
        assert!(!profiles.is_empty(), "profil Chrome détecté");
        let default = profiles.iter().find(|p| p.name == "Default").unwrap();
        assert!(default.count >= 1, "favoris du compte lus (AccountBookmarks)");
        // aucune URL non-web ne doit passer le filtre
        assert!(
            default
                .bookmarks
                .iter()
                .all(|b| b.url.starts_with("http://") || b.url.starts_with("https://")),
            "uniquement des URLs http(s)"
        );
    }
}

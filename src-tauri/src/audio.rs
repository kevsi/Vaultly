//! Moteur audio optionnel : yt-dlp en sidecar, téléchargé à la demande par
//! l'utilisateur (« Installer le moteur audio » dans le lecteur Musique).
//!
//! Une fois présent, il convertit n'importe quel lien vidéo supporté (YouTube,
//! TikTok, Vimeo, SoundCloud…) en URL de flux AUDIO direct que l'élément
//! <audio> lit nativement — le vrai mode « song ». Sans lui, l'app retombe
//! sur le lecteur web embarqué masqué (mode A).
//!
//! Garde-fous : l'URL à résoudre doit passer `host_is_public` (le sidecar ne
//! sonde jamais l'interne), l'exécution est bornée dans le temps, et la
//! téléchargement se limite à GitHub Releases avec taille plafonnée.

use std::io::Read as _;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[cfg(windows)]
const ENGINE_FILE: &str = "yt-dlp.exe";
#[cfg(not(windows))]
const ENGINE_FILE: &str = "yt-dlp";

#[cfg(windows)]
const ENGINE_DL_URL: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
#[cfg(not(windows))]
const ENGINE_DL_URL: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
/// Le binaire officiel pèse ~18 Mo ; au-delà, ce n'est pas ce qu'on attend.
const MAX_ENGINE_BYTES: u64 = 60 * 1_048_576;
const RESOLVE_TIMEOUT_MS: u64 = 30_000;

fn engine_dir(app: &tauri::AppHandle) -> PathBuf {
    crate::commands::resources_root_dir(app).join("Moteur audio")
}

fn engine_path(app: &tauri::AppHandle) -> PathBuf {
    engine_dir(app).join(ENGINE_FILE)
}

/// Première ligne http(s) d'une sortie yt-dlp (`-g` peut précéder des logs).
fn parse_stream_url(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with("http://") || l.starts_with("https://"))
        .map(str::to_string)
}

fn run_bounded(program: &str, args: &[&str]) -> Result<(bool, String, String), String> {
    let mut child = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("moteur audio introuvable : {e}"))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(RESOLVE_TIMEOUT_MS);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = String::new();
                let mut err = String::new();
                if let Some(so) = child.stdout.take() {
                    let _ = so.take(1_048_576).read_to_string(&mut out);
                }
                if let Some(se) = child.stderr.take() {
                    let _ = se.take(262_144).read_to_string(&mut err);
                }
                return Ok((status.success(), out, err));
            }
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("le moteur audio a mis trop de temps à répondre".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => return Err(format!("exécution du moteur impossible : {e}")),
        }
    }
}

#[tauri::command]
pub async fn audio_engine_installed(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(engine_path(&app).is_file())
}

/// Télécharge le binaire officiel (dernière release) — ~18 Mo.
#[tauri::command]
pub async fn audio_engine_install(app: tauri::AppHandle) -> Result<String, String> {
    let dir = engine_dir(&app);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("création du dossier moteur impossible : {e}"))?;
    let dest = engine_path(&app);
    // version transitoire hors du chemin cible : évite un binaire tronqué
    // visible comme « installé » en cas d'échec réseau en cours de route
    let tmp = dir.join(format!("{ENGINE_FILE}.part"));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .user_agent("Vaultly/1.0 (audio engine fetch)")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(ENGINE_DL_URL)
        .send()
        .await
        .map_err(|e| format!("téléchargement impossible : {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "GitHub a répondu {}",
            resp.status().as_u16()
        ));
    }
    let bytes = crate::webdav::read_capped(resp, MAX_ENGINE_BYTES, "moteur audio")
        .await
        .map_err(|e| format!("téléchargement du moteur impossible : {e}"))?;
    tokio::fs::write(&tmp, &bytes)
        .await
        .map_err(|e| format!("écriture impossible : {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = tokio::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755)).await;
    }
    tokio::fs::rename(&tmp, &dest)
        .await
        .map_err(|e| format!("mise en place impossible : {e}"))?;
    // version affichée = preuve que le binaire tourne réellement
    match run_bounded(&dest.to_string_lossy(), &["--version"]) {
        Ok((true, out, _)) => Ok(out.trim().to_string()),
        _ => Ok("installé".into()),
    }
}

/// Résout le flux audio pur d'une URL ; retourne l'URL directe (éphémère,
/// à jeter si l'app la garde trop longtemps — c'est un lecteur live, pas un
/// stockage).
#[tauri::command]
pub async fn audio_resolve(app: tauri::AppHandle, url: String) -> Result<String, String> {
    if !crate::metadata::host_is_public(&url) {
        return Err("lien non pris en charge".into());
    }
    let bin = engine_path(&app);
    if !bin.is_file() {
        return Err("moteur audio non installé".into());
    }
    let out = tokio::task::spawn_blocking(move || {
        run_bounded(
            &bin.to_string_lossy(),
            &["-f", "bestaudio[acodec!=none]/bestaudio/best", "-g", "--no-playlist", &url],
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    if !out.0 {
        // yt-dlp parle en anglais ; on ne le traduit pas, l'UI affiche son
        // propre message de repli + ce détail technique
        return Err(out.2.lines().last().unwrap_or("extraction impossible").to_string());
    }
    parse_stream_url(&out.1).ok_or_else(|| "aucun flux audio trouvé".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_stream_url_picks_first_http_line() {
        let stdout = "https://video.google.com/stream/a.mp4?sig=x\nhttps://autre/2\n";
        assert_eq!(
            parse_stream_url(stdout).as_deref(),
            Some("https://video.google.com/stream/a.mp4?sig=x")
        );
    }

    #[test]
    fn parse_stream_url_skips_logs() {
        let stdout = "[debug] talking\n  \nhttp://cdn.example/audio.webm\n";
        assert_eq!(
            parse_stream_url(stdout).as_deref(),
            Some("http://cdn.example/audio.webm")
        );
    }

    #[test]
    fn parse_stream_url_none_without_http() {
        assert_eq!(parse_stream_url(""), None);
        assert_eq!(parse_stream_url("WARNING: trucs\n"), None);
    }
}

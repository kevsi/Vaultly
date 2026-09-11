import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

/**
 * Mises à jour automatiques (GitHub Releases).
 * Tant que `plugins.updater.pubkey` est vide dans tauri.conf.json, la
 * vérification fonctionne mais l'installation échoue proprement
 * (signature invérifiable) — voir .github/workflows/release.yml.
 */

export async function currentVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "dev";
  }
}

/** Vérifie sans installer. null = à jour (ou vérification impossible). */
export async function checkForUpdates(): Promise<Update | null> {
  return await check();
}

/** Télécharge, installe puis redémarre l'app. */
export async function installUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}

const KEY = "vaultly-update-check";

/** Dernier contrôle silencieux il y a plus de 24 h ? */
export function updateCheckDue(): boolean {
  try {
    const last = Number(localStorage.getItem(KEY) ?? 0);
    return Date.now() - last > 24 * 3600_000;
  } catch {
    return false;
  }
}

export function markUpdateChecked(): void {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch (e) {
    // quota/accès refusé : le prochain lancement recontrôlera, rien de perdu
    console.debug("horodatage de contrôle de mise à jour non enregistré", e);
  }
}

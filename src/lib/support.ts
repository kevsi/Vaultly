import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Liens de soutien (dons). Centralisés ici : une seule source pour la
 * rubrique Réglages, la landing et le premier lancement.
 * Les URL s'ouvrent dans le navigateur externe (jamais dans la webview).
 */
const SUPPORT_SPONSORS_URL = "https://github.com/sponsors/kevsi";
const SUPPORT_KOFI_URL = "https://ko-fi.com/kevsi";

/** Ouvre la page de soutien GitHub Sponsors dans le navigateur. */
export function openSponsors(): Promise<void> {
  return openUrl(SUPPORT_SPONSORS_URL);
}

/** Ouvre la page Ko-fi (dons ponctuels) dans le navigateur. */
export function openKoFi(): Promise<void> {
  return openUrl(SUPPORT_KOFI_URL);
}

import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Lien de soutien (dons). Source unique : la rubrique Réglages, la landing
 * et le premier lancement pointent tous ici.
 * L'URL s'ouvre dans le navigateur externe (jamais dans la webview).
 */
export const SUPPORT_KOFI_URL = "https://ko-fi.com/kevroughi";

/** Ouvre la page Ko-fi (dons) dans le navigateur. */
export function openKoFi(): Promise<void> {
  return openUrl(SUPPORT_KOFI_URL);
}

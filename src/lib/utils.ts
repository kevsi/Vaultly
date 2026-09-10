import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { tt } from "@/lib/i18n";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Rend une erreur d'origine diverse lisible en UI : retire le préfixe
 * « Error: » des objets Error, garantit un message non vide et borne sa
 * longueur (les erreurs Rust peuvent porter un chemin ou une chaîne longue).
 */
export function describeError(e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e);
  msg = msg
    .replace(/^error:\s*/i, "")
    .replace(/^[A-Z]\w*Error:\s*/, "")
    .trim();
  if (!msg) return tt("Une erreur est survenue.");
  return msg.length > 200 ? `${msg.slice(0, 197)}…` : msg;
}

/**
 * Vrai si une URL WebDAV est en `http://` vers un hôte qui n'est pas
 * manifestement local (localhost, .local, IP privée). Utilisé pour avertir
 * que l'identifiant + mot de passe (Basic auth) partiraient en clair.
 */
export function isInsecureRemoteWebdav(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local"))
      return false;
    if (h === "127.0.0.1" || h === "0.0.0.0" || h === "::1") return false;
    if (h.startsWith("10.") || h.startsWith("192.168.")) return false;
    if (h.startsWith("172.")) {
      const o = Number(h.split(".")[1]);
      if (o >= 16 && o <= 31) return false;
    }
    return true;
  } catch {
    return false;
  }
}

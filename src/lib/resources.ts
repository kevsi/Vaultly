import type { Resource } from "./types";
import {
  AppWindow,
  Circle,
  FileText,
  FolderOpen,
  GitBranch,
  Globe,
  Play,
  StickyNote,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export const RESOURCE_TYPES: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "site", label: "Sites", icon: Globe },
  { value: "app", label: "Apps", icon: AppWindow },
  { value: "repo", label: "Repositories", icon: GitBranch },
  { value: "outil", label: "Outils", icon: Wrench },
  { value: "article", label: "Articles", icon: FileText },
  { value: "video", label: "Vidéos", icon: Play },
  { value: "note", label: "Notes", icon: StickyNote },
  { value: "fichier", label: "Fichiers", icon: FolderOpen },
  { value: "autre", label: "Autres", icon: Circle },
];

/** Couleurs de post-it disponibles. */
export const NOTE_COLORS: { value: string; label: string; tile: string; dot: string }[] = [
  { value: "amber", label: "Miel", tile: "bg-amber-100 text-amber-950 border-amber-200 dark:bg-amber-400/15 dark:text-amber-100 dark:border-amber-400/25", dot: "bg-amber-300" },
  { value: "rose", label: "Saumon", tile: "bg-rose-100 text-rose-950 border-rose-200 dark:bg-rose-400/15 dark:text-rose-100 dark:border-rose-400/25", dot: "bg-rose-300" },
  { value: "sky", label: "Ciel", tile: "bg-sky-100 text-sky-950 border-sky-200 dark:bg-sky-400/15 dark:text-sky-100 dark:border-sky-400/25", dot: "bg-sky-300" },
  { value: "emerald", label: "Menthe", tile: "bg-emerald-100 text-emerald-950 border-emerald-200 dark:bg-emerald-400/15 dark:text-emerald-100 dark:border-emerald-400/25", dot: "bg-emerald-300" },
  { value: "violet", label: "Lilas", tile: "bg-violet-100 text-violet-950 border-violet-200 dark:bg-violet-400/15 dark:text-violet-100 dark:border-violet-400/25", dot: "bg-violet-300" },
];

export function noteColorClass(color: string | undefined): string {
  return NOTE_COLORS.find((c) => c.value === color)?.tile ?? NOTE_COLORS[0].tile;
}

export function typeLabel(t: string): string {
  return RESOURCE_TYPES.find((r) => r.value === t)?.label ?? t;
}

export function hostOf(url: string): string {
  if (url.startsWith("file:")) return "fichier local";
  if (url.startsWith("local:")) return "sans lien";
  if (url.startsWith("exe:")) return "application";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Parse un datetime SQLite « YYYY-MM-DD HH:MM:SS » (UTC) en Date —
 *  source unique pour tout le front (tuiles, notes, stats). */
export function parseDbDate(raw: string): Date {
  return new Date(raw.replace(" ", "T") + (raw.endsWith("Z") ? "" : "Z"));
}

/** Délai (en jours) après lequel une ressource jamais ouverte est "à revisiter". */
const STALE_DAYS = 60;

/**
 * Ressource « à revisiter » : ajoutée il y a longtemps et jamais ouverte.
 * Les notes sont exclues (elles ne se "visitent" pas).
 */
export function isStale(resource: Resource): boolean {
  if (resource.resourceType === "note") return false;
  if (resource.openCount > 0) return false;
  const created = parseDbDate(resource.createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return (Date.now() - created) / 86_400_000 >= STALE_DAYS;
}

/**
 * Personnalisation de l'interface (Réglages → Apparence) :
 * - style d'ambiance (palettes : Carnet, Pro, Anime, Néon, Forêt)
 * - typographie (familles de polices système + échelle de taille)
 * - style des boutons (défaut, pilule, nets, manga, néon)
 * - arrière-plan (défaut, dégradé prêt à l'emploi, image personnelle)
 *
 * Persisté en localStorage et appliqué via des attributs `data-*` sur
 * <html> + des styles inline sur <body> — voir index.css pour les règles
 * associées (`:root[data-style=…]`, `html[data-btn=…]`, …).
 */
import { useSyncExternalStore } from "react";

export type StyleId = "carnet" | "pro" | "anime" | "neon" | "foret";
export type FontId = "systeme" | "serif" | "mono" | "techno" | "fun";
export type ButtonStyleId = "defaut" | "pill" | "net" | "manga" | "neon";
export type FontScale = "compact" | "normal" | "confort";
export type GradientId = "sakura" | "ocean" | "crepuscule" | "foret" | "neon";

export type BgState =
  | { kind: "default" }
  | { kind: "gradient"; id: GradientId }
  | { kind: "image"; image: string };

export interface Appearance {
  style: StyleId;
  font: FontId;
  fontScale: FontScale;
  buttons: ButtonStyleId;
  bg: BgState;
  /** Voile sombre sur l'arrière-plan (0 = aucun, 1 = noir opaque). */
  bgDim: number;
}

export const STYLES: {
  id: StyleId;
  label: string;
  desc: string;
  swatch: { bg: string; primary: string; accent: string };
}[] = [
  {
    id: "carnet",
    label: "Carnet",
    desc: "Chaud & doux, le style d'origine",
    swatch: { bg: "#f6f1e7", primary: "#c46a45", accent: "#efe3cf" },
  },
  {
    id: "pro",
    label: "Pro",
    desc: "Sobre & net, bleu corporate",
    swatch: { bg: "#f4f6fa", primary: "#3563e9", accent: "#dbe5f7" },
  },
  {
    id: "anime",
    label: "Anime",
    desc: "Manga : rose vif, ciel & nuit violette",
    swatch: { bg: "#fdf0f5", primary: "#ef4f8f", accent: "#bfe6f7" },
  },
  {
    id: "neon",
    label: "Néon",
    desc: "Cyberpunk : cyan électrique & magenta",
    swatch: { bg: "#141a35", primary: "#22d3ee", accent: "#e64ce0" },
  },
  {
    id: "foret",
    label: "Forêt",
    desc: "Vert nature, calme & apaisant",
    swatch: { bg: "#eef4ea", primary: "#3f7d4e", accent: "#dcead8" },
  },
];

export const FONTS: { id: FontId; label: string; stack: string }[] = [
  {
    id: "systeme",
    label: "Système",
    stack: "'Segoe UI', 'Inter', system-ui, sans-serif",
  },
  {
    id: "serif",
    label: "Serif élégant",
    stack: "Georgia, Cambria, 'Times New Roman', serif",
  },
  {
    id: "mono",
    label: "Mono / code",
    stack:
      "'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
  },
  {
    id: "techno",
    label: "Techno",
    stack: "Bahnschrift, 'Segoe UI', system-ui, sans-serif",
  },
  {
    id: "fun",
    label: "BD / fun",
    stack: "'Comic Sans MS', 'Segoe Print', 'Bradley Hand', cursive",
  },
];

export const FONT_SCALES: { id: FontScale; label: string; css: string }[] = [
  { id: "compact", label: "Compact", css: "90%" },
  { id: "normal", label: "Normal", css: "" },
  { id: "confort", label: "Confort", css: "110%" },
];

export const BUTTON_STYLES: {
  id: ButtonStyleId;
  label: string;
  desc: string;
}[] = [
  { id: "defaut", label: "Par défaut", desc: "Doux et arrondi, suit le style" },
  { id: "pill", label: "Pilule", desc: "Entièrement arrondis" },
  { id: "net", label: "Nets", desc: "Angles droits, épurés" },
  { id: "manga", label: "Manga", desc: "Contours épais + ombre décalée" },
  { id: "neon", label: "Néon", desc: "Lueur colorée autour des boutons" },
];

export const BG_GRADIENTS: { id: GradientId; label: string; css: string }[] = [
  {
    id: "sakura",
    label: "Sakura",
    css: "radial-gradient(900px 500px at 15% 0%, oklch(0.9 0.09 350 / 0.5), transparent 60%), radial-gradient(800px 500px at 85% 100%, oklch(0.88 0.07 205 / 0.45), transparent 55%)",
  },
  {
    id: "ocean",
    label: "Océan",
    css: "radial-gradient(900px 500px at 20% 0%, oklch(0.85 0.1 235 / 0.5), transparent 60%), radial-gradient(800px 500px at 80% 100%, oklch(0.85 0.09 190 / 0.45), transparent 55%)",
  },
  {
    id: "crepuscule",
    label: "Crépuscule",
    css: "radial-gradient(900px 500px at 15% 0%, oklch(0.82 0.1 60 / 0.45), transparent 60%), radial-gradient(900px 600px at 85% 100%, oklch(0.7 0.12 305 / 0.4), transparent 55%)",
  },
  {
    id: "foret",
    label: "Forêt",
    css: "radial-gradient(900px 500px at 20% 0%, oklch(0.87 0.09 150 / 0.45), transparent 60%), radial-gradient(800px 500px at 80% 100%, oklch(0.82 0.08 130 / 0.4), transparent 55%)",
  },
  {
    id: "neon",
    label: "Néon",
    css: "radial-gradient(700px 400px at 15% 0%, oklch(0.7 0.2 330 / 0.35), transparent 60%), radial-gradient(700px 400px at 85% 100%, oklch(0.75 0.15 220 / 0.3), transparent 55%)",
  },
];

const KEY = "vaultly-appearance";

const DEFAULTS: Appearance = {
  style: "carnet",
  font: "systeme",
  fontScale: "normal",
  buttons: "defaut",
  bg: { kind: "default" },
  bgDim: 0,
};

function isOneOf<T extends string>(v: unknown, ids: readonly T[]): v is T {
  return typeof v === "string" && (ids as readonly string[]).includes(v);
}

function clampDim(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Une image de fond perso est réinjectée en CSS via `url("…")`. Un
 * `localStorage` altéré (même compte) pourrait y cacher `")…` et casser la
 * fonction CSS pour y glisser des déclarations. On n'accepte qu'un data URL
 * d'image sans aucun caractère capable de sortir de l'argument `url("…")`.
 */
export function isSafeImageDataUrl(s: string): boolean {
  if (!s.startsWith("data:image/")) return false;
  // base64/URL-safe + séparés ; refus de ", ), \, et des retours/espaces de
  // contrôle qui fermeraient url("…") ou injecteraient des declarations.
  return /^[A-Za-z0-9+/=\s,;:._%-]+$/.test(s) && !/["')\\]/.test(s);
}

/** Lecture validée (champ inconnu ou corrompu → valeur par défaut). */
export function readAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as {
      style?: unknown;
      font?: unknown;
      fontScale?: unknown;
      buttons?: unknown;
      bg?: { kind?: unknown; id?: unknown; image?: unknown };
      bgDim?: unknown;
    };
    const styleIds = STYLES.map((s) => s.id);
    const fontIds = FONTS.map((f) => f.id);
    const scaleIds = FONT_SCALES.map((s) => s.id);
    const btnIds = BUTTON_STYLES.map((b) => b.id);
    const gradIds = BG_GRADIENTS.map((g) => g.id);
    let bg: BgState = { kind: "default" };
    if (p.bg?.kind === "gradient" && isOneOf(p.bg.id, gradIds)) {
      bg = { kind: "gradient", id: p.bg.id };
    } else if (
      p.bg?.kind === "image" &&
      typeof p.bg.image === "string" &&
      isSafeImageDataUrl(p.bg.image)
    ) {
      bg = { kind: "image", image: p.bg.image };
    }
    return {
      style: isOneOf(p.style, styleIds) ? p.style : DEFAULTS.style,
      font: isOneOf(p.font, fontIds) ? p.font : DEFAULTS.font,
      fontScale: isOneOf(p.fontScale, scaleIds)
        ? p.fontScale
        : DEFAULTS.fontScale,
      buttons: isOneOf(p.buttons, btnIds) ? p.buttons : DEFAULTS.buttons,
      bg,
      bgDim: clampDim(p.bgDim),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let cached: Appearance | null = null;

export function getAppearance(): Appearance {
  if (!cached) cached = readAppearance();
  return cached;
}

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => {
    l();
  });
}

export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Écriture complète : persiste, applique au DOM, notifie les abonnés. */
export function setAppearance(next: Appearance): void {
  cached = { ...next, bgDim: clampDim(next.bgDim) };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    throw new Error(
      "Arrière-plan trop lourd à enregistrer : choisis une image plus petite",
    );
  }
  applyAppearance(cached);
  emit();
}

/** Mise à jour partielle (pratique pour les réglages). */
export function updateAppearance(patch: Partial<Appearance>): void {
  setAppearance({ ...getAppearance(), ...patch });
}

/** Applique l'apparence au DOM (attributs data-* + fond du body). */
export function applyAppearance(a: Appearance): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.style = a.style;
  root.dataset.font = a.font;
  root.dataset.btn = a.buttons;
  root.style.fontSize =
    FONT_SCALES.find((s) => s.id === a.fontScale)?.css ?? "";
  // le voile ne s'applique qu'avec un arrière-plan personnalisé : sur le
  // fond uni du thème, il assombrirait toute l'interface pour rien — et une
  // valeur persistée resterait coincée (le curseur est masqué en « Défaut »)
  root.style.setProperty(
    "--bg-dim",
    a.bg.kind === "default" ? "0" : String(clampDim(a.bgDim)),
  );

  const body = document.body;
  const bg = a.bg;
  if (bg.kind === "gradient") {
    const g = BG_GRADIENTS.find((x) => x.id === bg.id);
    body.style.backgroundImage = g ? `${g.css}, var(--bg-halo)` : "";
  } else if (bg.kind === "image") {
    if (isSafeImageDataUrl(bg.image)) {
      body.style.backgroundImage = `url("${bg.image}"), var(--bg-halo)`;
    } else {
      body.style.backgroundImage = "";
    }
  } else {
    body.style.backgroundImage = "";
  }
  body.style.backgroundAttachment = "fixed";
  body.style.backgroundSize = "cover";
  body.style.backgroundPosition = "center";
}

/** Hook React : l'apparence courante, réactive aux changements. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribeAppearance, getAppearance);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Impossible de lire ce fichier"));
    r.readAsDataURL(file);
  });
}

/**
 * Convertit un fichier image en data URL stockable :
 * - PNG/GIF/WebP/SVG légers (≤ 1,5 Mo) : gardés tels quels (transparence
 *   préservée — pratique pour un logo) ;
 * - photos ou images lourdes : redimensionnées (1920 px max) + JPEG
 *   compressé pour tenir dans le quota localStorage.
 */
export async function imageFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Le fichier choisi n'est pas une image");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("Image trop lourde (8 Mo maximum)");
  }
  if (
    file.size <= 1_500_000 &&
    ["image/png", "image/gif", "image/webp", "image/svg+xml"].includes(
      file.type,
    )
  ) {
    return await readFileAsDataUrl(file);
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponible dans ce navigateur");
    // fond blanc : le JPEG ne gère pas la transparence
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    bitmap.close();
  }
}

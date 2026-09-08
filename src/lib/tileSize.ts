/**
 * Taille des tuiles de la bibliothèque (localStorage) — réglage visuel
 * distinct de la virtualisation (qui, elle, ne change que le rendu DOM).
 */

export type TileSize = "small" | "normal" | "large" | "xlarge";

export const TILE_SIZES: {
  value: TileSize;
  label: string;
  /** largeur minimale d'une tuile en px (la grille reste fluide au-dessus) */
  minPx: number;
}[] = [
  { value: "small", label: "Compact", minPx: 96 },
  { value: "normal", label: "Normal", minPx: 144 },
  { value: "large", label: "Grand", minPx: 192 },
  { value: "xlarge", label: "Très grand", minPx: 240 },
];

const KEY = "vaultly-tile-size";

export function getTileSize(): TileSize {
  const v = localStorage.getItem(KEY);
  return TILE_SIZES.some((s) => s.value === v) ? (v as TileSize) : "normal";
}

export function setTileSize(size: TileSize): void {
  localStorage.setItem(KEY, size);
  window.dispatchEvent(new CustomEvent("vaultly:tile-size-changed"));
}

export function tileMinPx(size: TileSize): number {
  return TILE_SIZES.find((s) => s.value === size)?.minPx ?? 144;
}

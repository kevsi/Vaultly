/**
 * Mode d'affichage de la bibliothèque (localStorage) :
 * - grille : tuiles (3 tailles), le mode historique
 * - liste  : lignes denses type tableau — favicon + titre + type/host +
 *   meta + ouverture, avec le menu ⋯ de la tuile et le même DnD inter-lignes
 *   que la grille en tri manuel
 */

export type TileSize = "small" | "normal" | "large";

export const TILE_SIZES: { value: TileSize; label: string; minPx: number }[] = [
  { value: "small", label: "Compact", minPx: 96 },
  { value: "normal", label: "Normal", minPx: 144 },
  { value: "large", label: "Grand", minPx: 192 },
];

export type ViewMode = "grid" | "list" | "board";

const KEY_SIZE = "vaultly-tile-size";
const KEY_VIEW = "vaultly-view-mode";

export function getTileSize(): TileSize {
  const v = localStorage.getItem(KEY_SIZE);
  return TILE_SIZES.some((s) => s.value === v) ? (v as TileSize) : "normal";
}

export function setTileSize(size: TileSize): void {
  localStorage.setItem(KEY_SIZE, size);
  window.dispatchEvent(new CustomEvent("vaultly:tile-size-changed"));
}

export function tileMinPx(size: TileSize): number {
  return TILE_SIZES.find((s) => s.value === size)?.minPx ?? 144;
}

export function getViewMode(): ViewMode {
  const v = localStorage.getItem(KEY_VIEW);
  return v === "list" ? "list" : v === "board" ? "board" : "grid";
}

export function setViewMode(mode: ViewMode): void {
  localStorage.setItem(KEY_VIEW, mode);
  window.dispatchEvent(new CustomEvent("vaultly:view-mode-changed"));
}

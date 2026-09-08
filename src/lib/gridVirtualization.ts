/**
 * Réglage de la virtualisation de la grille (localStorage) : l'utilisateur
 * choisit quand les lignes deviennent virtualisées — par défaut au-delà
 * de 120 tuiles, mais il peut l'imposer dès la première tuile ou le
 * désactiver (petites bibliothèques, drag plus « naturel »).
 */

export type VirtualMode = "always" | "auto" | "large" | "never";

export const VIRTUAL_MODES: { value: VirtualMode; label: string; description: string }[] = [
  {
    value: "always",
    label: "Toujours",
    description: "dès la première tuile (rendu le plus économe)",
  },
  {
    value: "auto",
    label: "Au-delà de 120 tuiles",
    description: "recommandé : fluide et drag naturel en dessous",
  },
  {
    value: "large",
    label: "Au-delà de 300 tuiles",
    description: "virtualisation tardive, pour les grandes fenêtres",
  },
  {
    value: "never",
    label: "Jamais",
    description: "rendu natif complet (attention aux très grandes bibliothèques)",
  },
];

const KEY = "vaultly-grid-virtualization";

export function getVirtualMode(): VirtualMode {
  const v = localStorage.getItem(KEY);
  return VIRTUAL_MODES.some((m) => m.value === v) ? (v as VirtualMode) : "auto";
}

export function setVirtualMode(mode: VirtualMode): void {
  localStorage.setItem(KEY, mode);
  // les vues ouvertes s'adaptent immédiatement (la vue Bibliothèque
  // ré-évalue son seuil sans attendre un remontage)
  window.dispatchEvent(new CustomEvent("vaultly:virtualization-changed"));
}

/** Seuil (en nombre de tuiles) au-delà duquel la grille se virtualise. */
export function virtualThresholdFor(mode: VirtualMode): number {
  switch (mode) {
    case "always":
      return 0;
    case "auto":
      return 120;
    case "large":
      return 300;
    case "never":
      return Number.POSITIVE_INFINITY;
  }
}

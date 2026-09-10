/**
 * Réglage de pagination de la grille (localStorage) : la bibliothèque est
 * paginée (plus de scroll) ; l'utilisateur choisit combien de RANGÉES de
 * tuiles tiennent sur une page. Les colonnes, elles, se calculent selon la
 * largeur disponible — le nombre de tuiles par page = colonnes × rangées.
 */

export type PageDensity = "few" | "some" | "many";

export const PAGE_DENSITIES: {
  value: PageDensity;
  label: string;
  rows: number;
  description: string;
}[] = [
  {
    value: "few",
    label: "2 rangées par page",
    rows: 2,
    description: "grandes tuiles, peu par écran",
  },
  {
    value: "some",
    label: "3 rangées par page",
    rows: 3,
    description: "recommandé : équilibre taille / densité",
  },
  {
    value: "many",
    label: "4 rangées par page",
    rows: 4,
    description: "tuiles plus petites, davantage par page",
  },
];

const KEY = "vaultly-page-density";

export function getPageDensity(): PageDensity {
  const v = localStorage.getItem(KEY);
  return PAGE_DENSITIES.some((d) => d.value === v)
    ? (v as PageDensity)
    : "some";
}

export function rowsPerPageFor(mode: PageDensity): number {
  return PAGE_DENSITIES.find((d) => d.value === mode)?.rows ?? 3;
}

export function setPageDensity(mode: PageDensity): void {
  localStorage.setItem(KEY, mode);
  // les vues ouvertes s'adaptent immédiatement sans attendre un remontage
  window.dispatchEvent(new CustomEvent("vaultly:page-density-changed"));
}

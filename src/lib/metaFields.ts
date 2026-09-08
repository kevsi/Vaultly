import type { Resource } from "./types";

/** Un champ spécifique à un type de ressource (stocké dans meta). */
export interface MetaField {
  key: string;
  label: string;
  placeholder?: string;
}

/**
 * Champs de formulaire propres à chaque type : le formulaire s'adapte
 * au type choisi (une app a un exécutable, un dépôt un langage…).
 * Ces valeurs partent dans `meta` (JSON) — ni migration ni code Rust
 * à changer pour ajouter un champ.
 */
export const META_FIELDS: Record<string, MetaField[]> = {
  app: [
    {
      key: "platform",
      label: "Plateforme",
      placeholder: "Windows, macOS, Linux, web…",
    },
  ],
  repo: [
    { key: "language", label: "Langage", placeholder: "Rust, TypeScript, Python…" },
    { key: "owner", label: "Propriétaire", placeholder: "ex : vitejs/vite" },
  ],
  outil: [
    { key: "use_case", label: "Cas d'usage", placeholder: "ex : retouche photo" },
    { key: "pricing", label: "Tarif", placeholder: "gratuit, freemium, abonnement…" },
  ],
  article: [
    { key: "author", label: "Auteur", placeholder: "nom de l'auteur" },
    { key: "status", label: "Statut de lecture", placeholder: "à lire, en cours, lu" },
  ],
  video: [
    { key: "channel", label: "Chaîne", placeholder: "nom de la chaîne" },
    { key: "status", label: "Statut", placeholder: "à regarder, vue" },
  ],
  site: [
    {
      key: "purpose",
      label: "À quoi ça sert",
      placeholder: "une phrase pour t'en souvenir",
    },
  ],
  autre: [],
};

export function metaFieldsFor(type: string): MetaField[] {
  return META_FIELDS[type] ?? [];
}

/** Résumé court des meta pour la tuile (ex : "Windows · 2.1.0"). */
export function metaSummary(resource: Resource, max = 2): string {
  const fields = metaFieldsFor(resource.resourceType);
  return fields
    .map((f) => resource.meta?.[f.key])
    .filter((v): v is string => Boolean(v))
    .slice(0, max)
    .join(" · ");
}

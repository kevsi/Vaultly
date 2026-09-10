export interface Resource {
  id: number;
  url: string;
  title: string;
  description: string;
  resourceType: string;
  category: string;
  tags: string[];
  notes: string;
  favicon: string;
  favorite: boolean;
  openCount: number;
  lastOpenedAt: string | null;
  position: number;
  /** champs spécifiques au type (platform, language, status…) */
  meta: Record<string, string>;
  /** dossier (groupement) auquel appartient la ressource, si défini */
  folderId: number | null;
  /** statut de traitement : "" = actif, "todo" = à traiter, "archived" */
  status: string;
  /** rappel « me rappeler le… » (UTC), null = aucun. Ouvrir solde le rappel. */
  remindAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Un lien mort détecté par la vérification périodique. */
export interface DeadLink {
  id: number;
  url: string;
  title: string;
  reason: string;
}

/** Un dossier : regroupe des ressources sur l'interface. */
export interface Folder {
  id: number;
  name: string;
  icon: string;
  /** dossier parent (imbrication), null = racine */
  parentId: number | null;
  position: number;
  count: number;
  /** jusqu'à 4 favicons pour la pile visuelle de la tuile */
  previewIcons: string[];
}

export interface NewResource {
  url: string;
  title: string;
  description?: string;
  resourceType?: string;
  category?: string;
  tags?: string[];
  notes?: string;
  favicon?: string;
  favorite?: boolean;
  meta?: Record<string, string>;
  status?: string;
  folderId?: number | null;
}

export interface ResourceFilter {
  query?: string;
  resourceType?: string | null;
  category?: string | null;
  tag?: string | null;
  favorite?: boolean | null;
  limit?: number | null;
  /** "recent" (défaut) | "mostUsed" | "manual" | "title" */
  sortBy?: string | null;
  /** filtrer sur un dossier précis */
  folderId?: number | null;
  /** "" = actifs, "todo" = à traiter, "archived" = archivés */
  status?: string | null;
  /** true = exclure les archivés (accueil). Ignoré si `status` explicite. */
  hideArchived?: boolean;
  /** Some(true) = seulement les ressources sans dossier */
  unfiledOnly?: boolean | null;
}

export type SortBy =
  | "recent"
  | "mostUsed"
  | "manual"
  | "title"
  | "added"
  | "oldest";

export interface ImportedBookmark {
  title: string;
  url: string;
  folder: string;
  /** tags propres à la ligne (import CSV) — fusionnés aux tags par défaut */
  tags?: string[];
  selected: boolean;
}

export interface BrowserProfile {
  browser: string;
  name: string;
  count: number;
  bookmarks: ImportedBookmark[];
}

export interface ImportReport {
  added: number;
  duplicates: number;
  errors: string[];
}

export interface McpServerStatus {
  running: boolean;
  port: number;
  url: string;
  /** token MCP (plein accès) — clients IA */
  token: string;
  /** token add-only — extension navigateur (POST /api/add uniquement) */
  addToken: string;
}

export interface PageMetadata {
  title: string;
  favicon: string;
}

/** Un fichier du cloud WebDAV (dossier fichiers/ — contrat cloud_*). */
export interface CloudFile {
  /** segment unique du nom (l'« id » WebDAV) */
  name: string;
  size: number | null;
  modified: string | null;
}

/** Un fichier JSON de liste de liens partagés sur le cloud. */
export interface ShareListInfo {
  /** nom du fichier distant (l'« id ») */
  name: string;
  /** titre interne (peut être unicode) */
  title: string;
  count: number;
}

/** Résultat de l'ajout d'un lien à une liste partagée. */
export interface AppendLinkResult {
  name: string;
  /** false = l'URL était déjà présente (aucune modification) */
  added: boolean;
  total: number;
}

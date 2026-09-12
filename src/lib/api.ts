import { invoke } from "@tauri-apps/api/core";
import type {
  AppendLinkResult,
  BrowserProfile,
  CloudFile,
  DeadLink,
  Folder,
  ImportedBookmark,
  ImportedTrack,
  ImportReport,
  McpServerStatus,
  MusicPlaylist,
  MusicPlaylistItem,
  NewResource,
  PageMetadata,
  Resource,
  ResourceFilter,
  ShareListInfo,
} from "./types";

export type { AppendLinkResult, CloudFile, DeadLink, ShareListInfo };

export async function listResources(
  filter: ResourceFilter,
): Promise<Resource[]> {
  return invoke("list_resources", { filter });
}

export async function addResource(resource: NewResource): Promise<Resource> {
  return invoke("add_resource", { resource });
}

/** Comptabilise une ouverture (compteur + dernier ouvert + rappel soldé)
 *  sans lancer le navigateur — pour les aperçus in-app (vidéos…). */
export async function recordOpen(id: number): Promise<void> {
  return invoke("record_open", { id });
}

// --- Moteur audio (yt-dlp sidecar, optionnel) ---

/** Le moteur d'extraction audio est-il présent ? */
export async function audioEngineInstalled(): Promise<boolean> {
  return invoke("audio_engine_installed");
}

/** Télécharge le moteur (dernière release yt-dlp) ; retourne sa version. */
export async function audioEngineInstall(): Promise<string> {
  return invoke("audio_engine_install");
}

/** Résout l'URL du flux AUDIO pur d'un lien vidéo (éphémère, non stockée). */
export async function audioResolve(url: string): Promise<string> {
  return invoke("audio_resolve", { url });
}

/** Énumère les pistes d'une playlist web (métadonnées seules, cap = limit). */
export async function audioImportPlaylist(
  url: string,
  limit: number,
): Promise<ImportedTrack[]> {
  return invoke("audio_import_playlist", { url, limit });
}

// --- Playlists musique locales ---

export async function listPlaylists(): Promise<MusicPlaylist[]> {
  return invoke("list_playlists");
}

export async function createPlaylist(name: string): Promise<MusicPlaylist> {
  return invoke("create_playlist", { name });
}

export async function renamePlaylist(id: number, name: string): Promise<void> {
  return invoke("rename_playlist", { id, name });
}

export async function deletePlaylist(id: number): Promise<void> {
  return invoke("delete_playlist", { id });
}

export async function listPlaylistItems(
  playlistId: number,
): Promise<MusicPlaylistItem[]> {
  return invoke("list_playlist_items", { playlistId });
}

/** Ajoute des pistes ; retourne le nombre réellement insérées (dédup URLs). */
export async function addPlaylistItems(
  playlistId: number,
  items: { url: string; title?: string; cover?: string }[],
): Promise<number> {
  return invoke("add_playlist_items", { playlistId, items });
}

export async function removePlaylistItem(itemId: number): Promise<void> {
  return invoke("remove_playlist_item", { itemId });
}

export async function updateResource(
  id: number,
  resource: NewResource,
): Promise<Resource> {
  return invoke("update_resource", { id, resource });
}

export async function deleteResource(id: number): Promise<void> {
  return invoke("delete_resource", { id });
}

export async function deleteResources(ids: number[]): Promise<number> {
  return invoke("delete_resources", { ids });
}

// --- Corbeille (suppressions restaurables pendant 30 jours) ---

export interface TrashEntry {
  trashId: number;
  resource: Resource;
  deletedAt: string;
}

export async function listTrash(): Promise<TrashEntry[]> {
  return invoke("list_trash");
}

export async function restoreTrash(trashId: number): Promise<Resource> {
  return invoke("restore_trash", { trashId });
}

/** Résultat d'une restauration en masse (restore_trash_bulk). */
interface BulkRestoreResult {
  restored: number;
  /** ids de corbeille introuvables (déjà restaurés entre-temps) */
  missing: number[];
}

export async function restoreTrashBulk(
  trashIds: number[],
): Promise<BulkRestoreResult> {
  return invoke("restore_trash_bulk", { trashIds });
}

export async function emptyTrash(): Promise<number> {
  return invoke("empty_trash");
}

// --- Archivage Wayback (liens morts) ---

interface WaybackSnapshot {
  url: string;
  /** date du snapshot au format compact AAAAMMJJhhmmss */
  timestamp: string;
}

/** Cherche une capture existante sur archive.org (aucune si null). */
export async function waybackAvailable(
  url: string,
): Promise<WaybackSnapshot | null> {
  return invoke("wayback_available", { url });
}

// --- Lancement au démarrage ---

export async function getAutostart(): Promise<boolean> {
  return invoke("get_autostart");
}

export async function setAutostart(enabled: boolean): Promise<void> {
  return invoke("set_autostart", { enabled });
}

export async function toggleFavorite(id: number): Promise<Resource> {
  return invoke("toggle_favorite", { id });
}

export async function reorderResources(ids: number[]): Promise<void> {
  return invoke("reorder_resources", { orderedIds: ids });
}

export async function allTags(): Promise<string[]> {
  return invoke("all_tags");
}

/** Tag + compteur pour le gestionnaire de tags. */
interface TagCount {
  name: string;
  count: number;
}

export async function tagStats(): Promise<TagCount[]> {
  return invoke("tag_stats");
}

/** Renomme un tag partout (fusion si le nouveau nom existe déjà).
 *  Retourne le nombre de ressources touchées. */
export async function renameTag(
  oldTag: string,
  newTag: string,
): Promise<number> {
  return invoke("rename_tag", { old: oldTag, new: newTag });
}

/** Supprime un tag de toutes les ressources. Retourne les touchées. */
export async function removeTag(tag: string): Promise<number> {
  return invoke("remove_tag", { tag });
}

export async function fetchMetadata(url: string): Promise<PageMetadata> {
  return invoke("fetch_metadata", { url });
}

/** Résultat du « Smart Clip » : type deviné + méta riches extraites. */
interface Sniffed {
  resourceType: string;
  title: string;
  description: string;
  image: string;
  tags: string[];
}

export async function sniffResource(url: string): Promise<Sniffed> {
  return invoke("sniff_resource", { url });
}

/** Détails d'un dépôt GitHub (fetch_repo_details). */
export interface RepoDetails {
  repoUrl: string;
  owner: string;
  name: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  topics: string[];
  license: string;
  readme: string;
}

export async function fetchRepoDetails(url: string): Promise<RepoDetails> {
  return invoke("fetch_repo_details", { url });
}

export async function detectBrowserProfiles(): Promise<BrowserProfile[]> {
  return invoke("detect_browser_profiles");
}

export async function importBookmarks(
  bookmarks: ImportedBookmark[],
  defaultCategory: string,
  defaultTags: string[],
): Promise<ImportReport> {
  return invoke("import_bookmarks", {
    request: { bookmarks, defaultCategory, defaultTags },
  });
}

export async function getMcpStatus(): Promise<McpServerStatus> {
  return invoke("get_mcp_status");
}

export async function mcpRegenerateToken(): Promise<string> {
  return invoke("mcp_regenerate_token");
}

/** Régénère le token add-only de l'extension (ne touche pas au token MCP). */
export async function apiRegenerateToken(): Promise<string> {
  return invoke("api_regenerate_token");
}

export async function openResourcesFolder(): Promise<string> {
  return invoke("open_resources_folder");
}

/** Message de démarrage (récupération de base) à afficher une fois, si présent. */
export async function startupNotice(): Promise<string | null> {
  return invoke("startup_notice");
}

/** Ouvre le dossier des logs dans l'Explorateur (support). */
export async function openLogsFolder(): Promise<string> {
  return invoke("open_logs_folder");
}

export async function readImageDataUrl(path: string): Promise<string> {
  return invoke("read_image_data_url", { path });
}

/** Ouvre une ressource par son id, entièrement côté Rust : la webview ne
 *  transmet plus de chemin ni d'URL (les anciennes commandes
 *  launch_executable / open_file_path acceptaient un chemin arbitraire). */
export async function openResourceById(resourceId: number): Promise<void> {
  return invoke("open_resource", { resourceId });
}

export async function listFolders(): Promise<Folder[]> {
  return invoke("list_folders");
}

export async function createFolder(
  name: string,
  icon?: string,
  parentId?: number | null,
): Promise<Folder> {
  return invoke("create_folder", { name, icon, parentId: parentId ?? null });
}

export async function renameFolder(id: number, name: string): Promise<void> {
  return invoke("rename_folder", { id, name });
}

export async function deleteFolder(id: number): Promise<number> {
  return invoke("delete_folder", { id });
}

export async function moveFolder(
  folderId: number,
  parentId: number | null,
): Promise<void> {
  return invoke("move_folder", { folderId, parentId });
}

export async function dissolveFolder(id: number): Promise<void> {
  return invoke("dissolve_folder", { id });
}

export async function setResourceStatus(
  id: number,
  status: "" | "todo" | "archived",
): Promise<void> {
  return invoke("set_resource_status", { id, status });
}

/** Pose (null = efface) un rappel « me rappeler le… » (UTC). */
export async function setRemindAt(
  id: number,
  remindAt: string | null,
): Promise<void> {
  return invoke("set_remind_at", { id, remindAt });
}

/** Rappels échus (non archivés) pour le contrôle au lancement. */
export async function dueReminders(): Promise<Resource[]> {
  return invoke("due_reminders");
}

export async function checkDeadLinks(): Promise<DeadLink[]> {
  return invoke("check_dead_links");
}

export async function setResourceFolder(
  resourceId: number,
  folderId: number | null,
): Promise<void> {
  return invoke("set_resource_folder", { resourceId, folderId });
}

export async function isUrlKnown(url: string): Promise<boolean> {
  return invoke("is_url_known", { url });
}

// --- Applications d'ouverture (navigateur + notes externes) ---

/** Une application détectée proposable (navigateur ou éditeur de notes). */
interface OpenerApp {
  id: string;
  name: string;
  path: string;
}

interface Openers {
  browsers: OpenerApp[];
  noteApps: OpenerApp[];
}

/** Chemins vides = défauts (navigateur Windows, lecteur intégré). */
interface OpenPrefs {
  browserPath: string;
  noteAppPath: string;
}

export async function detectOpeners(): Promise<Openers> {
  return invoke("detect_openers");
}

export async function getOpenPrefs(): Promise<OpenPrefs> {
  return invoke("get_open_prefs");
}

export async function setOpenPrefs(
  browserPath: string,
  noteAppPath: string,
): Promise<void> {
  return invoke("set_open_prefs", { browserPath, noteAppPath });
}

export async function exportData(path: string): Promise<number> {
  return invoke("export_data", { path });
}

interface ImportSummary {
  resourcesAdded: number;
  duplicates: number;
  foldersAdded: number;
  /** ressources refusées par la normalisation (URL invalide, schéma inconnu) */
  invalid: number;
}

export async function importData(path: string): Promise<ImportSummary> {
  return invoke("import_data", { path });
}

interface DbStats {
  total: number;
  favorites: number;
  neverOpened: number;
  byType: [string, number][];
  topUsed: Resource[];
  /** top 10 tags (« tag », nombre) */
  byTag: [string, number][];
  /** créations par mois sur 12 mois (« YYYY-MM », mois vides omis) */
  activity: [string, number][];
  /** les plus anciennes jamais ouvertes (max 8) */
  neverOpenedList: Resource[];
}

export async function getStats(): Promise<DbStats> {
  return invoke("get_stats");
}

export async function setGlobalShortcut(shortcut: string): Promise<void> {
  return invoke("set_global_shortcut", { shortcut });
}

// --- Sauvegarde cloud WebDAV (Koofr, Nextcloud, Synology…) ---

interface WebDavStatus {
  configured: boolean;
  url: string;
  autobackupEnabled: boolean;
  autobackupIntervalHours: number;
  lastBackupAt: number | null;
}

export async function webdavStatus(): Promise<WebDavStatus> {
  return invoke("webdav_status");
}

/** password vide = conserve le secret existant (ne pas le renvoyer à l'UI). */
export async function webdavSetConfig(
  url: string,
  user: string,
  password: string,
): Promise<void> {
  return invoke("webdav_set_config", { url, user, password });
}

export async function webdavClearConfig(): Promise<void> {
  return invoke("webdav_clear_config");
}

export async function webdavTestConnection(): Promise<number> {
  return invoke("webdav_test_connection");
}

export async function webdavBackup(): Promise<string> {
  return invoke("webdav_backup");
}

export async function webdavRestore(
  name?: string | null,
): Promise<ImportSummary> {
  return invoke("webdav_restore", { name: name ?? null });
}

export async function webdavSetAutobackup(
  enabled: boolean,
  intervalHours: number,
): Promise<void> {
  return invoke("webdav_set_autobackup", { enabled, intervalHours });
}

// --- Fonctions « cloud » WebDAV (explorateur, listes de liens) ---

/** Envoie un fichier local (obtenu via le sélecteur natif) vers fichiers/ ;
 *  retourne son nom distant. */
export async function cloudUploadFile(path: string): Promise<string> {
  return invoke("cloud_upload_file", { path });
}

export async function cloudListFiles(
  query?: string | null,
): Promise<CloudFile[]> {
  return invoke("cloud_list_files", { query: query ?? null });
}

/** « Joindre depuis le cloud » : rapatrie le fichier dans
 *  Documents\Vaultly\Fichiers et crée la ressource locale correspondante. */
export async function cloudImportFile(
  name: string,
): Promise<{ id: number; path: string; title: string }> {
  return invoke("cloud_import_file", { name });
}

export async function cloudListShareLists(): Promise<ShareListInfo[]> {
  return invoke("cloud_list_share_lists");
}

/** Ajoute un lien à une liste JSON du cloud (ou la crée via newListTitle). */
export async function cloudAppendLink(args: {
  name?: string | null;
  newListTitle?: string | null;
  title: string;
  url: string;
  addedAt: string;
}): Promise<AppendLinkResult> {
  return invoke("cloud_append_link", {
    name: args.name ?? null,
    newListTitle: args.newListTitle ?? null,
    title: args.title,
    url: args.url,
    addedAt: args.addedAt,
  });
}

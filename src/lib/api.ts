import { invoke } from "@tauri-apps/api/core";
import type {
  BrowserProfile,
  DeadLink,
  DriveBackupResult,
  DriveFile,
  DriveSettings,
  ShareListInfo,
  AppendLinkResult,
  Folder,
  ImportReport,
  ImportedBookmark,
  McpServerStatus,
  NewResource,
  PageMetadata,
  Resource,
  ResourceFilter,
} from "./types";

export type {
  AppendLinkResult,
  DeadLink,
  DriveBackupResult,
  DriveFile,
  DriveSettings,
  ShareListInfo,
};

export async function listResources(filter: ResourceFilter): Promise<Resource[]> {
  return invoke("list_resources", { filter });
}



export async function addResource(resource: NewResource): Promise<Resource> {
  return invoke("add_resource", { resource });
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
export interface BulkRestoreResult {
  restored: number;
  /** ids de corbeille introuvables (déjà restaurés entre-temps) */
  missing: number[];
}

export async function restoreTrashBulk(trashIds: number[]): Promise<BulkRestoreResult> {
  return invoke("restore_trash_bulk", { trashIds });
}

export async function emptyTrash(): Promise<number> {
  return invoke("empty_trash");
}

// --- Archivage Wayback (liens morts) ---

export interface WaybackSnapshot {
  url: string;
  /** date du snapshot au format compact AAAAMMJJhhmmss */
  timestamp: string;
}

/** Cherche une capture existante sur archive.org (aucune si null). */
export async function waybackAvailable(url: string): Promise<WaybackSnapshot | null> {
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

export async function recordOpen(id: number): Promise<void> {
  return invoke("record_open", { id });
}

export async function reorderResources(ids: number[]): Promise<void> {
  return invoke("reorder_resources", { orderedIds: ids });
}

export async function allTags(): Promise<string[]> {
  return invoke("all_tags");
}

export async function fetchMetadata(url: string): Promise<PageMetadata> {
  return invoke("fetch_metadata", { url });
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

export async function readImageDataUrl(path: string): Promise<string> {
  return invoke("read_image_data_url", { path });
}

export async function launchExecutable(path: string): Promise<void> {
  return invoke("launch_executable", { path });
}

export async function openFilePath(path: string): Promise<void> {
  return invoke("open_file_path", { path });
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

export async function deleteFolder(id: number): Promise<void> {
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

export async function exportData(path: string): Promise<number> {
  return invoke("export_data", { path });
}

export interface ImportSummary {
  resourcesAdded: number;
  duplicates: number;
  foldersAdded: number;
  /** ressources refusées par la normalisation (URL invalide, schéma inconnu) */
  invalid: number;
}

export async function importData(path: string): Promise<ImportSummary> {
  return invoke("import_data", { path });
}

export interface DbStats {
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

export async function gdriveConnect(): Promise<void> {
  return invoke("gdrive_connect");
}

export async function gdriveDisconnect(): Promise<void> {
  return invoke("gdrive_disconnect");
}

export async function gdriveUpload(path?: string): Promise<string> {
  return invoke("gdrive_upload", { path: path ?? null });
}

export async function gdriveListFiles(
  folderId?: string | null,
  query?: string | null,
): Promise<DriveFile[]> {
  return invoke("gdrive_list_files", {
    folderId: folderId ?? null,
    query: query ?? null,
  });
}

export async function gdriveSearchFiles(query: string): Promise<DriveFile[]> {
  return invoke("gdrive_search_files", { query });
}

export interface GdriveTokenInfo {
  connected: boolean;
  expiresAt: number | null;
}

export async function gdriveStatus(): Promise<GdriveTokenInfo> {
  return invoke("gdrive_status");
}

export async function gdriveDownload(fileId: string): Promise<string> {
  return invoke("gdrive_download", { fileId });
}

export async function gdriveDeleteFile(fileId: string): Promise<void> {
  return invoke("gdrive_delete_file", { fileId });
}

export async function gdriveCreateFolder(name: string): Promise<string> {
  return invoke("gdrive_create_folder", { name });
}

export async function gdriveShareFile(fileId: string): Promise<string> {
  return invoke("gdrive_share_file", { fileId });
}

export async function gdriveListShareLists(): Promise<ShareListInfo[]> {
  return invoke("gdrive_list_share_lists");
}

export async function gdriveAppendLink(args: {
  fileId?: string | null;
  name?: string | null;
  title: string;
  url: string;
  addedAt: string;
}): Promise<AppendLinkResult> {
  return invoke("gdrive_append_link", {
    fileId: args.fileId ?? null,
    name: args.name ?? null,
    title: args.title,
    url: args.url,
    addedAt: args.addedAt,
  });
}

export async function gdriveBackup(): Promise<DriveBackupResult> {
  return invoke("gdrive_backup");
}

export async function gdriveRestore(
  fileId?: string | null,
): Promise<ImportSummary> {
  return invoke("gdrive_restore", { fileId: fileId ?? null });
}

export async function gdriveSetBackupFolder(
  folderId?: string | null,
): Promise<void> {
  return invoke("gdrive_set_backup_folder", { folderId: folderId ?? null });
}

export async function gdriveSetAutobackup(
  enabled: boolean,
  intervalHours: number,
): Promise<void> {
  return invoke("gdrive_set_autobackup", { enabled, intervalHours });
}

export async function gdriveGetSettings(): Promise<DriveSettings> {
  return invoke("gdrive_get_settings");
}
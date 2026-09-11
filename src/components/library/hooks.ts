import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import type { ConfirmState } from "@/components/ConfirmDialog";
import {
  deleteFolder,
  deleteResources,
  dissolveFolder,
  listResources,
  moveFolder,
  setResourceFolder,
  setResourceStatus,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { isStale } from "@/lib/resources";
import type { ViewMode } from "@/lib/tileSize";
import type { Folder, Resource, SortBy } from "@/lib/types";
import { describeError } from "@/lib/utils";

/** États + dérivés de filtrage/tri/pagination produits par useLibraryFilters. */
export interface LibraryFilters {
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  debounced: string;
  typeFilter: string | null;
  setTypeFilter: Dispatch<SetStateAction<string | null>>;
  tagFilter: string | null;
  setTagFilter: Dispatch<SetStateAction<string | null>>;
  statusFilter: string | null;
  setStatusFilter: Dispatch<SetStateAction<string | null>>;
  favOnly: boolean;
  setFavOnly: Dispatch<SetStateAction<boolean>>;
  staleOnly: boolean;
  setStaleOnly: Dispatch<SetStateAction<boolean>>;
  sortBy: SortBy;
  setSortBy: Dispatch<SetStateAction<SortBy>>;
  captures: boolean;
  toggleCaptures: () => void;
  resources: Resource[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: UseQueryResult<Resource[], Error>["refetch"];
  queryKey: readonly [
    "resources",
    string,
    string | null,
    string | null,
    string | null,
    boolean,
    SortBy,
    number | null,
  ];
  displayed: Resource[];
  hasFilter: boolean;
  staleAlone: boolean;
  visibleFolders: Folder[];
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  pagination: { pages: number; total: number };
  handlePagination: (info: { pages: number; total: number }) => void;
}

/** Recherche, filtres (type/tag/statut/favoris/à revisiter), tri, captures et
 *  pagination de la bibliothèque : états + requête principale + liste affichée.
 *  La requête vit ici car le queryKey dépend des filtres et la liste affichée
 *  (`displayed`) dépend des résultats — impossible de les séparer. */
export function useLibraryFilters({
  foldersList,
  openFolder,
  viewMode,
}: {
  foldersList: Folder[];
  openFolder: Folder | null;
  viewMode: ViewMode;
}): LibraryFilters {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  /** Revue « À revisiter » : jamais ouvertes depuis 60 jours (isStale),
   *  triées ici (ouvrir / archiver / supprimer en sélection multiple) */
  const [staleOnly, setStaleOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("recent");
  const [captures, setCaptures] = useState(
    () => localStorage.getItem("vaultly-captures") === "1",
  );
  // --- pagination de la grille : l'état vit ici (la barre est rendue dans la
  // toolbar) ; ResourceGrid tranche `pageItems` et remonte pages/total ---
  const [page, setPage] = useState(0);
  const [pagination, setPagination] = useState({ pages: 1, total: 0 });
  const handlePagination = useCallback(
    (info: { pages: number; total: number }) => {
      setPagination((prev) =>
        prev.pages === info.pages && prev.total === info.total ? prev : info,
      );
    },
    [],
  );

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const queryKey = [
    "resources",
    debounced,
    typeFilter,
    tagFilter,
    statusFilter,
    favOnly,
    sortBy,
    openFolder?.id ?? null,
  ] as const;

  const {
    data: resources,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () =>
      listResources({
        query: debounced,
        resourceType: typeFilter,
        tag: tagFilter,
        status: statusFilter,
        // accueil (racine, aucun statut choisi) : masquer les archivés —
        // ce sont les « faits », à ne pas encombrer la vue courante.
        hideArchived: !openFolder && !statusFilter,
        favorite: favOnly,
        sortBy,
        // accueil = ressources sans dossier ; dossier ouvert = son contenu
        folderId: openFolder?.id ?? null,
        unfiledOnly: !openFolder,
      }),
  });

  // revue « À revisiter » : filtre client sur les résultats chargés
  // (jamais ouvertes depuis 60 jours, non archivées)
  const displayed = useMemo(
    () =>
      staleOnly
        ? (resources ?? []).filter((r) => r.status !== "archived" && isStale(r))
        : (resources ?? []),
    [resources, staleOnly],
  );
  const hasFilter = Boolean(
    debounced ||
      favOnly ||
      staleOnly ||
      typeFilter ||
      tagFilter ||
      statusFilter,
  );
  // revue seule (sans autre filtre) et vide = tout est à jour 🎉
  const staleAlone =
    staleOnly &&
    !debounced &&
    !favOnly &&
    !typeFilter &&
    !tagFilter &&
    !statusFilter;
  const visibleFolders = useMemo(
    () =>
      foldersList.filter((f) =>
        openFolder ? f.parentId === openFolder.id : f.parentId === null,
      ),
    [foldersList, openFolder],
  );

  // pagination : changer de dossier/filtres (ou la vue) ramène à la page 1
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset voulu quand ces critères changent ; leurs valeurs ne sont pas lues dans l'effet
  useEffect(() => {
    setPage(0);
  }, [
    openFolder?.id,
    viewMode,
    debounced,
    typeFilter,
    tagFilter,
    statusFilter,
    favOnly,
    staleOnly,
    sortBy,
  ]);
  // recale la page si le nb de pages se réduit (filtre, resize, suppression)
  useEffect(() => {
    if (page > pagination.pages - 1) setPage(Math.max(0, pagination.pages - 1));
  }, [pagination.pages, page]);

  function toggleCaptures() {
    const next = !captures;
    setCaptures(next);
    localStorage.setItem("vaultly-captures", next ? "1" : "0");
  }

  return {
    query,
    setQuery,
    debounced,
    typeFilter,
    setTypeFilter,
    tagFilter,
    setTagFilter,
    statusFilter,
    setStatusFilter,
    favOnly,
    setFavOnly,
    staleOnly,
    setStaleOnly,
    sortBy,
    setSortBy,
    captures,
    toggleCaptures,
    resources,
    isLoading,
    isError,
    refetch,
    queryKey,
    displayed,
    hasFilter,
    staleAlone,
    visibleFolders,
    page,
    setPage,
    pagination,
    handlePagination,
  };
}

/** État + actions sur les dossiers produits par useFolderActions. */
export interface FolderActions {
  folderStack: Folder[];
  setFolderStack: Dispatch<SetStateAction<Folder[]>>;
  openFolder: Folder | null;
  goUp: () => void;
  dragFolderId: number | null;
  setDragFolderId: Dispatch<SetStateAction<number | null>>;
  folderDropHint: number | null;
  setFolderDropHint: Dispatch<SetStateAction<number | null>>;
  handleDeleteFolder: (f: Folder) => void;
  handleDissolveFolder: (f: Folder) => void;
  handleFolderDrop: (target: Folder) => Promise<void>;
  handleDropOnFolder: (folder: Folder) => Promise<void>;
}
/** Pile de navigation des dossiers (fil d'Ariane, Retour), suppression,
 *  dissolution et dépôts sur un dossier. `dragId`/`setDragId` (drag d'une
 *  ressource) restent la propriété de LibraryView : ils sont partagés avec
 *  le dépôt sur tuile et le réordonnancement. */
export function useFolderActions({
  refresh,
  setConfirm,
  dragId,
  setDragId,
}: {
  refresh: () => void;
  setConfirm: Dispatch<SetStateAction<ConfirmState | null>>;
  dragId: number | null;
  setDragId: Dispatch<SetStateAction<number | null>>;
}): FolderActions {
  const { t } = useI18n();
  // pile de navigation des dossiers : « Retour » remonte au dossier PARENT
  // (pas à la racine) quand on est dans un dossier imbriqué
  const [folderStack, setFolderStack] = useState<Folder[]>([]);
  const openFolder =
    folderStack.length > 0 ? folderStack[folderStack.length - 1] : null;
  /** Remonte d'un niveau dans la hiérarchie (Retour, Échap, suppression ou
   *  dissolution du dossier ouvert). */
  function goUp() {
    setFolderStack((s) => s.slice(0, -1));
  }
  const [dragFolderId, setDragFolderId] = useState<number | null>(null);
  const [folderDropHint, setFolderDropHint] = useState<number | null>(null);

  /** Dépose d'un dossier sur un autre : imbrique (le backend refuse les cycles). */
  async function handleFolderDrop(target: Folder) {
    setFolderDropHint(null);
    if (!dragFolderId || dragFolderId === target.id) {
      setDragFolderId(null);
      return;
    }
    const srcId = dragFolderId;
    setDragFolderId(null);
    try {
      await moveFolder(srcId, target.id);
      toast.success(t("Déplacé dans « {name} »", { name: target.name }));
      refresh();
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  /** Dépose d'une tuile sur un dossier : range la ressource dedans. */
  async function handleDropOnFolder(folder: Folder) {
    setFolderDropHint(null);
    if (dragId === null) return;
    const id = dragId;
    setDragId(null);
    try {
      await setResourceFolder(id, folder.id);
      toast.success(t("Rangée dans « {name} »", { name: folder.name }));
      refresh();
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  function handleDeleteFolder(f: Folder) {
    setConfirm({
      title: t("Supprimer le dossier « {name} » ?", { name: f.name }),
      message: t(
        "Toutes les ressources du dossier et de ses sous-dossiers iront dans la corbeille (restaurables 30 jours). Les sous-dossiers sont supprimés définitivement.",
      ),
      confirmLabel: t("Supprimer"),
      destructive: true,
      action: async () => {
        try {
          const trashed = await deleteFolder(f.id);
          if (openFolder?.id === f.id) goUp();
          toast.success(
            trashed > 0
              ? t("{count} ressource(s) déplacée(s) dans la corbeille", {
                  count: trashed,
                })
              : t("Dossier supprimé"),
          );
          refresh();
        } catch (e) {
          toast.error(describeError(e));
        }
      },
    });
  }

  function handleDissolveFolder(f: Folder) {
    setConfirm({
      title: t("Dissoudre le dossier « {name} » ?", { name: f.name }),
      message: t(
        "Ses ressources reviennent dans la grille et ses sous-dossiers remontent d'un niveau. Rien n'est supprimé.",
      ),
      confirmLabel: t("Dissoudre"),
      action: async () => {
        try {
          await dissolveFolder(f.id);
          if (openFolder?.id === f.id) goUp();
          toast.success(t("Dossier « {name} » dissous", { name: f.name }));
          refresh();
        } catch (e) {
          toast.error(describeError(e));
        }
      },
    });
  }

  return {
    folderStack,
    setFolderStack,
    openFolder,
    goUp,
    dragFolderId,
    setDragFolderId,
    folderDropHint,
    setFolderDropHint,
    handleDeleteFolder,
    handleDissolveFolder,
    handleFolderDrop,
    handleDropOnFolder,
  };
}

/** État + actions de la sélection multiple produits par useBulkActions.
 *  Ressources ET dossiers sont sélectionnables (ensembles séparés : les ids
 *  viennent de tables différentes, un préfixe commun créerait des collisions). */
export interface BulkActions {
  selectMode: boolean;
  setSelectMode: Dispatch<SetStateAction<boolean>>;
  selectedIds: Set<number>;
  setSelectedIds: Dispatch<SetStateAction<Set<number>>>;
  selectedFolderIds: Set<number>;
  setSelectedFolderIds: Dispatch<SetStateAction<Set<number>>>;
  /** ressources + dossiers sélectionnés (compteur de la barre d'actions) */
  selectedCount: number;
  /** vide les deux sélections (bouton Sélectionner/Quitter, fin d'action) */
  clearSelection: () => void;
  toggleFolderSelect: (folder: Folder) => void;
  handleBulkArchive: () => Promise<void>;
  handleBulkDelete: () => void;
}

/** Mode sélection + actions en masse (archiver / supprimer) de la bibliothèque.
 *  L'archivage ne concerne que les ressources (les dossiers n'ont pas de
 *  statut) ; la suppression gère le mixte : ressources → corbeille, dossiers
 *  → supprimés (leur contenu ressort dans la grille). */
export function useBulkActions({
  refresh,
  setConfirm,
  openFolder,
  goUp,
}: {
  refresh: () => void;
  setConfirm: Dispatch<SetStateAction<ConfirmState | null>>;
  openFolder: Folder | null;
  goUp: () => void;
}): BulkActions {
  const { t } = useI18n();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<number>>(
    new Set(),
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedFolderIds(new Set());
  }, []);

  function toggleFolderSelect(folder: Folder) {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folder.id)) next.delete(folder.id);
      else next.add(folder.id);
      return next;
    });
  }

  function handleBulkDelete() {
    const ids = [...selectedIds];
    const folderIds = [...selectedFolderIds];
    if (ids.length === 0 && folderIds.length === 0) return;
    const total = ids.length + folderIds.length;
    setConfirm({
      title: t("Supprimer {count} élément(s) ?", { count: total }),
      message:
        folderIds.length === 0
          ? t(
              "Elles seront restaurables 30 jours dans la corbeille (Réglages).",
            )
          : t(
              "Tout part dans la corbeille (restaurable 30 jours) : les ressources sélectionnées et tout le contenu des dossiers. Les sous-dossiers sont supprimés définitivement.",
            ),
      confirmLabel: t("Supprimer"),
      destructive: true,
      action: async () => {
        try {
          if (ids.length > 0) await deleteResources(ids);
          for (const id of folderIds) {
            await deleteFolder(id);
            // le dossier ouvert fait partie de la sélection : remonter
            if (openFolder?.id === id) goUp();
          }
          toast.success(t("{count} élément(s) supprimé(s)", { count: total }));
          clearSelection();
          setSelectMode(false);
          refresh();
        } catch (e) {
          toast.error(describeError(e));
        }
      },
    });
  }

  /** Archivage en masse (revue « À revisiter ») : statut seul, un toast.
   *  Les ressources gardent leur dossier (le statut est la source de vérité). */
  async function handleBulkArchive() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map((id) => setResourceStatus(id, "archived")));
      toast.success(
        t("{count} ressource(s) archivée(s)", { count: ids.length }),
      );
      clearSelection();
      setSelectMode(false);
      refresh();
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  return {
    selectMode,
    setSelectMode,
    selectedIds,
    setSelectedIds,
    selectedFolderIds,
    setSelectedFolderIds,
    selectedCount: selectedIds.size + selectedFolderIds.size,
    clearSelection,
    toggleFolderSelect,
    handleBulkArchive,
    handleBulkDelete,
  };
}

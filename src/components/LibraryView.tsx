import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowDownAZ,
  ArrowLeft,
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cloud,
  Flame,
  FolderOpen,
  History,
  KanbanSquare,
  LayoutGrid,
  List,
  ListChecks,
  Loader2,
  Plus,
  RotateCw,
  Search,
  Star,
  StickyNote,
  Tags,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BoardView } from "@/components/BoardView";
import { ConfirmDialog, type ConfirmState } from "@/components/ConfirmDialog";
import {
  FolderCreateDialog,
  type FolderDialogState,
} from "@/components/library/FolderCreateDialog";
import {
  useBulkActions,
  useFolderActions,
  useLibraryFilters,
} from "@/components/library/hooks";
import { ResourceGrid } from "@/components/library/ResourceGrid";
import { NoteEditor } from "@/components/NoteEditor";
import { NoteViewer } from "@/components/NoteViewer";
import { ResourceDetails } from "@/components/ResourceDetails";
import { ResourceDialog } from "@/components/ResourceDialog";
import { TagManagerDialog } from "@/components/TagManagerDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  allTags,
  type CloudFile,
  cloudImportFile,
  cloudListFiles,
  cloudUploadFile,
  createFolder,
  deleteResource,
  listFolders,
  listResources,
  openResourcesFolder,
  reorderResources,
  setResourceFolder,
  setResourceStatus,
} from "@/lib/api";
import { tt, useI18n } from "@/lib/i18n";
import { openResource } from "@/lib/openResource";
import { RESOURCE_TYPES } from "@/lib/resources";
import {
  getTileSize,
  getViewMode,
  setViewMode as persistViewMode,
  tileMinPx,
  type ViewMode,
} from "@/lib/tileSize";
import type { Resource, SortBy } from "@/lib/types";
import { cn, describeError } from "@/lib/utils";

function getSorts(t: (key: string) => string) {
  return [
    { value: "recent" as SortBy, label: t("sort.recent"), icon: Clock },
    { value: "added" as SortBy, label: t("sort.added"), icon: CalendarDays },
    { value: "oldest" as SortBy, label: t("sort.oldest"), icon: History },
    { value: "mostUsed" as SortBy, label: t("sort.mostUsed"), icon: Flame },
    { value: "manual" as SortBy, label: t("sort.manual"), icon: LayoutGrid },
    { value: "title" as SortBy, label: t("sort.title"), icon: ArrowDownAZ },
  ];
}

/** Clés stables des 12 squelettes de chargement (jamais réordonnés). */
const SKELETON_KEYS = Array.from({ length: 12 }, (_, i) => `skeleton-${i}`);

export function LibraryView() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [prefillUrl, setPrefillUrl] = useState<string | null>(null);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteEditing, setNoteEditing] = useState<Resource | null>(null);
  const [noteViewing, setNoteViewing] = useState<Resource | null>(null);
  /** vue « Détails » d'une ressource (fiche complète, README des dépôts) */
  const [detailsViewing, setDetailsViewing] = useState<Resource | null>(null);
  // --- Joindre un fichier depuis le cloud (WebDAV) ---
  const [cloudDialogOpen, setCloudDialogOpen] = useState(false);
  const [cloudQuery, setCloudQuery] = useState("");
  const [cloudResults, setCloudResults] = useState<CloudFile[] | null>(null);
  const [cloudSearching, setCloudSearching] = useState(false);
  const [cloudAddingId, setCloudAddingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialogState>(null);
  const [folderName, setFolderName] = useState("");
  const [dragId, setDragId] = useState<number | null>(null);
  /** zone de dépôt pendant le drag d'une ressource : bord gauche/droit de la
   *  tuile = trait d'insertion, centre = fusion en dossier */
  const [dropZone, setDropZone] = useState<{
    id: number;
    zone: "left" | "right" | "center";
  } | null>(null);
  // compteur de rechargement : incrémenter remonte la grille → réessaie les
  // images distantes (favicons/captures) passées en erreur faute de réseau
  const [imgNonce, setImgNonce] = useState(0);
  // --- taille des tuiles + mode d'affichage (réglages visuels) ---
  const [tileSize, setTileSizeState] = useState(getTileSize);
  const [viewMode, setViewModeState] = useState<ViewMode>(getViewMode);
  useEffect(() => {
    const onSize = () => setTileSizeState(getTileSize());
    const onView = () => setViewModeState(getViewMode());
    window.addEventListener("vaultly:tile-size-changed", onSize);
    window.addEventListener("vaultly:view-mode-changed", onView);
    return () => {
      window.removeEventListener("vaultly:tile-size-changed", onSize);
      window.removeEventListener("vaultly:view-mode-changed", onView);
    };
  }, []);
  const tileMin = tileMinPx(tileSize);
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    // n'invalide que ce que les actions de la bibliothèque modifient :
    // un invalidateQueries() global re-déclencherait le scan disque des
    // profils navigateur (queryKey « browserProfiles ») à chaque action.
    void qc.invalidateQueries({ queryKey: ["resources"] });
    void qc.invalidateQueries({ queryKey: ["folders"] });
    void qc.invalidateQueries({ queryKey: ["allTags"] });
    void qc.invalidateQueries({ queryKey: ["stats"] });
    // les suppressions alimentent la corbeille : le badge du header suit
    void qc.invalidateQueries({ queryKey: ["trash"] });
  }, [qc]);

  const { data: folders } = useQuery({
    queryKey: ["folders"],
    queryFn: listFolders,
  });

  // stable entre les renders : passé aux tuiles mémoïsées (sinon `?? []`
  // crée un nouveau tableau à chaque render et invalide le memo).
  const foldersList = useMemo(() => folders ?? [], [folders]);

  const {
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
  } = useFolderActions({ refresh, setConfirm, dragId, setDragId });

  const {
    selectMode,
    setSelectMode,
    selectedIds,
    setSelectedIds,
    handleBulkArchive,
    handleBulkDelete,
  } = useBulkActions({ refresh, setConfirm });

  const {
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
  } = useLibraryFilters({ foldersList, openFolder, viewMode });

  // raccourci "/" pour focus la recherche — jamais pendant une saisie
  // (INPUT, TEXTAREA ou éditeur contentEditable), sinon le "/" serait
  // avalé en pleine frappe dans la description ou une note.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const el = document.activeElement;
      const typing =
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (typing) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl+N : nouvelle ressource ; Ctrl+Alt+N : nouvelle note ; Ctrl+F : recherche ; Échap : sortir.
  // Ignorés quand un dialog est ouvert (sinon Ctrl+N reset la saisie en cours,
  // Ctrl+F vole le focus derrière la modale, et Échap ferme le dialog ET fait
  // remonter d'un niveau la pile de dossiers).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      const anyDialogOpen =
        dialogOpen ||
        noteEditorOpen ||
        noteViewing !== null ||
        detailsViewing !== null ||
        folderDialog !== null ||
        cloudDialogOpen ||
        confirm !== null;
      if (ctrl && e.altKey && e.key.toLowerCase() === "n") {
        if (anyDialogOpen) return;
        e.preventDefault();
        setNoteEditing(null);
        setNoteEditorOpen(true);
      } else if (ctrl && !e.altKey && e.key.toLowerCase() === "n") {
        if (anyDialogOpen) return;
        e.preventDefault();
        setEditing(null);
        setPrefillUrl(null);
        setDialogOpen(true);
      } else if (ctrl && e.key.toLowerCase() === "f") {
        if (anyDialogOpen) return;
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && openFolder && !anyDialogOpen) {
        // goUp() inliné : la fonction recréée à chaque render ferait
        // ré-abonner le listener en boucle comme dep d'effet
        setFolderStack((s) => s.slice(0, -1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    openFolder,
    dialogOpen,
    noteEditorOpen,
    noteViewing,
    detailsViewing,
    folderDialog,
    cloudDialogOpen,
    confirm, // goUp() inliné : la fonction recréée à chaque render ferait
    // ré-abonner le listener en boucle comme dep d'effet
    setFolderStack,
  ]);

  // URL capturée depuis le presse-papiers : modale pré-remplie.
  // Ignorée si un dialogue est déjà ouvert : elle écraserait la saisie en cours.
  const anyDialogRef = useRef(false);
  useEffect(() => {
    anyDialogRef.current =
      dialogOpen ||
      noteEditorOpen ||
      noteViewing !== null ||
      detailsViewing !== null ||
      folderDialog !== null ||
      cloudDialogOpen ||
      confirm !== null;
  }, [
    dialogOpen,
    noteEditorOpen,
    noteViewing,
    detailsViewing,
    folderDialog,
    cloudDialogOpen,
    confirm,
  ]);
  useEffect(() => {
    function onAddUrl(e: Event) {
      if (anyDialogRef.current) return;
      const url = (e as CustomEvent<string>).detail;
      setEditing(null);
      setPrefillUrl(url);
      setDialogOpen(true);
    }
    window.addEventListener("vaultly:add-url", onAddUrl);
    return () => window.removeEventListener("vaultly:add-url", onAddUrl);
  }, []);

  const { data: allTagsList } = useQuery({
    queryKey: ["allTags"],
    queryFn: allTags,
  });

  // Kanban : sa propre lecture TOUS statuts (les 3 colonnes doivent exister
  // même quand l'accueil masque les archivés). Suit dossier + recherche +
  // type + tag + favoris, ignore le filtre statut. Actif en vue tableau seul.
  const { data: boardResources } = useQuery({
    queryKey: [
      "resources",
      "board",
      debounced,
      typeFilter,
      tagFilter,
      favOnly,
      openFolder?.id ?? null,
    ],
    queryFn: () =>
      listResources({
        query: debounced,
        resourceType: typeFilter,
        tag: tagFilter,
        favorite: favOnly,
        status: null,
        hideArchived: false,
        folderId: openFolder?.id ?? null,
        unfiledOnly: !openFolder,
      }),
    enabled: viewMode === "board",
  });

  /** Rafraîchir : recolle les données à la source + retente les images. */
  function handleRefresh() {
    refetch();
    refresh();
    setImgNonce((n) => n + 1);
  }

  /** Dépose d'une tuile pendant le drag d'une ressource :
   *  - zone CENTRALE de la cible → crée un dossier avec les deux (fusion) ;
   *  - moitiés gauche/droite → insère la tuile à cet interstice (trait). */
  async function handleDropOnTile(
    target: Resource,
    zone: "left" | "right" | "center",
  ) {
    setDropZone(null);
    setFolderDropHint(null);
    const srcId = dragId;
    setDragId(null);
    if (srcId === null || srcId === target.id) return;

    const list = [...(resources ?? [])];
    const from = list.findIndex((r) => r.id === srcId);
    if (from === -1) return;
    const [moved] = list.splice(from, 1);

    try {
      if (zone === "center") {
        const name = `Dossier — ${moved.title.slice(0, 20)} & ${target.title.slice(0, 20)}`;
        const folder = await createFolder(
          name,
          undefined,
          openFolder?.id ?? null,
        );
        await setResourceFolder(moved.id, folder.id);
        await setResourceFolder(target.id, folder.id);
        const shown =
          folder.name.length > 45
            ? `${folder.name.slice(0, 45)}…`
            : folder.name;
        toast.success(t("Dossier « {name} » créé", { name: shown }), {
          description: t("Renomme-le depuis son menu ⋯ si besoin."),
        });
        refresh();
        return;
      }
      // insertion à l'interstice : position de la cible dans la liste SANS
      // la tuile déplacée, puis insertion avant (gauche) ou après (droite).
      // Le backend ne réécrit que les positions des ids envoyées (réordon-
      // nancement partiel) : un drag en vue filtrée ou plafonnée est sans
      // danger pour le reste de la bibliothèque.
      const to = list.findIndex((r) => r.id === target.id);
      const insertAt = zone === "left" ? to : to + 1;
      list.splice(insertAt === -1 ? list.length : insertAt, 0, moved);
      qc.setQueryData(queryKey, list); // mise à jour optimiste
      await reorderResources(list.map((r) => r.id));
      // l'insertion ne se voit qu'en tri « Placement » : si l'utilisateur
      // glisse dans un autre tri, on bascule pour qu'il voie le résultat
      if (sortBy !== "manual") setSortBy("manual");
      refresh();
    } catch (e) {
      toast.error(describeError(e));
      refresh();
    }
  }

  const handleMoveToFolder = useCallback(
    async (r: Resource, folderId: number | null) => {
      try {
        await setResourceFolder(r.id, folderId);
        toast.success(
          folderId === null
            ? tt("Sortie du dossier")
            : tt("Rangée dans « {name} »", {
                name: foldersList.find((f) => f.id === folderId)?.name ?? "?",
              }),
        );
        refresh();
      } catch (e) {
        toast.error(describeError(e));
      }
    },
    [foldersList, refresh],
  );

  const handleUploadToCloud = useCallback(async (r: Resource) => {
    const path =
      r.meta?.filePath ?? (r.url.startsWith("file:") ? r.url.slice(5) : "");
    if (!path) {
      toast.error(tt("Ce fichier n'a pas de chemin local enregistré"));
      return;
    }
    toast.info(tt("Envoi vers le cloud en cours…"));
    try {
      const name = await cloudUploadFile(path);
      toast.success(tt("Envoyé vers le cloud sous « {name} »", { name }));
    } catch (e) {
      toast.error(describeError(e));
    }
  }, []);

  async function searchCloudFiles() {
    setCloudSearching(true);
    try {
      setCloudResults(await cloudListFiles(cloudQuery.trim() || null));
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setCloudSearching(false);
    }
  }

  async function addCloudFileAsResource(f: CloudFile) {
    setCloudAddingId(f.name);
    try {
      // rapatrie le fichier dans Documents\Vaultly\Fichiers et crée la
      // ressource locale (l'URL WebDAV est protégée par mot de passe, elle
      // ne serait pas cliquable depuis un autre appareil)
      await cloudImportFile(f.name);
      toast.success(t("« {name} » joint à la bibliothèque", { name: f.name }));
      refresh();
      setCloudDialogOpen(false);
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setCloudAddingId(null);
    }
  }

  const toggleSelect = useCallback(
    (r: Resource) => {
      setSelectedIds((s) => {
        const next = new Set(s);
        if (next.has(r.id)) next.delete(r.id);
        else next.add(r.id);
        return next;
      });
    },
    [setSelectedIds],
  );

  // stable : passé tel quel aux tuiles mémoïsées (une closure inline par
  // render annulerait le memo sur toute la grille à chaque dragOver)
  const handleDragStarted = useCallback((r: Resource) => setDragId(r.id), []);

  /** Réordonnancement clavier (accessibilité du drag iOS) : en tri
   *  « Placement », Ctrl+Maj+←/→ échange la tuile focusée avec sa voisine.
   *  Le backend ne touchant que les ids envoyées (reorder partiel), la
   *  liste affichée suffit — sans danger en vue filtrée. */
  const moveTileByKey = useCallback(
    async (r: Resource, dir: -1 | 1) => {
      const list = [...(resources ?? [])];
      const i = list.findIndex((x) => x.id === r.id);
      const j = i + dir;
      if (i === -1 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      qc.setQueryData(queryKey, list); // optimiste : l'échange est immédiat
      try {
        await reorderResources(list.map((x) => x.id));
      } catch (e) {
        toast.error(describeError(e));
      }
      refresh();
    },
    [resources, qc, queryKey, refresh],
  );

  /**
   * Statut de traitement = SEULE source de vérité (le champ `status`).
   * Fini les dossiers-système auto-créés (« À traiter » / « Archivés ») qui
   * arrachaient la ressource de son vrai dossier : ici on ne touche que le
   * statut. L'accueil masque les archivés (hideArchived) ; le filtre « Statut »
   * et le Kanban les rendent visibles.
   */
  const handleSetStatus = useCallback(
    async (r: Resource, status: "" | "todo" | "archived") => {
      try {
        await setResourceStatus(r.id, status);
        toast.success(
          status === "archived"
            ? tt("Archivée")
            : status === "todo"
              ? tt("Marquée à traiter")
              : tt("Réactivée"),
        );
        refresh();
      } catch (e) {
        toast.error(describeError(e));
      }
    },
    [refresh],
  );

  /** Kanban : change le `status` (source de vérité), sans jamais déplacer la
   *  ressource de son dossier. */
  const handleMoveStatusColumn = useCallback(
    async (id: number, status: "" | "todo" | "archived") => {
      try {
        await setResourceStatus(id, status);
        refresh();
      } catch (e) {
        toast.error(describeError(e));
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    (r: Resource) => {
      setConfirm({
        title: tt("Supprimer « {name} » ?", { name: r.title }),
        message: tt(
          "Elle sera restaurable 30 jours dans la corbeille (Réglages).",
        ),
        confirmLabel: tt("Supprimer"),
        destructive: true,
        action: async () => {
          try {
            await deleteResource(r.id);
            toast.success(tt("Déplacée dans la corbeille"));
            refresh();
          } catch (e) {
            toast.error(describeError(e));
          }
        },
      });
    },
    [refresh],
  );

  // clic « Modifier » d'une tuile : note → éditeur de note, sinon dialogue
  const handleEdit = useCallback((res: Resource) => {
    if (res.resourceType === "note") {
      setNoteEditing(res);
      setNoteEditorOpen(true);
    } else {
      setEditing(res);
      setDialogOpen(true);
    }
  }, []);

  /** Kanban : clic sur une carte — note → lecteur, sans lien → édition, sinon
   *  ouverture réelle (même logique que la tuile / la liste). */
  const handleBoardOpen = useCallback(
    async (r: Resource) => {
      if (r.resourceType === "note") {
        setNoteViewing(r);
        return;
      }
      if (r.url.startsWith("local:") && !r.meta?.filePath) {
        setEditing(r);
        setDialogOpen(true);
        return;
      }
      try {
        await openResource(r);
        refresh();
      } catch (e) {
        toast.error(
          tt("Ouverture impossible : {error}", { error: describeError(e) }),
        );
      }
    },
    [refresh],
  );

  // compteurs de types sur le jeu de résultats courant
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of resources ?? []) {
      m.set(r.resourceType, (m.get(r.resourceType) ?? 0) + 1);
    }
    return m;
  }, [resources]);

  // onglets : types connus + types libres éventuels
  const tabs = useMemo(() => {
    const known = RESOURCE_TYPES.map((t) => t.value);
    const extras = [...typeCounts.keys()].filter((t) => !known.includes(t));
    return [...known, ...extras];
  }, [typeCounts]);

  const sorts = getSorts(t);
  const sortDef = sorts.find((s) => s.value === sortBy) ?? sorts[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* barre d'outils */}
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <div className="relative max-w-md grow" data-tour="search">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder={t("lib.search")}
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select
          value={sortBy}
          onValueChange={(v) => setSortBy((v ?? "recent") as SortBy)}
        >
          <SelectTrigger size="sm" className="w-[140px] shrink-0">
            <sortDef.icon className="size-3.5 text-muted-foreground" />
            <SelectValue>{sortDef.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sorts.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={favOnly ? "default" : "outline"}
          size="icon"
          onClick={() => setFavOnly((v) => !v)}
          title={t("lib.favorites")}
        >
          <Star className={favOnly ? "fill-yellow-400 text-yellow-400" : ""} />
        </Button>
        {/* « À revisiter » = filtre propre à la grille ; ignoré en tableau
            (le tableau affiche déjà toutes les colonnes de statut). */}
        {viewMode !== "board" && (
          <Button
            variant={staleOnly ? "default" : "outline"}
            size="icon"
            onClick={() => setStaleOnly((v) => !v)}
            title={t("lib.stale")}
          >
            <History />
          </Button>
        )}
        <Button
          variant={captures ? "default" : "outline"}
          size="icon"
          onClick={toggleCaptures}
          title={t("lib.captures")}
        >
          <Camera />
        </Button>
        {/* bascule Tuiles / Liste / Tableau : l'apparence se mémorise */}
        <div
          className="flex items-center rounded-lg border p-0.5"
          data-tour="view"
        >
          <Button
            variant={viewMode === "grid" ? "default" : "ghost"}
            size="icon-sm"
            onClick={() => persistViewMode("grid")}
            title={t("lib.view.grid")}
          >
            <LayoutGrid />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "ghost"}
            size="icon-sm"
            onClick={() => persistViewMode("list")}
            title={t("lib.view.list")}
          >
            <List />
          </Button>
          <Button
            variant={viewMode === "board" ? "default" : "ghost"}
            size="icon-sm"
            onClick={() => persistViewMode("board")}
            title={t("lib.view.board")}
          >
            <KanbanSquare />
          </Button>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={handleRefresh}
          title={t("lib.refresh")}
        >
          <RotateCw />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title={t("lib.openFolder")}
          onClick={() =>
            openResourcesFolder()
              .then(() => toast.success(t("Dossier de ressources ouvert")))
              .catch((e) => toast.error(describeError(e)))
          }
        >
          <FolderOpen />
        </Button>
        <Button
          variant={selectMode ? "default" : "outline"}
          onClick={() => {
            setSelectMode((v) => !v);
            setSelectedIds(new Set());
          }}
          title={t("lib.select")}
        >
          <ListChecks />
          {selectMode ? t("lib.select.exit") : t("lib.select.select")}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setCloudQuery("");
            setCloudResults(null);
            setCloudDialogOpen(true);
          }}
          title={t("lib.cloud")}
        >
          <Cloud />
          {t("lib.cloud.label")}
        </Button>
        <Button
          variant="outline"
          onClick={() => setTagManagerOpen(true)}
          title={t("lib.tags")}
        >
          <Tags />
          {t("lib.tags.label")}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setNoteEditing(null);
            setNoteEditorOpen(true);
          }}
          title={t("lib.note")}
        >
          <StickyNote />
          {t("lib.note.label")}
        </Button>
        <Button
          data-tour="add"
          onClick={() => {
            setEditing(null);
            setPrefillUrl(null);
            setDialogOpen(true);
          }}
        >
          <Plus />
          {t("lib.add")}
        </Button>
      </div>

      {/* onglets de types + catégories — wrap, jamais de scrollbar */}
      <div
        className="flex flex-wrap items-center gap-x-1 border-b px-3"
        data-tour="filters"
      >
        <FilterTab
          label={t("Tout")}
          count={(resources ?? []).length}
          active={typeFilter === null}
          onClick={() => setTypeFilter(null)}
        />
        {tabs.map((tab) => (
          <FilterTab
            key={tab}
            label={t(RESOURCE_TYPES.find((r) => r.value === tab)?.label ?? tab)}
            count={typeCounts.get(tab) ?? 0}
            active={typeFilter === tab}
            onClick={() => setTypeFilter(typeFilter === tab ? null : tab)}
          />
        ))}
        {/* filtres combinés : tag · statut, côte à côte */}
        <span className="grow" />
        {(allTagsList?.length ?? 0) > 0 && (
          <Select
            value={tagFilter ?? "__all"}
            onValueChange={(v) =>
              setTagFilter(v === "__all" ? null : (v ?? null))
            }
          >
            <SelectTrigger
              size="default"
              className={cn(
                "my-1 shrink-0 px-3",
                tagFilter && "border-primary/60 text-foreground",
              )}
            >
              <SelectValue placeholder={t("Tags")}>
                {tagFilter ? `#${tagFilter}` : t("Tags")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="w-auto min-w-[9rem] max-w-[24rem]">
              <SelectItem value="__all">{t("Tous les tags")}</SelectItem>
              {(allTagsList ?? []).map((t) => (
                <SelectItem key={t} value={t}>
                  #{t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {/* « Statut » + pagination : propres à la grille ; le tableau affiche
            déjà toutes les colonnes de statut et n'est pas paginé. */}
        {viewMode !== "board" && (
          <>
            <Select
              value={
                statusFilter === "" ? "__active" : (statusFilter ?? "__all")
              }
              onValueChange={(v) =>
                setStatusFilter(
                  v === "__all" ? null : v === "__active" ? "" : (v ?? null),
                )
              }
            >
              <SelectTrigger
                size="sm"
                className={cn(
                  "my-1 shrink-0",
                  statusFilter && "border-primary/60 text-foreground",
                )}
              >
                <SelectValue placeholder={t("Statut")}>
                  {statusFilter === "todo"
                    ? t("À traiter")
                    : statusFilter === "archived"
                      ? t("Archivés")
                      : statusFilter === ""
                        ? t("Actifs")
                        : t("Statut")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">{t("Tous")}</SelectItem>
                <SelectItem value="__active">{t("Actifs")}</SelectItem>
                <SelectItem value="todo">{t("À traiter")}</SelectItem>
                <SelectItem value="archived">{t("Archivés")}</SelectItem>
              </SelectContent>
            </Select>
            {/* pagination : à la racine, collée à droite du filtre « Statut » */}
            {!openFolder && (
              <GridPager
                page={page}
                pages={pagination.pages}
                total={pagination.total}
                onPage={setPage}
                className="mx-1"
              />
            )}
          </>
        )}
      </div>

      {/* fil d'ariane : Racine > ... > dossier ouvert, chaque segment cliquable */}
      {openFolder && (
        <div className="flex animate-slide-down items-center gap-2 px-4 pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={goUp}
            title={
              folderStack.length > 1 ? t("Dossier précédent") : t("Racine")
            }
          >
            <ArrowLeft />
            {t("Retour")}
          </Button>
          <nav className="flex min-w-0 items-center gap-1 text-sm">
            {folderStack.map((f, i) => {
              const last = i === folderStack.length - 1;
              return (
                <span key={f.id} className="flex min-w-0 items-center gap-1">
                  {i > 0 && <span className="text-muted-foreground">/</span>}
                  {last ? (
                    <span className="truncate font-medium">{f.name}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setFolderStack((s) => s.slice(0, i + 1))}
                      className="cursor-pointer truncate text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      title={t("Aller à « {name} »", { name: f.name })}
                    >
                      {f.name}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("{count} ressource(s)", { count: (resources ?? []).length })}
          </span>
          {/* pagination : dans un dossier, alignée à droite de la ligne du
              fil d'Ariane (même ligne que « Retour »). Masquée en mode tableau. */}
          {viewMode !== "board" && (
            <>
              <span className="grow" />
              <GridPager
                page={page}
                pages={pagination.pages}
                total={pagination.total}
                onPage={setPage}
              />
            </>
          )}
        </div>
      )}

      {/* hint tri manuel */}
      {sortBy === "manual" && !openFolder && (
        <div className="px-4 pt-2 text-xs text-muted-foreground">
          {t(
            "Glisse une tuile : un trait entre deux cartes les réordonne — lâche au centre d'une carte pour créer un dossier avec les deux — pose sur un dossier pour la ranger dedans. Au clavier : Ctrl+Maj+←/→ déplace la tuile sélectionnée.",
          )}
        </div>
      )}

      {/* le backend plafonne la vue à 500 lignes : le dire, pas le cacher */}
      {(resources ?? []).length >= 500 && (
        <div className="px-4 pt-2 text-xs text-amber-600 dark:text-amber-500">
          {t(
            "Un très grand nombre de résultats — précise ta recherche ou ajoute un filtre pour tout voir.",
          )}
        </div>
      )}

      {/* grille ou liste : rendu délégué à ResourceGrid (3 modes).
          États transverses (erreur, chargement, bibliothèque vide) gérés
          ici ; les tuiles/lignes vives sont dans le composant. */}
      {isError && (
        <div className="mx-6 mb-3 flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
          <span>{t("lib.loadError")}</span>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            {t("lib.retry")}
          </Button>
        </div>
      )}
      {isLoading ? (
        <div
          className="grid gap-3 px-6 pt-4 pb-6"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${tileMin}px, 1fr))`,
          }}
        >
          {SKELETON_KEYS.map((k) => (
            <div
              key={k}
              className="aspect-square animate-pulse rounded-xl bg-muted/60"
            />
          ))}
        </div>
      ) : displayed.length === 0 &&
        visibleFolders.length === 0 &&
        !isError &&
        !openFolder ? (
        <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
          {staleAlone ? (
            <History className="size-8 opacity-40" />
          ) : (
            <Search className="size-8 opacity-40" />
          )}
          <p className="font-medium text-foreground">
            {staleAlone
              ? t("lib.stale.empty.title")
              : hasFilter
                ? t("lib.empty.filtered.title")
                : t("lib.empty.title")}
          </p>
          <p className="max-w-sm text-sm">
            {staleAlone
              ? t("lib.stale.empty.desc")
              : hasFilter
                ? t("lib.empty.filtered.desc")
                : t("lib.empty.desc")}
          </p>
          {!hasFilter && (
            <Button
              className="mt-2"
              onClick={() => {
                setEditing(null);
                setPrefillUrl(null);
                setDialogOpen(true);
              }}
            >
              <Plus />
              {t("lib.empty.add")}
            </Button>
          )}
        </div>
      ) : viewMode === "board" ? (
        <BoardView
          key={`board-${imgNonce}`}
          resources={boardResources ?? []}
          onOpen={(r) => void handleBoardOpen(r)}
          onMove={handleMoveStatusColumn}
        />
      ) : (
        <ResourceGrid
          key={`grid-${imgNonce}`}
          resources={displayed}
          visibleFolders={visibleFolders}
          foldersList={foldersList}
          captures={captures}
          selectMode={selectMode}
          selectedIds={selectedIds}
          toggleSelect={toggleSelect}
          viewMode={viewMode}
          tileMin={tileMin}
          sortBy={sortBy}
          openFolder={openFolder}
          dragId={dragId}
          dragFolderId={dragFolderId}
          dropZone={dropZone}
          setDropZone={setDropZone}
          folderDropHint={folderDropHint}
          setFolderDropHint={setFolderDropHint}
          setDragId={setDragId}
          setDragFolderId={setDragFolderId}
          handleDragStarted={handleDragStarted}
          handleDropOnTile={handleDropOnTile}
          handleDropOnFolder={handleDropOnFolder}
          handleFolderDrop={handleFolderDrop}
          moveTileByKey={moveTileByKey}
          handleDissolveFolder={handleDissolveFolder}
          handleDeleteFolder={handleDeleteFolder}
          setDetailsViewing={setDetailsViewing}
          handleEdit={handleEdit}
          handleDelete={handleDelete}
          setNoteViewing={setNoteViewing}
          handleSetStatus={handleSetStatus}
          handleMoveToFolder={handleMoveToFolder}
          handleUploadToCloud={handleUploadToCloud}
          refresh={refresh}
          setFolderStack={setFolderStack}
          setFolderName={setFolderName}
          setFolderDialog={setFolderDialog}
          page={page}
          onPagination={handlePagination}
        />
      )}
      {/* barre d'actions de la sélection */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 animate-pop-in items-center gap-2 rounded-2xl border bg-popover px-4 py-2 shadow-2xl">
          <span className="text-sm font-medium tabular-nums">
            {selectedIds.size} {t("lib.bulk.selected")}
          </span>
          <span className="mx-1 h-5 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds(new Set(displayed.map((r) => r.id)))}
          >
            {t("lib.bulk.selectAll")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds(new Set())}
          >
            {t("lib.bulk.deselect")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleBulkArchive()}
          >
            <Archive />
            {t("lib.bulk.archive")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void handleBulkDelete()}
          >
            <Trash2 />
            {t("lib.bulk.delete")}
          </Button>
        </div>
      )}

      <ResourceDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) {
            setPrefillUrl(null);
          }
        }}
        editing={editing}
        prefillUrl={prefillUrl}
        initialFolderId={editing ? undefined : (openFolder?.id ?? null)}
        onShowExisting={(res) => setDetailsViewing(res)}
        onSaved={refresh}
      />

      <TagManagerDialog
        open={tagManagerOpen}
        onOpenChange={setTagManagerOpen}
        onChanged={refresh}
      />

      <NoteEditor
        open={noteEditorOpen}
        onOpenChange={setNoteEditorOpen}
        note={noteEditing}
        initialFolderId={openFolder?.id ?? null}
        onSaved={refresh}
      />
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
      <NoteViewer
        note={noteViewing}
        onClose={() => setNoteViewing(null)}
        onEdit={(res) => {
          setNoteViewing(null);
          setNoteEditing(res);
          setNoteEditorOpen(true);
        }}
        onChanged={refresh}
      />

      {/* fiche « Détails » d'une ressource (README pour les dépôts GitHub) */}
      <ResourceDetails
        resource={detailsViewing}
        onClose={() => setDetailsViewing(null)}
        onEdit={(res) => {
          setDetailsViewing(null);
          setEditing(res);
          setDialogOpen(true);
        }}
      />

      {/* joindre un fichier depuis le cloud (WebDAV) */}
      <Dialog open={cloudDialogOpen} onOpenChange={setCloudDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Joindre depuis le cloud")}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              placeholder={t("Filtrer par nom de fichier…")}
              value={cloudQuery}
              onChange={(e) => setCloudQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void searchCloudFiles();
              }}
            />
            <Button
              onClick={() => void searchCloudFiles()}
              disabled={cloudSearching}
            >
              {cloudSearching ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Search />
              )}
              {t("Lister")}
            </Button>
          </div>
          {cloudSearching ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("Lecture du dossier cloud…")}
            </div>
          ) : cloudResults !== null ? (
            cloudResults.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {cloudQuery.trim()
                  ? t("Aucun fichier trouvé pour « {name} ».", {
                      name: cloudQuery.trim(),
                    })
                  : t(
                      "Aucun fichier envoyé pour l'instant — envoie-en un depuis le menu ⋯ d'une tuile fichier.",
                    )}
              </p>
            ) : (
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border p-2">
                {cloudResults.map((f) => {
                  const adding = cloudAddingId === f.name;
                  const modified = f.modified ? new Date(f.modified) : null;
                  return (
                    <div
                      key={f.name}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                    >
                      <Cloud className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {f.name.replace(/^\d{8}-\d{6}-/, "")}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {modified && !Number.isNaN(modified.getTime())
                            ? modified.toLocaleDateString("fr-FR")
                            : ""}
                          {f.size != null
                            ? ` · ${f.size < 1024 ? `${f.size} o` : f.size < 1048576 ? `${(f.size / 1024).toFixed(1)} Ko` : `${(f.size / 1048576).toFixed(1)} Mo`}`
                            : ""}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={adding}
                        title={t(
                          "Télécharger et joindre ce fichier comme ressource locale",
                        )}
                        onClick={() => void addCloudFileAsResource(f)}
                      >
                        {adding ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Plus />
                        )}
                        {t("Joindre")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <p className="py-2 text-sm text-muted-foreground">
              {t(
                "Choisis le fichier à rapatrier dans Documents\\Vaultly\\Fichiers — il sera joint comme ressource locale, lisible hors connexion.",
              )}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloudDialogOpen(false)}>
              {t("Fermer")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* création / renommage de dossier */}
      <FolderCreateDialog
        state={folderDialog}
        name={folderName}
        onNameChange={setFolderName}
        onClose={() => setFolderDialog(null)}
        parentFolderId={openFolder?.id ?? null}
        onBreadcrumbRename={(folderId, name) =>
          setFolderStack((s) =>
            s.map((f) => (f.id === folderId ? { ...f, name } : f)),
          )
        }
        onRefresh={refresh}
      />
    </div>
  );
}

/** Onglet de type : soulignement coloré quand actif, compteur discret. */
function FilterTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative shrink-0 cursor-pointer px-3 py-2 text-sm outline-none transition-colors",
        active
          ? "font-medium text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {count > 0 && (
        <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
      {active && (
        <span className="absolute inset-x-2 bottom-1 h-0.5 rounded-full bg-primary" />
      )}
    </button>
  );
}

/** Barre de pagination de la grille, rendue dans la toolbar (fil d'Ariane en
 *  dossier, à droite de « Statut » à la racine). Masquée s'il n'y a qu'une
 *  page (liste incluse : la liste ne paginer pas → pages = 1). */
function GridPager({
  page,
  pages,
  total,
  onPage,
  className,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (p: number) => void;
  className?: string;
}) {
  const { t } = useI18n();
  if (pages <= 1) return null;
  const current = Math.min(page, pages - 1);
  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      <Button
        variant="outline"
        size="icon-sm"
        disabled={current <= 0}
        onClick={() => onPage(current - 1)}
        title={t("Page précédente")}
        aria-label={t("Page précédente")}
      >
        <ChevronLeft />
      </Button>
      <span className="text-xs text-muted-foreground tabular-nums">
        {current + 1} / {pages}
        <span className="ml-1 opacity-70">· {total}</span>
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        disabled={current >= pages - 1}
        onClick={() => onPage(current + 1)}
        title={t("Page suivante")}
        aria-label={t("Page suivante")}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

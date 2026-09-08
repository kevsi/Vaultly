import {
  ArrowDownAZ,
  ArrowLeft,
  CalendarDays,
  Camera,
  Clock,
  Copy,
  Flame,
  FolderOpen,
  FolderPlus,
  History,
  Info,
  LayoutGrid,
  Cloud,
  ExternalLink,
  List,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Star,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { gdriveSearchFiles, gdriveUpload } from "@/lib/api";
import { suppressClipboardCapture } from "@/lib/useClipboardCapture";
import {
  addResource,
  allTags,
  createFolder,
  deleteFolder,
  deleteResource,
  deleteResources,
  dissolveFolder,
  listFolders,
  listResources,
  moveFolder,
  openResourcesFolder,
  reorderResources,
  renameFolder,
  setResourceFolder,
  setResourceStatus,
} from "@/lib/api";
import { RESOURCE_TYPES, hostOf, typeLabel } from "@/lib/resources";
import { metaSummary } from "@/lib/metaFields";
import { fileKindFor } from "@/lib/fileKind";
import { openResource } from "@/lib/openResource";
import {
  getVirtualMode,
  virtualThresholdFor,
} from "@/lib/gridVirtualization";
import {
  getTileSize,
  tileMinPx,
  getViewMode,
  setViewMode as persistViewMode,
  type ViewMode,
} from "@/lib/tileSize";
import type { DriveFile, Folder, Resource, SortBy } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ConfirmDialog, type ConfirmState } from "@/components/ConfirmDialog";

import { ResourceTile } from "@/components/ResourceTile";
import { FolderTile } from "@/components/FolderTile";
import { NoteEditor } from "@/components/NoteEditor";
import { NoteViewer } from "@/components/NoteViewer";
import { ResourceDialog } from "@/components/ResourceDialog";
import { ResourceDetails } from "@/components/ResourceDetails";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SORTS: { value: SortBy; label: string; icon: typeof Clock }[] = [
  { value: "recent", label: "Récents", icon: Clock },
  { value: "added", label: "Ajoutés", icon: CalendarDays },
  { value: "oldest", label: "Anciens", icon: History },
  { value: "mostUsed", label: "Plus utilisés", icon: Flame },
  { value: "manual", label: "Placement", icon: LayoutGrid },
  { value: "title", label: "A→Z", icon: ArrowDownAZ },
];

/** Icône de ligne (vue LISTE) : favicon, icône d'extension pour les
 *  fichiers, initiales en repli — avec gestion locale de l'erreur image. */
function RowIcon({ resource }: { resource: Resource }) {
  const [imgError, setImgError] = useState(false);
  const kind = resource.resourceType === "fichier" ? fileKindFor(resource) : null;
  const KindIcon = kind?.icon;
  return (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
      {resource.favicon && !imgError ? (
        <img
          src={resource.favicon}
          alt=""
          loading="lazy"
          className="size-full object-contain p-1"
          onError={() => setImgError(true)}
        />
      ) : KindIcon ? (
        <KindIcon className={`size-4 ${kind?.className ?? ""}`} />
      ) : (
        <span className="text-[10px] font-bold uppercase text-muted-foreground">
          {resource.title.slice(0, 2)}
        </span>
      )}
    </span>
  );
}

/** Menu ⋯ compact des lignes de la vue LISTE : couvre les actions les plus
 *  courantes sans dupliquer tout le menu de ResourceTile. */
function RowMenu({
  resource,
  onOpen,
  onDetails,
  onEdit,
  onDelete,
}: {
  resource: Resource;
  onOpen: () => void;
  onDetails: (r: Resource) => void;
  onEdit: (r: Resource) => void;
  onDelete: (r: Resource) => void;
}) {
  return (
    <div
      className="flex justify-end"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Options pour « ${resource.title} »`}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground data-[popup-open]:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={onOpen}>
            <ExternalLink />
            Ouvrir
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDetails(resource)}>
            <Info />
            Détails
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void navigator.clipboard
                .writeText(resource.url)
                .then(() => toast.success("URL copiée"))
                .catch(() => toast.error("Copie impossible"));
            }}
          >
            <Copy />
            Copier l'URL
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onEdit(resource)}>
            <Pencil />
            Modifier
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(resource)}>
            <Trash2 />
            Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function LibraryView() {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("recent");
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
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragFolderId, setDragFolderId] = useState<number | null>(null);
  /** zone de dépôt pendant le drag d'une ressource : bord gauche/droit de la
   *  tuile = trait d'insertion, centre = fusion en dossier */
  const [dropZone, setDropZone] = useState<{
    id: number;
    zone: "left" | "right" | "center";
  } | null>(null);
  const [folderDropHint, setFolderDropHint] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [prefillUrl, setPrefillUrl] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteEditing, setNoteEditing] = useState<Resource | null>(null);
  const [noteViewing, setNoteViewing] = useState<Resource | null>(null);
  /** vue « Détails » d'une ressource (fiche complète, README des dépôts) */
  const [detailsViewing, setDetailsViewing] = useState<Resource | null>(null);
  // --- Joindre un fichier depuis Google Drive ---
  const [driveDialogOpen, setDriveDialogOpen] = useState(false);
  const [driveQuery, setDriveQuery] = useState("");
  const [driveResults, setDriveResults] = useState<DriveFile[] | null>(null);
  const [driveSearching, setDriveSearching] = useState(false);
  const [driveAddingId, setDriveAddingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [captures, setCaptures] = useState(
    () => localStorage.getItem("vaultly-captures") === "1",
  );
  const [folderDialog, setFolderDialog] = useState<
    { mode: "create" } | { mode: "rename"; folder: Folder } | null
  >(null);
  const [folderName, setFolderName] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

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
        dialogOpen || noteEditorOpen || noteViewing !== null || detailsViewing !== null || folderDialog !== null || driveDialogOpen || confirm !== null;
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
        goUp();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFolder, dialogOpen, noteEditorOpen, noteViewing, detailsViewing, folderDialog, driveDialogOpen, confirm]);

  // URL capturée depuis le presse-papiers : modale pré-remplie.
  // Ignorée si un dialogue est déjà ouvert : elle écraserait la saisie en cours.
  const anyDialogRef = useRef(false);
  useEffect(() => {
    anyDialogRef.current =
      dialogOpen || noteEditorOpen || noteViewing !== null || detailsViewing !== null || folderDialog !== null || driveDialogOpen || confirm !== null;
  }, [dialogOpen, noteEditorOpen, noteViewing, detailsViewing, folderDialog, driveDialogOpen, confirm]);
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

  const queryKey = [
    "resources",
    debounced,
    typeFilter,
    category,
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
        category,
        tag: tagFilter,
        status: statusFilter,
        favorite: favOnly,
        sortBy,
        // accueil = ressources sans dossier ; dossier ouvert = son contenu
        folderId: openFolder?.id ?? null,
        unfiledOnly: !openFolder,
      }),
  });

  const { data: allTagsList } = useQuery({
    queryKey: ["allTags"],
    queryFn: allTags,
  });

  const { data: folders } = useQuery({
    queryKey: ["folders"],
    queryFn: listFolders,
  });

  // stable entre les renders : passé aux tuiles mémoïsées (sinon `?? []`
  // crée un nouveau tableau à chaque render et invalide le memo).
  const foldersList = useMemo(() => folders ?? [], [folders]);
  const visibleFolders = useMemo(
    () =>
      foldersList.filter((f) =>
        openFolder ? f.parentId === openFolder.id : f.parentId === null,
      ),
    [foldersList, openFolder],
  );

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
  // grille native fluide : largeur min par tuile, le navigateur remplit
  const nativeGridStyle = {
    gridTemplateColumns: `repeat(auto-fill, minmax(${tileMin}px, 1fr))`,
  } as const;

  // --- virtualisation de la grille (seuil réglable dans Réglages → Général) ---
  // virtualise PAR LIGNES (n tuiles/ligne calculé à la largeur) : le drag
  // natif HTML5 continue de fonctionner, la mémoire DOM reste bornée.
  // En mode virtualisé, on n'utilise PAS le ScrollArea : TanStack Virtual
  // exige un conteneur de scroll dont IL connaît la géométrie (le viewport
  // Base UI ajoute ses propres couches, les mesures deviennent fausses) —
  // un simple div overflow-y-auto est le pattern documenté.
  const virtualScrollRef = useRef<HTMLDivElement | null>(null);
  const [virtualMode, setVirtualModeState] = useState(getVirtualMode);
  useEffect(() => {
    // le réglage changé dans Réglages s'applique sans remontage de la vue
    const onChange = () => setVirtualModeState(getVirtualMode());
    window.addEventListener("vaultly:virtualization-changed", onChange);
    return () =>
      window.removeEventListener("vaultly:virtualization-changed", onChange);
  }, []);
  const threshold = virtualThresholdFor(virtualMode);
  const tileCount = (resources ?? []).length + visibleFolders.length;
  // jamais pendant le chargement ni sur une grille vide : les états
  // squelette/vide vivent dans la branche ScrollArea. La vue Liste n'a
  // pas besoin de virtualisation (lignes légères) : grille seulement.
  const virtualizing =
    viewMode === "grid" &&
    !isLoading &&
    tileCount > 0 &&
    tileCount >= threshold;
  const [columns, setColumns] = useState(4);
  useEffect(() => {
    if (!virtualizing) return;
    const el = virtualScrollRef.current;
    if (!el) return;
    // colonnes = floor(largeur / (tuile min + gap 12px)) — min 2, max 12
    const compute = () =>
      setColumns(
        Math.min(12, Math.max(2, Math.floor(el.clientWidth / (tileMin + 12)))),
      );
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [virtualizing, tileMin]);

  // items de la grille dans l'ordre : dossiers, tuile « créer », ressources
  const gridItems = useMemo(() => {
    const items: Array<
      { k: "folder"; f: Folder } | { k: "create" } | { k: "res"; r: Resource }
    > = [
      ...visibleFolders.map((f) => ({ k: "folder" as const, f })),
      { k: "create" as const },
      ...(resources ?? []).map((r) => ({ k: "res" as const, r })),
    ];
    return items;
  }, [visibleFolders, resources]);

  // lignes virtuelles : hauteur estimée puis MESURÉE (measureElement) —
  // les tuiles sont fluides (minmax 9rem), l'estimation seule suffit pas.
  // Sans padding-top sur le conteneur : la première ligne doit démarrer
  // exactement à l'origine du contenu, sinon le calcul de plage est décalé.
  const rowCount = virtualizing ? Math.ceil(gridItems.length / columns) : 0;
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => virtualScrollRef.current,
    estimateSize: () => 176, // tuile carrée ~144px + gap 12 + marge hover
    overscan: 4,
  });

  function toggleCaptures() {
    const next = !captures;
    setCaptures(next);
    localStorage.setItem("vaultly-captures", next ? "1" : "0");
  }

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

  /** Dépose d'une tuile pendant le drag d'une ressource :
   *  - zone CENTRALE de la cible → crée un dossier avec les deux (fusion) ;
   *  - moitiés gauche/droite → insère la tuile à cet interstice (trait). */
  async function handleDropOnTile(target: Resource, zone: "left" | "right" | "center") {
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
        const folder = await createFolder(name, undefined, openFolder?.id ?? null);
        await setResourceFolder(moved.id, folder.id);
        await setResourceFolder(target.id, folder.id);
        const shown = folder.name.length > 45 ? `${folder.name.slice(0, 45)}…` : folder.name;
        toast.success(`Dossier « ${shown} » créé`, {
          description: "Renomme-le depuis son menu ⋯ si besoin.",
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
      toast.error(String(e));
      refresh();
    }
  }

  /** Zone du pointeur sur la tuile cible : 30 % extérieurs = insertion
   *  (trait), 40 % centraux = fusion en dossier. */
  function zoneFor(e: React.DragEvent): "left" | "right" | "center" {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    if (x < w * 0.3) return "left";
    if (x > w * 0.7) return "right";
    return "center";
  }

  /** Ouverture d'une ressource depuis la vue LISTE (même sémantique que
   *  la tuile : note → lecteur, sans lien → édition, sinon openResource). */
  async function openRow(r: Resource) {
    if (r.resourceType === "note") {
      setNoteViewing(r);
      return;
    }
    if (r.url.startsWith("local:") && !r.meta?.filePath) {
      handleEdit(r);
      return;
    }
    try {
      await openResource(r);
      void qc.invalidateQueries({ queryKey: ["resources"] });
    } catch (e) {
      toast.error(`Ouverture impossible : ${e}`);
    }
  }

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
      toast.success(`Déplacé dans « ${target.name} »`);
      refresh();
    } catch (e) {
      toast.error(String(e));
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
      toast.success(`Rangée dans « ${folder.name} »`);
      refresh();
    } catch (e) {
      toast.error(String(e));
    }
  }

  const handleMoveToFolder = useCallback(
    async (r: Resource, folderId: number | null) => {
      try {
        await setResourceFolder(r.id, folderId);
        toast.success(
          folderId === null
            ? "Sortie du dossier"
            : `Rangée dans « ${foldersList.find((f) => f.id === folderId)?.name ?? "?"} »`,
        );
        refresh();
      } catch (e) {
        toast.error(String(e));
      }
    },
    [foldersList, refresh],
  );

  const handleUploadToDrive = useCallback(async (r: Resource) => {
    const path =
      r.meta?.filePath ?? (r.url.startsWith("file:") ? r.url.slice(5) : "");
    if (!path) {
      toast.error("Ce fichier n'a pas de chemin local enregistré");
      return;
    }
    toast.info("Envoi vers Google Drive en cours…");
    try {
      const link = await gdriveUpload(path);
      await navigator.clipboard.writeText(link).catch(() => {
        toast.warning(`Copie impossible — lien : ${link}`);
      });
      suppressClipboardCapture(link);
      toast.success(`Envoyé — lien de partage copié`);
    } catch (e) {
      toast.error(String(e));
    }
  }, []);

  async function searchDriveFiles() {
    const q = driveQuery.trim();
    if (!q) {
      toast.error("Tape un mot-clé pour chercher dans le Drive");
      return;
    }
    setDriveSearching(true);
    try {
      setDriveResults(await gdriveSearchFiles(q));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDriveSearching(false);
    }
  }

  async function addDriveFileAsResource(f: DriveFile) {
    setDriveAddingId(f.id);
    try {
      const url =
        f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`;
      await addResource({
        url,
        title: f.name,
        resourceType: "site",
        category: "Google Drive",
        tags: ["drive"],
      });
      toast.success(`« ${f.name} » ajouté à la bibliothèque`);
      refresh();
      setDriveDialogOpen(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDriveAddingId(null);
    }
  }

  const toggleSelect = useCallback((r: Resource) => {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(r.id)) next.delete(r.id);
      else next.add(r.id);
      return next;
    });
  }, []);

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
        toast.error(String(e));
      }
      refresh();
    },
    [resources, qc, queryKey, refresh],
  );

  function handleBulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setConfirm({
      title: `Supprimer ${ids.length} ressource${ids.length > 1 ? "s" : ""} ?`,
      message: "Elles seront restaurables 30 jours dans la corbeille (Réglages).",
      confirmLabel: "Supprimer",
      destructive: true,
      action: async () => {
        try {
          const n = await deleteResources(ids);
          toast.success(`${n} ressource(s) déplacée(s) dans la corbeille`);
          setSelectedIds(new Set());
          setSelectMode(false);
          refresh();
        } catch (e) {
          toast.error(String(e));
        }
      },
    });
  }

  /**
   * Statut lié aux dossiers système : « À traiter » et « Archivés » sont
   * créés automatiquement (une seule fois) et la ressource y est rangée.
   * Réactiver la sort de son dossier et remet le statut à vide.
   */
  const handleSetStatus = useCallback(
    async (r: Resource, status: "" | "todo" | "archived") => {
      try {
        await setResourceStatus(r.id, status);
        if (status === "todo" || status === "archived") {
          const name = status === "todo" ? "À traiter" : "Archivés";
          let folder = (await listFolders()).find(
            (f) => f.name === name && f.parentId === null,
          );
          if (!folder) folder = await createFolder(name);
          await setResourceFolder(r.id, folder.id);
          toast.success(`Rangée dans « ${name} »`);
        } else {
          await setResourceFolder(r.id, null);
          toast.success("Réactivée");
        }
        refresh();
      } catch (e) {
        toast.error(String(e));
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    (r: Resource) => {
    setConfirm({
      title: `Supprimer « ${r.title} » ?`,
      message: "Elle sera restaurable 30 jours dans la corbeille (Réglages).",
      confirmLabel: "Supprimer",
      destructive: true,
      action: async () => {
        try {
          await deleteResource(r.id);
          toast.success("Déplacée dans la corbeille");
          refresh();
          } catch (e) {
            toast.error(String(e));
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

  async function submitFolderDialog() {
    if (!folderDialog) return;
    const name = folderName.trim();
    if (!name) {
      toast.error("Donne un nom au dossier");
      return;
    }
    try {
      if (folderDialog.mode === "create") {
        // créé dans le dossier courant (imbrication)
        await createFolder(name, undefined, openFolder?.id ?? null);
        toast.success(`Dossier « ${name} » créé`);
      } else {
        await renameFolder(folderDialog.folder.id, name);
        toast.success("Dossier renommé");
        // met à jour le fil d'ariane si le dossier renommé y figure
        setFolderStack((s) =>
          s.map((f) => (f.id === folderDialog.folder.id ? { ...f, name } : f)),
        );
      }
      setFolderDialog(null);
      refresh();
    } catch (e) {
      toast.error(String(e));
    }
  }

  function handleDeleteFolder(f: Folder) {
    setConfirm({
      title: `Supprimer le dossier « ${f.name} » ?`,
      message: "Les ressources qu'il contient ressortiront dans la grille.",
      confirmLabel: "Supprimer",
      destructive: true,
      action: async () => {
        try {
          await deleteFolder(f.id);
          if (openFolder?.id === f.id) goUp();
          toast.success("Dossier supprimé");
          refresh();
        } catch (e) {
          toast.error(String(e));
        }
      },
    });
  }

  function handleDissolveFolder(f: Folder) {
    setConfirm({
      title: `Dissoudre le dossier « ${f.name} » ?`,
      message:
        "Ses ressources reviennent dans la grille et ses sous-dossiers remontent d'un niveau. Rien n'est supprimé.",
      confirmLabel: "Dissoudre",
      action: async () => {
        try {
          await dissolveFolder(f.id);
          if (openFolder?.id === f.id) goUp();
          toast.success(`Dossier « ${f.name} » dissous`);
          refresh();
        } catch (e) {
          toast.error(String(e));
        }
      },
    });
  }

  // compteurs de types sur le jeu de résultats courant
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of resources ?? []) {
      m.set(r.resourceType, (m.get(r.resourceType) ?? 0) + 1);
    }
    return m;
  }, [resources]);

  // catégories présentes (pour le menu déroulant)
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of resources ?? []) {
      if (r.category) set.add(r.category);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [resources]);

  // onglets : types connus + types libres éventuels
  const tabs = useMemo(() => {
    const known = RESOURCE_TYPES.map((t) => t.value);
    const extras = [...typeCounts.keys()].filter((t) => !known.includes(t));
    return [...known, ...extras];
  }, [typeCounts]);

  const sortDef = SORTS.find((s) => s.value === sortBy) ?? SORTS[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* barre d'outils */}
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <div className="relative max-w-md grow">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="Rechercher…  (raccourci : /)"
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
            {SORTS.map((s) => (
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
          title="Favoris seulement"
        >
          <Star className={favOnly ? "fill-yellow-400 text-yellow-400" : ""} />
        </Button>
        <Button
          variant={captures ? "default" : "outline"}
          size="icon"
          onClick={toggleCaptures}
          title="Voir les captures d'écran des sites (au lieu des favicons)"
        >
          <Camera />
        </Button>
        {/* bascule Tuiles / Liste : l'apparence se mémorise */}
        <div className="flex items-center rounded-lg border p-0.5">
          <Button
            variant={viewMode === "grid" ? "default" : "ghost"}
            size="icon-sm"
            onClick={() => persistViewMode("grid")}
            title="Affichage en tuiles"
          >
            <LayoutGrid />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "ghost"}
            size="icon-sm"
            onClick={() => persistViewMode("list")}
            title="Affichage en liste"
          >
            <List />
          </Button>
        </div>
        <Button
          variant="outline"
          size="icon"
          title="Ouvrir le dossier de ressources (Documents\\Vaultly)"
          onClick={() =>
            openResourcesFolder()
              .then(() => toast.success("Dossier de ressources ouvert"))
              .catch((e) => toast.error(String(e)))
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
          title="Sélectionner des ressources pour agir en masse"
        >
          <ListChecks />
          {selectMode ? "Quitter" : "Sélectionner"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setDriveQuery("");
            setDriveResults(null);
            setDriveDialogOpen(true);
          }}
          title="Joindre un fichier depuis Google Drive"
        >
          <Cloud />
          Depuis Drive
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="Ouvrir Google Drive dans le navigateur"
          onClick={() =>
            openUrl("https://drive.google.com/")
              .catch((e) => toast.error(String(e)))
          }
        >
          <Cloud />
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setNoteEditing(null);
            setNoteEditorOpen(true);
          }}
          title="Nouvelle note (Ctrl+Alt+N)"
        >
          <StickyNote />
          Note
        </Button>
        <Button
          onClick={() => {
            setEditing(null);
            setPrefillUrl(null);
            setDialogOpen(true);
          }}
        >
          <Plus />
          Ajouter
        </Button>
      </div>

      {/* onglets de types + catégories — wrap, jamais de scrollbar */}
      <div className="flex flex-wrap items-center gap-x-1 border-b px-3">
        <FilterTab
          label="Tout"
          count={(resources ?? []).length}
          active={typeFilter === null}
          onClick={() => setTypeFilter(null)}
        />
        {tabs.map((t) => (
          <FilterTab
            key={t}
            label={RESOURCE_TYPES.find((r) => r.value === t)?.label ?? t}
            count={typeCounts.get(t) ?? 0}
            active={typeFilter === t}
            onClick={() => setTypeFilter(typeFilter === t ? null : t)}
          />
        ))}
        {/* filtres combinés : catégorie · tag · statut, côte à côte */}
        <span className="grow" />
        {categories.length > 0 && (
          <Select
            value={category ?? "__all"}
            onValueChange={(v) => setCategory(v === "__all" ? null : (v ?? null))}
          >
            <SelectTrigger
              size="sm"
              className={cn(
                "my-1 shrink-0",
                category && "border-primary/60 text-foreground",
              )}
            >
              <SelectValue placeholder="Catégorie">
                {category ?? "Catégories"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="w-auto min-w-[9rem] max-w-[24rem]">
              <SelectItem value="__all">Toutes</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {(allTagsList?.length ?? 0) > 0 && (
          <Select
            value={tagFilter ?? "__all"}
            onValueChange={(v) => setTagFilter(v === "__all" ? null : (v ?? null))}
          >
            <SelectTrigger
              size="default"
              className={cn(
                "my-1 shrink-0 px-3",
                tagFilter && "border-primary/60 text-foreground",
              )}
            >
              <SelectValue placeholder="Tags">
                {tagFilter ? `#${tagFilter}` : "Tags"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="w-auto min-w-[9rem] max-w-[24rem]">
              <SelectItem value="__all">Tous les tags</SelectItem>
              {allTagsList!.map((t) => (
                <SelectItem key={t} value={t}>
                  #{t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select
          value={statusFilter === "" ? "__active" : (statusFilter ?? "__all")}
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
            <SelectValue placeholder="Statut">
              {statusFilter === "todo"
                ? "À traiter"
                : statusFilter === "archived"
                  ? "Archivés"
                  : statusFilter === ""
                    ? "Actifs"
                    : "Statut"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Tous</SelectItem>
            <SelectItem value="__active">Actifs</SelectItem>
            <SelectItem value="todo">À traiter</SelectItem>
            <SelectItem value="archived">Archivés</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* fil d'ariane : Racine > ... > dossier ouvert, chaque segment cliquable */}
      {openFolder && (
        <div className="flex animate-slide-down items-center gap-2 px-4 pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={goUp}
            title={folderStack.length > 1 ? "Dossier précédent" : "Racine"}
          >
            <ArrowLeft />
            Retour
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
                      onClick={() =>
                        setFolderStack((s) => s.slice(0, i + 1))
                      }
                      className="cursor-pointer truncate text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      title={`Aller à « ${f.name} »`}
                    >
                      {f.name}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
          <span className="shrink-0 text-xs text-muted-foreground">
            {(resources ?? []).length} ressource
            {(resources ?? []).length > 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* hint tri manuel */}
      {sortBy === "manual" && !openFolder && (
        <div className="px-4 pt-2 text-xs text-muted-foreground">
          Glisse une tuile : un trait entre deux cartes les réordonne — lâche
          au centre d'une carte pour créer un dossier avec les deux — pose sur
          un dossier pour la ranger dedans. Au clavier : Ctrl+Maj+←/→ déplace
          la tuile sélectionnée.
        </div>
      )}

      {/* le backend plafonne la vue à 500 lignes : le dire, pas le cacher */}
      {(resources ?? []).length >= 500 && (
        <div className="px-4 pt-2 text-xs text-amber-600 dark:text-amber-500">
          Affichage limité aux 500 premières ressources — affine la recherche
          ou un filtre pour voir le reste.
        </div>
      )}

      {/* grille : dossiers puis ressources. Virtualisation par lignes au
         -delà du seuil réglé (Réglages → Général) : conteneur de scroll
          dédié (PAS le ScrollArea — voir le commentaire du hook). En
          dessous du seuil, rendu natif dans le ScrollArea habituel. */}
      {virtualizing ? (
        <div
          ref={virtualScrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
        >
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={rowVirtualizer.measureElement}
                  className="grid gap-3"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  {gridItems
                    .slice(vi.index * columns, (vi.index + 1) * columns)
                    .map((it) =>
                      it.k === "folder" ? (
                        <div key={`folder-${it.f.id}`} className="animate-tile-in">
                          <FolderTile
                            folder={it.f}
                            onOpen={(fo) => setFolderStack((s) => [...s, fo])}
                            onRename={(fo) => {
                              setFolderName(fo.name);
                              setFolderDialog({ mode: "rename", folder: fo });
                            }}
                            onDissolve={(fo) => void handleDissolveFolder(fo)}
                            onDelete={(fo) => void handleDeleteFolder(fo)}
                            dropHint={folderDropHint === it.f.id}
                            onDragOver={(e) => {
                              if (dragId === null && dragFolderId === null) return;
                              e.preventDefault();
                              setFolderDropHint(it.f.id);
                            }}
                            onDragLeave={() =>
                              setFolderDropHint((h) => (h === it.f.id ? null : h))
                            }
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (dragFolderId !== null) {
                                void handleFolderDrop(it.f);
                              } else {
                                void handleDropOnFolder(it.f);
                              }
                            }}
                          />
                        </div>
                      ) : it.k === "create" ? (
                        <button
                          key="create"
                          onClick={() => {
                            setFolderName("");
                            setFolderDialog({ mode: "create" });
                          }}
                          title={
                            openFolder
                              ? `Nouveau sous-dossier dans « ${openFolder.name} »`
                              : "Nouveau dossier"
                          }
                          className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-3 text-muted-foreground transition-colors outline-none hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                          <FolderPlus className="size-7 opacity-70" />
                          <span className="text-center text-xs font-medium">
                            Nouveau dossier
                          </span>
                        </button>
                      ) : (
                        <div
                          key={it.r.id}
                          onKeyDown={(e) => {
                            if (
                              sortBy === "manual" &&
                              e.ctrlKey &&
                              e.shiftKey &&
                              (e.key === "ArrowLeft" || e.key === "ArrowRight")
                            ) {
                              e.preventDefault();
                              void moveTileByKey(
                                it.r,
                                e.key === "ArrowLeft" ? -1 : 1,
                              );
                            }
                          }}
                          onDragOver={(e) => {
                            if (dragId === null) return;
                            e.preventDefault();
                            const zone = zoneFor(e);
                            setDropZone((h) =>
                              h && h.id === it.r.id && h.zone === zone
                                ? h
                                : { id: it.r.id, zone },
                            );
                          }}
                          onDragLeave={() =>
                            setDropZone((h) => (h?.id === it.r.id ? null : h))
                          }
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dropZone?.id === it.r.id)
                              void handleDropOnTile(it.r, dropZone.zone);
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setDropZone(null);
                            setFolderDropHint(null);
                          }}
                          className={cn(
                            "relative rounded-xl transition-shadow",
                            dragId === it.r.id && "opacity-40",
                            dropZone?.id === it.r.id &&
                              dropZone.zone === "left" &&
                              "before:absolute before:inset-y-1 before:-left-[7px] before:z-10 before:w-[3px] before:rounded-full before:bg-primary before:content-['']",
                            dropZone?.id === it.r.id &&
                              dropZone.zone === "right" &&
                              "before:absolute before:inset-y-1 before:-right-[7px] before:z-10 before:w-[3px] before:rounded-full before:bg-primary before:content-['']",
                            dropZone?.id === it.r.id &&
                              dropZone.zone === "center" &&
                              dragId !== it.r.id &&
                              "outline-2 outline-dashed outline-primary/60",
                            selectedIds.has(it.r.id) && selectMode
                              ? "ring-2 ring-amber-500"
                              : "",
                          )}
                        >
                          <ResourceTile
                            resource={it.r}
                            capture={captures && it.r.resourceType !== "note"}
                            selectMode={selectMode}
                            selected={selectedIds.has(it.r.id)}
                            onToggleSelect={toggleSelect}
                            draggable={!selectMode}
                            onDragStarted={handleDragStarted}
                            folders={foldersList}
                            onMoveToFolder={handleMoveToFolder}
                            onOpenNote={setNoteViewing}
                            onDetails={setDetailsViewing}
                            onUploadToDrive={handleUploadToDrive}
                            onSetStatus={handleSetStatus}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onToggled={refresh}
                          />
                        </div>
                      ),
                    )}
                </div>
              ))}
            </div>
        </div>
      ) : viewMode === "list" ? (
        /* ================= VUE LISTE =================
           Lignes denses type tableau : favicon/icône d'extension, titre,
           type · host, meta, ouverture, favori. Même DnD inter-lignes que
           la grille en tri manuel, même menu via ⋯. Dossiers en tête. */
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4 pt-3">
            {isError && (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
                <span>
                  Le chargement de la bibliothèque a échoué (base verrouillée ou erreur interne).
                </span>
                <Button size="sm" variant="outline" onClick={() => void refetch()}>
                  Réessayer
                </Button>
              </div>
            )}
            {(resources ?? []).length === 0 && visibleFolders.length === 0 && !isError ? (
              <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
                <Search className="size-8 opacity-40" />
                <p className="font-medium text-foreground">
                  {debounced || favOnly || category || typeFilter || tagFilter || statusFilter
                    ? "Aucun résultat"
                    : openFolder
                      ? "Ce dossier est vide"
                      : "Ta bibliothèque est vide"}
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border">
                {/* en-tête de colonnes */}
                <div className="grid grid-cols-[minmax(2.5rem,auto)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.2fr)_minmax(4.5rem,auto)_minmax(3rem,auto)] items-center gap-3 border-b bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span />
                  <span>Ressource</span>
                  <span>Lien</span>
                  <span>Détails</span>
                  <span className="text-right">Ouvertures</span>
                  <span />
                </div>
                {/* dossiers en tête de liste */}
                {visibleFolders.map((f) => (
                  <div
                    key={`folder-${f.id}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", `folder:${f.id}`);
                      e.dataTransfer.effectAllowed = "move";
                      setDragFolderId(f.id);
                    }}
                    onDragEnd={() => setDragFolderId(null)}
                    role="button"
                    tabIndex={0}
                    onClick={() => setFolderStack((s) => [...s, f])}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setFolderStack((s) => [...s, f]);
                    }}
                    className="grid cursor-pointer grid-cols-[minmax(2.5rem,auto)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.2fr)_minmax(4.5rem,auto)_minmax(3rem,auto)] items-center gap-3 border-b px-3 py-2 text-sm outline-none transition-colors last:border-b-0 hover:bg-accent/40 focus-visible:bg-accent/40"
                  >
                    <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
                      <FolderOpen className="size-4 text-amber-500" />
                    </span>
                    <span className="truncate font-medium">{f.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      dossier
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {f.count} ressource{f.count > 1 ? "s" : ""}
                    </span>
                    <span />
                    <span />
                  </div>
                ))}
                {/* ressources */}
                {(resources ?? []).map((r) => {
                  const summary = metaSummary(r, 3);
                  return (
                    <div
                      key={r.id}
                      draggable={sortBy === "manual" && !selectMode}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", String(r.id));
                        e.dataTransfer.effectAllowed = "move";
                        handleDragStarted(r);
                      }}
                      onDragOver={(e) => {
                        if (dragId === null) return;
                        e.preventDefault();
                        setDropZone((h) =>
                          h && h.id === r.id ? h : { id: r.id, zone: "center" },
                        );
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dropZone?.id === r.id)
                          void handleDropOnTile(r, dropZone.zone);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropZone(null);
                      }}
                      role="button"
                      tabIndex={0}
                      onClick={() => (selectMode ? toggleSelect(r) : void openRow(r))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectMode ? toggleSelect(r) : void openRow(r);
                        }
                      }}
                      className={cn(
                        "grid cursor-pointer grid-cols-[minmax(2.5rem,auto)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.2fr)_minmax(4.5rem,auto)_minmax(3rem,auto)] items-center gap-3 border-b px-3 py-2 text-sm outline-none transition-colors last:border-b-0 hover:bg-accent/40 focus-visible:bg-accent/40",
                        dragId === r.id && "opacity-40",
                        dropZone?.id === r.id && "outline-2 outline-dashed outline-primary/60",
                        selectedIds.has(r.id) && selectMode && "ring-2 ring-inset ring-amber-500",
                      )}
                    >
                      {/* case (sélection) ou favicon/icône */}
                      {selectMode ? (
                        <span className="flex size-8 items-center justify-center">
                          <Checkbox
                            checked={selectedIds.has(r.id)}
                            tabIndex={-1}
                            aria-label={`Sélectionner « ${r.title} »`}
                          />
                        </span>
                      ) : (
                        <RowIcon resource={r} />
                      )}
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          {r.favorite && r.favicon && (
                            <Star className="size-3 shrink-0 fill-yellow-400 text-yellow-400" />
                          )}
                          <span className="truncate font-medium">{r.title}</span>
                        </span>
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {r.url.startsWith("http") ? hostOf(r.url) : r.url.startsWith("exe:") ? "application" : r.url.startsWith("file:") ? "fichier local" : r.url.startsWith("local:") ? "sans lien" : r.url}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {summary || typeLabel(r.resourceType)}
                      </span>
                      <span className="text-right text-xs tabular-nums text-muted-foreground">
                        {r.openCount > 0 ? r.openCount : "—"}
                      </span>
                      {/* menu d'actions : même ⋯ que la tuile, en version compacte */}
                      <RowMenu
                        onDetails={setDetailsViewing}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onOpen={() => void openRow(r)}
                        resource={r}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4 pt-3">
            {isError && (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
                <span>
                  Le chargement de la bibliothèque a échoué (base verrouillée ou erreur interne).
                </span>
                <Button size="sm" variant="outline" onClick={() => void refetch()}>
                  Réessayer
                </Button>
              </div>
            )}
            {isLoading ? (
              <div className="grid gap-3" style={nativeGridStyle}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="aspect-square animate-pulse rounded-xl bg-muted/60" />
                ))}
              </div>
            ) : (resources ?? []).length === 0 &&
              !isError &&
              !openFolder &&
              (folders ?? []).length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
                <Search className="size-8 opacity-40" />
                <p className="font-medium text-foreground">
                  {debounced || favOnly || category || typeFilter || tagFilter || statusFilter
                    ? "Aucun résultat"
                    : "Ta bibliothèque est vide"}
                </p>
                <p className="max-w-sm text-sm">
                  {debounced || favOnly || category || typeFilter || tagFilter || statusFilter
                    ? "Essaie une autre recherche ou retire les filtres."
                    : "Ajoute ta première ressource, ou importe tes favoris depuis l'onglet Importer."}
                </p>
                {!debounced && !favOnly && !category && !typeFilter && !tagFilter && !statusFilter && (
                  <Button
                    className="mt-2"
                    onClick={() => {
                      setEditing(null);
                      setPrefillUrl(null);
                      setDialogOpen(true);
                    }}
                  >
                    <Plus />
                    Ajouter une ressource
                  </Button>
                )}
              </div>
            ) : (
            <div className="grid gap-3" style={nativeGridStyle}>
              {/* dossiers : racine sur l'accueil, sous-dossiers dans un dossier */}
              {visibleFolders.map((f, i) => (
                  <div
                    key={`folder-${f.id}`}
                    draggable
                    onDragStart={(e) => {
                      // setData obligatoire pour un drag HTML5 fiable :
                      // sans lui, Chromium/WebView2 peut ignorer le drag.
                      e.dataTransfer.setData("text/plain", `folder:${f.id}`);
                      e.dataTransfer.effectAllowed = "move";
                      setDragFolderId(f.id);
                    }}
                    onDragEnd={() => setDragFolderId(null)}
                    className="animate-tile-in"
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <FolderTile
                      folder={f}
                      onOpen={(fo) => setFolderStack((s) => [...s, fo])}
                      onRename={(fo) => {
                        setFolderName(fo.name);
                        setFolderDialog({ mode: "rename", folder: fo });
                      }}
                      onDissolve={(fo) => void handleDissolveFolder(fo)}
                      onDelete={(fo) => void handleDeleteFolder(fo)}
                      dropHint={folderDropHint === f.id}
                      onDragOver={(e) => {
                        if (dragId === null && dragFolderId === null) return;
                        e.preventDefault();
                        setFolderDropHint(f.id);
                      }}
                      onDragLeave={() =>
                        setFolderDropHint((h) => (h === f.id ? null : h))
                      }
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (dragFolderId !== null) {
                          void handleFolderDrop(f);
                        } else {
                          void handleDropOnFolder(f);
                        }
                      }}
                    />
                  </div>
                ))}
              {/* tuile créer un dossier — partout : à la racine comme dans
                  un sous-dossier (la création se fait dans le dossier courant) */}
              <button
                onClick={() => {
                  setFolderName("");
                  setFolderDialog({ mode: "create" });
                }}
                title={
                  openFolder
                    ? `Nouveau sous-dossier dans « ${openFolder.name} »`
                    : "Nouveau dossier"
                }
                className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-3 text-muted-foreground transition-colors outline-none hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <FolderPlus className="size-7 opacity-70" />
                <span className="text-center text-xs font-medium">
                  Nouveau dossier
                </span>
              </button>
              {/* dossier ouvert vide : état visible, pas juste la tuile de création */}
              {openFolder &&
                (resources ?? []).length === 0 &&
                visibleFolders.length === 0 &&
                !isError && (
                  <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
                    Ce dossier est vide — glisse une tuile dessus ou crée une
                    ressource dedans.
                  </p>
                )}
              {/* ressources */}
              {(resources ?? []).map((r, i) => (
                <div
                  key={r.id}
                  style={{ animationDelay: `${(i + (folders?.length ?? 0)) * 40}ms` }}
                  onKeyDown={(e) => {
                    // réordonnancement clavier de la tuile focusée (tri manuel)
                    if (
                      sortBy === "manual" &&
                      e.ctrlKey &&
                      e.shiftKey &&
                      (e.key === "ArrowLeft" || e.key === "ArrowRight")
                    ) {
                      e.preventDefault();
                      void moveTileByKey(r, e.key === "ArrowLeft" ? -1 : 1);
                    }
                  }}
                  onDragOver={(e) => {
                    if (dragId === null) return;
                    e.preventDefault();
                    const zone = zoneFor(e);
                    setDropZone((h) =>
                      h && h.id === r.id && h.zone === zone ? h : { id: r.id, zone },
                    );
                  }}
                  onDragLeave={() =>
                    setDropZone((h) => (h?.id === r.id ? null : h))
                  }
                  onDrop={(e) => {
                    e.preventDefault();
                    // n'agir que si la zone a été réellement calculée pour
                    // CETTE tuile : un repli « center » créerait un dossier
                    // sur tout drop ambigu ou mal étiqueté
                    if (dropZone?.id === r.id) void handleDropOnTile(r, dropZone.zone);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropZone(null);
                    setFolderDropHint(null);
                  }}
                  className={cn(
                    "animate-tile-in relative rounded-xl transition-shadow",
                    dragId === r.id && "opacity-40",
                    // trait d'insertion : bord gauche (avant cette tuile)
                    dropZone?.id === r.id &&
                      dropZone.zone === "left" &&
                      "before:absolute before:inset-y-1 before:-left-[7px] before:z-10 before:w-[3px] before:rounded-full before:bg-primary before:content-['']",
                    // trait d'insertion : bord droit (après cette tuile)
                    dropZone?.id === r.id &&
                      dropZone.zone === "right" &&
                      "before:absolute before:inset-y-1 before:-right-[7px] before:z-10 before:w-[3px] before:rounded-full before:bg-primary before:content-['']",
                    // cible de fusion : contour pointillé = un dossier sera créé
                    dropZone?.id === r.id &&
                      dropZone.zone === "center" &&
                      dragId !== r.id &&
                      "outline-2 outline-dashed outline-primary/60",
                    selectedIds.has(r.id) && selectMode
                      ? "ring-2 ring-amber-500"
                      : "",
                  )}
                >
                  <ResourceTile
                    resource={r}
                    capture={captures && r.resourceType !== "note"}
                    selectMode={selectMode}
                    selected={selectedIds.has(r.id)}
                    onToggleSelect={toggleSelect}
                    draggable={!selectMode}
                    onDragStarted={handleDragStarted}
                    folders={foldersList}
                    onMoveToFolder={handleMoveToFolder}
                    onOpenNote={setNoteViewing}
                    onDetails={setDetailsViewing}
                    onUploadToDrive={handleUploadToDrive}
                    onSetStatus={handleSetStatus}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onToggled={refresh}
                  />
                </div>
              ))}
            </div>
            )}
          </div>
        </ScrollArea>
      )}

      {/* barre d'actions de la sélection */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 animate-pop-in items-center gap-2 rounded-2xl border bg-popover px-4 py-2 shadow-2xl">
          <span className="text-sm font-medium tabular-nums">
            {selectedIds.size} sélectionnée{selectedIds.size > 1 ? "s" : ""}
          </span>
          <span className="mx-1 h-5 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setSelectedIds(new Set((resources ?? []).map((r) => r.id)))
            }
          >
            Tout sélectionner
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds(new Set())}
          >
            Désélectionner
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void handleBulkDelete()}
          >
            <Trash2 />
            Supprimer
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
        onSaved={refresh}
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

      {/* joindre un fichier depuis Google Drive */}
      <Dialog open={driveDialogOpen} onOpenChange={setDriveDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Joindre depuis Google Drive</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              placeholder="Rechercher un fichier dans le Drive…"
              value={driveQuery}
              onChange={(e) => setDriveQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void searchDriveFiles();
              }}
            />
            <Button
              onClick={() => void searchDriveFiles()}
              disabled={driveSearching}
            >
              {driveSearching ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Search />
              )}
              Chercher
            </Button>
          </div>
          {driveSearching ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Recherche en cours…
            </div>
          ) : driveResults !== null ? (
            driveResults.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Aucun fichier trouvé pour « {driveQuery.trim()} ».
              </p>
            ) : (
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border p-2">
                {driveResults.map((f) => {
                  const adding = driveAddingId === f.id;
                  const folder =
                    f.mimeType === "application/vnd.google-apps.folder";
                  return (
                    <div
                      key={f.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                    >
                      <Cloud className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{f.name}</div>
                        {f.modifiedTime && (
                          <div className="truncate text-xs text-muted-foreground">
                            {new Date(f.modifiedTime).toLocaleDateString(
                              "fr-FR",
                              {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                              },
                            )}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={adding || folder}
                        title={
                          folder
                            ? "Les dossiers ne peuvent pas être joints"
                            : "Créer une ressource vers ce fichier"
                        }
                        onClick={() => void addDriveFileAsResource(f)}
                      >
                        {adding ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Plus />
                        )}
                        Joindre
                      </Button>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <p className="py-2 text-sm text-muted-foreground">
              Lance une recherche pour choisir le fichier à ajouter comme
              ressource (son lien Drive sera enregistré).
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDriveDialogOpen(false)}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* création / renommage de dossier */}
      <Dialog
        open={folderDialog !== null}
        onOpenChange={(o) => !o && setFolderDialog(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {folderDialog?.mode === "rename"
                ? "Renommer le dossier"
                : "Nouveau dossier"}
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Nom du dossier"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitFolderDialog();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialog(null)}>
              Annuler
            </Button>
            <Button onClick={() => void submitFolderDialog()}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
      onClick={onClick}
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

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Copy,
  FolderOpen,
  FolderPlus,
  Info,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { fileKindFor } from "@/lib/fileKind";
import { metaSummary } from "@/lib/metaFields";
import { hostOf, typeLabel } from "@/lib/resources";
import { openResource } from "@/lib/openResource";
import {
  getVirtualMode,
  virtualThresholdFor,
} from "@/lib/gridVirtualization";
import type { Resource, Folder, SortBy } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ResourceTile } from "@/components/ResourceTile";
import { FolderTile } from "@/components/FolderTile";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";

export type DropZone = {
  id: number;
  zone: "left" | "right" | "center";
};

export type FolderDialogState =
  | { mode: "create" }
  | { mode: "rename"; folder: Folder }
  | null;

export interface ResourceGridProps {
  resources: Resource[];
  visibleFolders: Folder[];
  /** tous les dossiers (passés aux tuiles pour « Déplacer vers… ») */
  foldersList: Folder[];
  captures: boolean;
  selectMode: boolean;
  selectedIds: Set<number>;
  toggleSelect: (r: Resource) => void;
  viewMode: "grid" | "list";
  tileMin: number;
  sortBy: SortBy;
  openFolder: Folder | null;
  // --- état de drag (porté par LibraryView, partagé avec les handlers) ---
  dragId: number | null;
  dragFolderId: number | null;
  dropZone: DropZone | null;
  setDropZone: React.Dispatch<React.SetStateAction<DropZone | null>>;
  folderDropHint: number | null;
  setFolderDropHint: React.Dispatch<React.SetStateAction<number | null>>;
  setDragId: (id: number | null) => void;
  setDragFolderId: (id: number | null) => void;
  // --- callbacks LibraryView ---
  handleDragStarted: (r: Resource) => void;
  handleDropOnTile: (target: Resource, zone: "left" | "right" | "center") => void;
  handleDropOnFolder: (f: Folder) => void;
  handleFolderDrop: (target: Folder) => void;
  moveTileByKey: (r: Resource, dir: -1 | 1) => void;
  handleDissolveFolder: (f: Folder) => void;
  handleDeleteFolder: (f: Folder) => void;
  setDetailsViewing: (r: Resource) => void;
  handleEdit: (r: Resource) => void;
  handleDelete: (r: Resource) => void;
  setNoteViewing: (r: Resource) => void;
  handleSetStatus: (r: Resource, status: "" | "todo" | "archived") => void;
  handleMoveToFolder: (r: Resource, folderId: number | null) => void;
  handleUploadToCloud: (r: Resource) => void;
  refresh: () => void;
  setFolderStack: (f: (s: Folder[]) => Folder[]) => void;
  setFolderName: (n: string) => void;
  setFolderDialog: (d: FolderDialogState) => void;
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
  onDetails,
  onEdit,
  onDelete,
}: {
  resource: Resource;
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

/** Colonnes de la vue liste (en-tête + lignes partagent la grille). */
const LIST_COLS =
  "grid-cols-[minmax(2.5rem,auto)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.2fr)_minmax(4.5rem,auto)_minmax(3rem,auto)]";

/**
 * Rendu du contenu de la bibliothèque : trois modes, un seul endroit.
 * - « list »    : lignes denses type tableau (ScrollArea natif) ;
 * - « grid »    : tuiles, virtualisées PAR LIGNES au-delà du seuil réglé
 *   (conteneur de scroll dédié — le viewport Base UI fausse les mesures),
 *   rendu natif en dessous.
 * Les tuiles et dossiers sont rendus par des helpers internes partagés
 * (un seul JSX par tuile, utilisé par les branches virtuelle et native).
 */
export function ResourceGrid(props: ResourceGridProps) {
  const {
    resources,
    visibleFolders,
    foldersList,
    captures,
    selectMode,
    selectedIds,
    toggleSelect,
    viewMode,
    tileMin,
    sortBy,
    openFolder,
    dragId,
    dragFolderId,
    dropZone,
    setDropZone,
    folderDropHint,
    setFolderDropHint,
    setDragId,
    setDragFolderId,
    handleDragStarted,
    handleDropOnTile,
    handleDropOnFolder,
    handleFolderDrop,
    moveTileByKey,
    handleDissolveFolder,
    handleDeleteFolder,
    setDetailsViewing,
    handleEdit,
    handleDelete,
    setNoteViewing,
    handleSetStatus,
    handleMoveToFolder,
    handleUploadToCloud,
    refresh,
    setFolderStack,
    setFolderName,
    setFolderDialog,
  } = props;

  const qc = useQueryClient();

  // --- réglage de virtualisation (Réglages → Général → Rendu de la grille) ---
  const [virtualMode, setVirtualModeState] = useState(getVirtualMode);
  useEffect(() => {
    const onChange = () => setVirtualModeState(getVirtualMode());
    window.addEventListener("vaultly:virtualization-changed", onChange);
    return () =>
      window.removeEventListener("vaultly:virtualization-changed", onChange);
  }, []);
  const threshold = virtualThresholdFor(virtualMode);
  const tileCount = resources.length + visibleFolders.length;
  // la vue Liste n'a pas besoin de virtualisation (lignes légères)
  const virtualizing =
    viewMode === "grid" && tileCount > 0 && tileCount >= threshold;

  // respiration entre la barre de filtres et la première ligne : le
  // conteneur virtualisé a un padding-top ÉGAL, compensé via scrollMargin
  const GRID_TOP_PAD = 12;

  // colonnes du mode virtualisé : recalculées à la largeur du conteneur.
  // Le conteneur a un padding horizontal (px-4) : clientWidth l'inclut alors
  // que les lignes s'arrêtent 32 px plus étroit — on le retranche, sinon une
  // colonne de trop est demandée à certaines largeurs (tuile éjectée à la
  // ligne suivante, saut de hauteur de ligne).
  const virtualScrollRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(4);
  useEffect(() => {
    if (!virtualizing) return;
    const el = virtualScrollRef.current;
    if (!el) return;
    const H_PADDING = 32; // px-4 des lignes
    const compute = () =>
      setColumns(
        Math.min(
          12,
          Math.max(2, Math.floor((el.clientWidth - H_PADDING) / (tileMin + 12))),
        ),
      );
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [virtualizing, tileMin]);

  // items de la grille dans l'ordre : dossiers, tuile « créer », ressources
  const gridItems = useMemo(
    () => [
      ...visibleFolders.map((f) => ({ k: "folder" as const, f })),
      { k: "create" as const },
      ...resources.map((r) => ({ k: "res" as const, r })),
    ],
    [visibleFolders, resources],
  );

  // lignes virtuelles : hauteur estimée puis MESURÉE (measureElement)
  const rowCount = virtualizing ? Math.ceil(gridItems.length / columns) : 0;
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => virtualScrollRef.current,
    estimateSize: () => 176, // tuile carrée ~tileMin + gap 12 + marge hover
    overscan: 4,
    scrollMargin: GRID_TOP_PAD,
  });

  // grille native fluide : largeur min par tuile, le navigateur remplit
  const nativeGridStyle = {
    gridTemplateColumns: `repeat(auto-fill, minmax(${tileMin}px, 1fr))`,
  } as const;

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

  // ---------- helpers de rendu partagés par les branches virtuelle/native ----------

  function renderFolderTile(f: Folder) {
    return (
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
        onDragLeave={() => setFolderDropHint((h) => (h === f.id ? null : h))}
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
    );
  }

  function renderCreateFolderTile() {
    return (
      <div className="animate-tile-in relative rounded-xl">
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
          className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-card p-3 text-muted-foreground transition-all duration-200 ease-out outline-none hover:-translate-y-0.5 hover:border-primary/50 hover:text-foreground hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]"
        >
          <FolderPlus className="size-8 opacity-70" />
          <span className="line-clamp-2 min-h-8 text-center text-xs font-medium leading-tight">
            Nouveau dossier
          </span>
        </button>
      </div>
    );
  }

  function renderResourceTile(r: Resource, index: number) {
    return (
      <div
        key={r.id}
        style={{ animationDelay: `${index * 40}ms` }}
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
        onDragLeave={() => setDropZone((h) => (h?.id === r.id ? null : h))}
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
          selectedIds.has(r.id) && selectMode ? "ring-2 ring-amber-500" : "",
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
          onUploadToCloud={handleUploadToCloud}
          onSetStatus={handleSetStatus}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onToggled={refresh}
        />
      </div>
    );
  }

  // ---------- VUE LISTE ----------

  if (viewMode === "list") {
    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 pt-3 pb-4">
          <div className="overflow-hidden rounded-xl border">
            {/* en-tête de colonnes */}
            <div
              className={cn(
                LIST_COLS,
                "grid items-center gap-3 border-b bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
              )}
            >
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
                {...folderDragProps(f, setDragFolderId)}
                role="button"
                tabIndex={0}
                onClick={() => setFolderStack((s) => [...s, f])}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setFolderStack((s) => [...s, f]);
                }}
                className={cn(
                  LIST_COLS,
                  "grid cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm outline-none transition-colors last:border-b-0 hover:bg-accent/40 focus-visible:bg-accent/40",
                )}
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
            {resources.map((r) => {
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
                      if (selectMode) toggleSelect(r);
                      else void openRow(r);
                    }
                  }}
                  className={cn(
                    LIST_COLS,
                    "grid cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm outline-none transition-colors last:border-b-0 hover:bg-accent/40 focus-visible:bg-accent/40",
                    dragId === r.id && "opacity-40",
                    dropZone?.id === r.id &&
                      "outline-2 outline-dashed outline-primary/60",
                    selectedIds.has(r.id) &&
                      selectMode &&
                      "ring-2 ring-inset ring-amber-500",
                  )}
                >
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
                      {r.favorite && (
                        <StarFav />
                      )}
                      <span className="truncate font-medium">{r.title}</span>
                    </span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {r.url.startsWith("http")
                      ? hostOf(r.url)
                      : r.url.startsWith("exe:")
                        ? "application"
                        : r.url.startsWith("file:")
                          ? "fichier local"
                          : r.url.startsWith("local:")
                            ? "sans lien"
                            : r.url}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {summary || typeLabel(r.resourceType)}
                  </span>
                  <span className="text-right text-xs tabular-nums text-muted-foreground">
                    {r.openCount > 0 ? r.openCount : "—"}
                  </span>
                  <RowMenu
                    onDetails={setDetailsViewing}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    resource={r}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    );
  }

  // ---------- VUE GRILLE (virtualisée ou native) ----------

  if (virtualizing) {
    return (
      <div
        ref={virtualScrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4"
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
                transform: `translateY(${vi.start - GRID_TOP_PAD}px)`,
              }}
            >
              {gridItems
                .slice(vi.index * columns, (vi.index + 1) * columns)
                .map((it, i) =>
                  it.k === "folder" ? (
                    <div
                      key={`folder-${it.f.id}`}
                      className="animate-tile-in"
                      style={{
                        animationDelay: `${(vi.index * columns + i) * 40}ms`,
                      }}
                    >
                      {renderFolderTile(it.f)}
                    </div>
                  ) : it.k === "create" ? (
                    <div key="create">{renderCreateFolderTile()}</div>
                  ) : (
                    renderResourceTile(it.r, vi.index * columns + i)
                  ),
                )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-4 pt-3 pb-4">
        <div className="grid gap-3" style={nativeGridStyle}>
          {/* dossiers : racine sur l'accueil, sous-dossiers dans un dossier */}
          {visibleFolders.map((f, i) => (
            <div
              key={`folder-${f.id}`}
              {...folderDragProps(f, setDragFolderId)}
              className="animate-tile-in"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              {renderFolderTile(f)}
            </div>
          ))}
          {/* tuile créer un dossier — partout : à la racine comme dans
              un sous-dossier (la création se fait dans le dossier courant) */}
          {renderCreateFolderTile()}
          {/* ressources */}
          {resources.map((r, i) => renderResourceTile(r, i + visibleFolders.length))}
        </div>
      </div>
    </ScrollArea>
  );
}

/** Étoile de favori pour les lignes de liste. */
function StarFav() {
  return <Star className="size-3 shrink-0 fill-yellow-400 text-yellow-400" />;
}

/** Drag de dossier dans la vue liste : setData obligatoire pour un drag
 *  HTML5 fiable (sans lui, Chromium/WebView2 peut l'ignorer). */
function folderDragProps(f: Folder, setDragFolderId: (id: number | null) => void) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData("text/plain", `folder:${f.id}`);
      e.dataTransfer.effectAllowed = "move";
      setDragFolderId(f.id);
    },
    onDragEnd: () => setDragFolderId(null),
  };
}

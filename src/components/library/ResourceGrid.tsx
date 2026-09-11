import { useQueryClient } from "@tanstack/react-query";
import { FolderPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FolderTile } from "@/components/FolderTile";
import type { FolderDialogState } from "@/components/library/FolderCreateDialog";
import {
  type DropZone,
  FolderListRow,
  folderDragProps,
  LIST_COLS,
  ResourceListRow,
} from "@/components/library/ListRow";
import { ResourceTile } from "@/components/ResourceTile";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getPageDensity, rowsPerPageFor } from "@/lib/gridPagination";
import { useI18n } from "@/lib/i18n";
import { openResource } from "@/lib/openResource";
import type { Folder, Resource, SortBy } from "@/lib/types";
import { cn, describeError } from "@/lib/utils";

interface ResourceGridProps {
  resources: Resource[];
  visibleFolders: Folder[];
  /** tous les dossiers (passés aux tuiles pour « Déplacer vers… ») */
  foldersList: Folder[];
  captures: boolean;
  selectMode: boolean;
  selectedIds: Set<number>;
  /** dossiers cochés en mode sélection (ids de table distincte des ressources) */
  selectedFolderIds: Set<number>;
  toggleFolderSelect: (f: Folder) => void;
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
  handleDropOnTile: (
    target: Resource,
    zone: "left" | "right" | "center",
  ) => void;
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
  // --- pagination (état porté par LibraryView, rendu dans sa toolbar) ---
  /** page courante (indexée à 0) ; la tranche est découpée ici, à la source */
  page: number;
  /** remonte le nb de pages + le total pour que la toolbar affiche la barre */
  onPagination: (info: { pages: number; total: number }) => void;
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
  const { t } = useI18n();
  const {
    resources,
    visibleFolders,
    foldersList,
    captures,
    selectMode,
    selectedIds,
    selectedFolderIds,
    toggleFolderSelect,
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
    page,
    onPagination,
  } = props;

  const qc = useQueryClient();

  // --- densité de pagination (Réglages → Général) : rangées par page ---
  const [rowsPerPage, setRowsPerPage] = useState(() =>
    rowsPerPageFor(getPageDensity()),
  );
  useEffect(() => {
    const onChange = () => setRowsPerPage(rowsPerPageFor(getPageDensity()));
    window.addEventListener("vaultly:page-density-changed", onChange);
    return () =>
      window.removeEventListener("vaultly:page-density-changed", onChange);
  }, []);

  // colonnes calculées à la largeur du conteneur (les tuiles font exactement
  // une colonne : pas d'auto-fill, sinon des lignes incomplètes flottent entre
  // deux largeurs et cassent le découpage par page).
  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(4);
  useEffect(() => {
    // ré-abonné à CHAQUE retour en vue grille : le conteneur est démonté
    // quand on passe en liste/tableau, sinon l'ResizeObserver reste collé à
    // l'ancien nœud et `columns` se fige → tuiles qui « grandissent » au retour.
    if (viewMode !== "grid") return;
    const el = gridWrapRef.current;
    if (!el) return;
    const H_PADDING = 32; // px-4 du conteneur
    const GAP = 12; // gap-x-3 entre colonnes
    const compute = () =>
      setColumns(
        Math.min(
          12,
          Math.max(
            2,
            Math.floor((el.clientWidth - H_PADDING + GAP) / (tileMin + GAP)),
          ),
        ),
      );
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tileMin, viewMode]);

  // items de la grille dans l'ordre : tuile « créer » EN TÊTE, puis dossiers,
  // puis ressources — la création est toujours la première carte visible
  const gridItems = useMemo(
    () => [
      { k: "create" as const },
      ...visibleFolders.map((f) => ({ k: "folder" as const, f })),
      ...resources.map((r) => ({ k: "res" as const, r })),
    ],
    [visibleFolders, resources],
  );

  const pageSize = columns * rowsPerPage;
  const totalPages = Math.max(1, Math.ceil(gridItems.length / pageSize));
  // l'état de page vit dans LibraryView (la barre de pagination y est rendue).
  // On borne localement pour tronquer sûrement même si le parent est à jour.
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const pageItems = gridItems.slice(
    safePage * pageSize,
    (safePage + 1) * pageSize,
  );

  // Délai d'apparition par RANGÉE (toute une ligne ensemble, de haut en bas) :
  // un stagger par index linéaire décalait les tuiles de droite par rapport à
  // la ligne suivante → le déballage paraissait « en désordre » (bas puis
  // premier). Borné pour que les grandes pages ne traînent pas.
  const tileDelay = (index: number): string =>
    `${Math.min(Math.floor(index / columns), 6) * 45}ms`;

  // remonte pages + total (grille uniquement : la liste ne paginer pas).
  // Dépend de columns/rowsPerPage/données ; resize et filtre déclenchent.
  useEffect(() => {
    if (viewMode !== "grid") {
      onPagination({ pages: 1, total: 0 });
      return;
    }
    onPagination({ pages: totalPages, total: gridItems.length });
  }, [onPagination, viewMode, totalPages, gridItems.length]);

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
      toast.error(
        t("Ouverture impossible : {error}", { error: describeError(e) }),
      );
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
        selectMode={selectMode}
        selected={selectedFolderIds.has(f.id)}
        onToggleSelect={() => toggleFolderSelect(f)}
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
          type="button"
          onClick={() => {
            setFolderName("");
            setFolderDialog({ mode: "create" });
          }}
          title={
            openFolder
              ? t("Nouveau sous-dossier dans « {name} »", {
                  name: openFolder.name,
                })
              : t("Nouveau dossier")
          }
          className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-card p-3 text-muted-foreground transition-all duration-200 ease-out outline-none hover:-translate-y-0.5 hover:border-primary/50 hover:text-foreground hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]"
        >
          <FolderPlus className="size-8 opacity-70" />
          <span className="line-clamp-2 min-h-8 text-center text-xs font-medium leading-tight">
            {t("Nouveau dossier")}
          </span>
        </button>
      </div>
    );
  }

  function renderResourceTile(r: Resource, index: number) {
    return (
      <div
        key={r.id}
        style={{ animationDelay: tileDelay(index) }}
        onKeyDown={(e) => {
          // réordonnancement clavier de la tuile focusée : bascule en tri
          // « Placement » gérée par moveTileByKey (comme pour le drag)
          if (
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
              <span>{t("Ressource")}</span>
              <span>{t("Lien")}</span>
              <span>{t("Détails")}</span>
              <span className="text-right">{t("Ouvertures")}</span>
              <span />
            </div>
            {/* dossiers en tête de liste */}
            {visibleFolders.map((f) => (
              <FolderListRow
                key={`folder-${f.id}`}
                folder={f}
                selectMode={selectMode}
                selected={selectedFolderIds.has(f.id)}
                onToggleSelect={() => toggleFolderSelect(f)}
                setFolderStack={setFolderStack}
                setDragFolderId={setDragFolderId}
                resourceDragging={dragId !== null}
                onDropResource={() => void handleDropOnFolder(f)}
              />
            ))}
            {/* ressources */}
            {resources.map((r) => (
              <ResourceListRow
                key={r.id}
                resource={r}
                selectMode={selectMode}
                selected={selectedIds.has(r.id)}
                draggable={sortBy === "manual" && !selectMode}
                dragId={dragId}
                dropZone={dropZone}
                setDropZone={setDropZone}
                setDragId={setDragId}
                onDragStarted={handleDragStarted}
                onDropOnTile={handleDropOnTile}
                onToggleSelect={toggleSelect}
                onOpenRow={(row) => void openRow(row)}
                onDetails={setDetailsViewing}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
    );
  }

  // ---------- VUE GRILLE (paginée : plus de scroll) ----------
  // La barre de pagination n'est PAS ici : elle vit dans la toolbar de
  // LibraryView (fil d'Ariane quand un dossier est ouvert, à droite de
  // « Statut » à la racine). ResourceGrid ne fait que trancher `pageItems`.

  return (
    <div
      ref={gridWrapRef}
      className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4"
    >
      <div
        className="grid gap-x-3 gap-y-5"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        }}
      >
        {pageItems.map((it, i) =>
          it.k === "folder" ? (
            <div
              key={`folder-${it.f.id}`}
              // pas de drag de dossier en mode sélection (cohérent avec la
              // vue liste et les tuiles ressources)
              {...(selectMode
                ? {}
                : folderDragProps(it.f, setDragFolderId, () =>
                    setFolderDropHint(null),
                  ))}
              className="animate-tile-in"
              style={{ animationDelay: tileDelay(i) }}
            >
              {renderFolderTile(it.f)}
            </div>
          ) : it.k === "create" ? (
            <div
              key="create"
              className="animate-tile-in"
              style={{ animationDelay: tileDelay(i) }}
            >
              {renderCreateFolderTile()}
            </div>
          ) : (
            renderResourceTile(it.r, i)
          ),
        )}
      </div>
    </div>
  );
}

import {
  Copy,
  FolderOpen,
  Info,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fileKindFor } from "@/lib/fileKind";
import { useI18n } from "@/lib/i18n";
import { metaSummary } from "@/lib/metaFields";
import { hostOf, typeLabel } from "@/lib/resources";
import type { Folder, Resource } from "@/lib/types";
import { cn } from "@/lib/utils";

export type DropZone = {
  id: number;
  zone: "left" | "right" | "center";
};

/** Colonnes de la vue liste (en-tête + lignes partagent la grille). */
export const LIST_COLS =
  "grid-cols-[minmax(2.5rem,auto)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.2fr)_minmax(4.5rem,auto)_minmax(3rem,auto)]";

/** Icône de ligne (vue LISTE) : favicon, icône d'extension pour les
 *  fichiers, initiales en repli — avec gestion locale de l'erreur image. */
function RowIcon({ resource }: { resource: Resource }) {
  const [imgError, setImgError] = useState(false);
  const kind =
    resource.resourceType === "fichier" ? fileKindFor(resource) : null;
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
  const { t } = useI18n();
  return (
    <div
      className="flex justify-end"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("Options pour « {title} »", { title: resource.title })}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground data-[popup-open]:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={() => onDetails(resource)}>
            <Info />
            {t("Détails")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void navigator.clipboard
                .writeText(resource.url)
                .then(() => toast.success(t("URL copiée")))
                .catch(() => toast.error(t("Copie impossible")));
            }}
          >
            <Copy />
            {t("Copier l'URL")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onEdit(resource)}>
            <Pencil />
            {t("Modifier")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDelete(resource)}
          >
            <Trash2 />
            {t("Supprimer")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Étoile de favori pour les lignes de liste. */
function StarFav() {
  return <Star className="size-3 shrink-0 fill-yellow-400 text-yellow-400" />;
}

/** Drag de dossier dans la vue liste : setData obligatoire pour un drag
 *  HTML5 fiable (sans lui, Chromium/WebView2 peut l'ignorer). */
export function folderDragProps(
  f: Folder,
  setDragFolderId: (id: number | null) => void,
) {
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

interface FolderListRowProps {
  folder: Folder;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  setFolderStack: (f: (s: Folder[]) => Folder[]) => void;
  setDragFolderId: (id: number | null) => void;
}

/** Ligne DOSSIER de la vue LISTE. */
export function FolderListRow({
  folder,
  selectMode,
  selected,
  onToggleSelect,
  setFolderStack,
  setDragFolderId,
}: FolderListRowProps) {
  const { t } = useI18n();
  return (
    <div
      {...(selectMode ? {} : folderDragProps(folder, setDragFolderId))}
      role="button"
      tabIndex={0}
      onClick={() =>
        selectMode ? onToggleSelect?.() : setFolderStack((s) => [...s, folder])
      }
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          if (selectMode) onToggleSelect?.();
          else setFolderStack((s) => [...s, folder]);
        }
      }}
      className={cn(
        LIST_COLS,
        "grid cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm outline-none transition-colors last:border-b-0 hover:bg-accent/40 focus-visible:bg-accent/40",
        selected && selectMode && "ring-2 ring-inset ring-amber-500",
      )}
    >
      {selectMode ? (
        <span className="flex size-8 items-center justify-center">
          <Checkbox
            checked={selected}
            tabIndex={-1}
            aria-label={t("Sélectionner le dossier « {name} »", {
              name: folder.name,
            })}
          />
        </span>
      ) : (
        <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
          <FolderOpen className="size-4 text-amber-500" />
        </span>
      )}
      <span className="truncate font-medium">{folder.name}</span>
      <span className="truncate text-xs text-muted-foreground">
        {t("dossier")}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {t("{count} ressource(s)", { count: folder.count })}
      </span>
      <span />
      <span />
    </div>
  );
}

interface ResourceListRowProps {
  resource: Resource;
  selectMode: boolean;
  selected: boolean;
  /** drag de réordonnancement (tri manuel, hors sélection) */
  draggable: boolean;
  dragId: number | null;
  dropZone: DropZone | null;
  setDropZone: React.Dispatch<React.SetStateAction<DropZone | null>>;
  setDragId: (id: number | null) => void;
  onDragStarted: (r: Resource) => void;
  onDropOnTile: (target: Resource, zone: "left" | "right" | "center") => void;
  onToggleSelect: (r: Resource) => void;
  /** ouvre la ligne (note → lecteur, sans lien → édition, sinon openResource) */
  onOpenRow: (r: Resource) => void;
  onDetails: (r: Resource) => void;
  onEdit: (r: Resource) => void;
  onDelete: (r: Resource) => void;
}

/** Ligne RESSOURCE de la vue LISTE. */
export function ResourceListRow({
  resource,
  selectMode,
  selected,
  draggable,
  dragId,
  dropZone,
  setDropZone,
  setDragId,
  onDragStarted,
  onDropOnTile,
  onToggleSelect,
  onOpenRow,
  onDetails,
  onEdit,
  onDelete,
}: ResourceListRowProps) {
  const { t } = useI18n();
  const summary = metaSummary(resource, 3);
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(resource.id));
        e.dataTransfer.effectAllowed = "move";
        onDragStarted(resource);
      }}
      onDragOver={(e) => {
        if (dragId === null) return;
        e.preventDefault();
        setDropZone((h) =>
          h && h.id === resource.id ? h : { id: resource.id, zone: "center" },
        );
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (dropZone?.id === resource.id)
          void onDropOnTile(resource, dropZone.zone);
      }}
      onDragEnd={() => {
        setDragId(null);
        setDropZone(null);
      }}
      role="button"
      tabIndex={0}
      onClick={() =>
        selectMode ? onToggleSelect(resource) : onOpenRow(resource)
      }
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (selectMode) onToggleSelect(resource);
          else onOpenRow(resource);
        }
      }}
      className={cn(
        LIST_COLS,
        "grid cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm outline-none transition-colors last:border-b-0 hover:bg-accent/40 focus-visible:bg-accent/40",
        dragId === resource.id && "opacity-40",
        dropZone?.id === resource.id &&
          "outline-2 outline-dashed outline-primary/60",
        selected && selectMode && "ring-2 ring-inset ring-amber-500",
      )}
    >
      {selectMode ? (
        <span className="flex size-8 items-center justify-center">
          <Checkbox
            checked={selected}
            tabIndex={-1}
            aria-label={t("Sélectionner « {title} »", {
              title: resource.title,
            })}
          />
        </span>
      ) : (
        <RowIcon resource={resource} />
      )}
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          {resource.favorite && <StarFav />}
          <span className="truncate font-medium">{resource.title}</span>
        </span>
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {resource.url.startsWith("http")
          ? hostOf(resource.url)
          : resource.url.startsWith("exe:")
            ? t("application")
            : resource.url.startsWith("file:")
              ? t("fichier local")
              : resource.url.startsWith("local:")
                ? t("sans lien")
                : resource.url}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {summary || typeLabel(resource.resourceType)}
      </span>
      <span className="text-right text-xs tabular-nums text-muted-foreground">
        {resource.openCount > 0 ? resource.openCount : "—"}
      </span>
      <RowMenu
        onDetails={onDetails}
        onEdit={onEdit}
        onDelete={onDelete}
        resource={resource}
      />
    </div>
  );
}

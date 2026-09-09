import {
  Archive,
  CircleSlash,
  CloudUpload,
  FolderOpen,
  Copy,
  ExternalLink,
  Info,
  ListTodo,
  Loader2,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { memo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cloudAppendLink, cloudListShareLists, toggleFavorite } from "@/lib/api";
import { metaSummary } from "@/lib/metaFields";
import { fileKindFor } from "@/lib/fileKind";
import { isStale, noteColorClass } from "@/lib/resources";
import { openResource } from "@/lib/openResource";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Folder, Resource, ShareListInfo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  resource: Resource;
  /** afficher la capture d'écran du site (service mShots) plutôt que le favicon */
  capture?: boolean;
  /** mode sélection multiple : la tuile montre une case à cocher */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (r: Resource) => void;
  draggable?: boolean;
  onDragStarted?: (r: Resource) => void;
  folders?: Folder[];
  onMoveToFolder?: (r: Resource, folderId: number | null) => void;
  /** clic sur une note : ouvre la vue lecture */
  onOpenNote?: (r: Resource) => void;
  /** envoie le fichier local vers le cloud WebDAV */
  onUploadToCloud?: (r: Resource) => void;
  onSetStatus?: (r: Resource, status: "" | "todo" | "archived") => void;
  /** ouvre la vue « Détails » (fiche complète, README pour les dépôts) */
  onDetails?: (r: Resource) => void;
  onEdit: (r: Resource) => void;
  onDelete: (r: Resource) => void;
  onToggled: () => void;
}

// mémoïsée : la grille re-render à chaque dragOver (hint de dépôt) — sans
// memo, des centaines de tuiles repassent par le rendu à chaque survol.
export const ResourceTile = memo(function ResourceTile({
  resource,
  capture = false,
  selectMode = false,
  selected = false,
  onToggleSelect,
  draggable = false,
  onDragStarted,
  folders,
  onMoveToFolder,
  onOpenNote,
  onUploadToCloud,
  onSetStatus,
  onDetails,
  onEdit,
  onDelete,
  onToggled,
}: Props) {
  const [imgError, setImgError] = useState(false);
  const [captureError, setCaptureError] = useState(false);
  const qc = useQueryClient();
  const summary = metaSummary(resource);
  const isNote = resource.resourceType === "note";
  const isFile = resource.resourceType === "fichier";
  // icône selon l'extension réelle du fichier (txt, pdf, zip…) — pas de
  // dossier générique : la tuile doit refléter le document
  const fileKind = isFile ? fileKindFor(resource) : null;
  const FileKindIcon = fileKind?.icon ?? FolderOpen;
  const stale = isStale(resource);

  async function open() {
    // mode sélection : un clic coche/décoche au lieu d'ouvrir
    if (selectMode) {
      onToggleSelect?.(resource);
      return;
    }
    // ressource sans lien : un clic ouvre l'édition pour en ajouter un.
    // SAUF un fichier local (url « local:… » mais meta.filePath renseigné) :
    // lui s'ouvre réellement, via openResource.
    if (resource.url.startsWith("local:") && !resource.meta?.filePath) {
      onEdit(resource);
      return;
    }
    try {
      await openResource(resource);
      void qc.invalidateQueries({ queryKey: ["resources"] });
    } catch (e) {
      toast.error(`Ouverture impossible : ${e}`);
    }
  }

  function copy() {
    navigator.clipboard
      .writeText(resource.url)
      .then(() => toast.success("URL copiée"))
      .catch(() => toast.error("Copie impossible"));
  }

  // verrou local : un double-clic rapide sur « Ajouter aux favoris » envoyait
  // deux toggles (retour à l'état initial) — le second appel est ignoré
  const favBusy = useRef(false);

  function toggle() {
    if (favBusy.current) return;
    favBusy.current = true;
    toggleFavorite(resource.id)
      .then(onToggled)
      .catch((e) => toast.error(String(e)))
      .finally(() => {
        favBusy.current = false;
      });
  }

  // --- Partage vers une liste JSON sur le cloud (WebDAV) ---
  const [shareOpen, setShareOpen] = useState(false);
  const [shareLists, setShareLists] = useState<ShareListInfo[] | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  /** name d'une liste existante, ou "__new" pour créer un fichier */
  const [shareTarget, setShareTarget] = useState<string>("__new");
  const [newFileName, setNewFileName] = useState("");
  const [sharing, setSharing] = useState(false);

  async function openShareDialog() {
    setShareOpen(true);
    setShareLoading(true);
    try {
      const lists = await cloudListShareLists();
      setShareLists(lists);
      setShareTarget(lists.length > 0 ? lists[0].name : "__new");
    } catch (e) {
      toast.error(String(e));
      setShareLists([]);
    } finally {
      setShareLoading(false);
    }
  }

  async function runShareToCloud() {
    const isNew = shareTarget === "__new";
    const name = newFileName.trim();
    if (isNew && !name) {
      toast.error("Donne un nom à la liste (ex. Design)");
      return;
    }
    setSharing(true);
    try {
      const res = await cloudAppendLink({
        name: isNew ? null : shareTarget,
        newListTitle: isNew ? name : null,
        title: resource.title || resource.url,
        url: resource.url,
        addedAt: new Date().toISOString(),
      });
      const label = res.name;
      if (res.added) {
        toast.success(
          `Lien ajouté à « ${label} » (${res.total} lien${res.total > 1 ? "s" : ""})`,
        );
      } else {
        toast.info(`Ce lien est déjà dans « ${label} »`);
      }
      setShareOpen(false);
      setNewFileName("");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSharing(false);
    }
  }

  return (
    <div
      className="group relative"
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(resource.id));
        onDragStarted?.(resource);
      }}
    >
      {/* tuile note : post-it coloré, titre seul centré */}
      {isNote ? (
        <div
          role="button"
          tabIndex={0}
          title={resource.title}
          onClick={() => (onOpenNote ? onOpenNote(resource) : void open())}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault(); // Espace : pas de scroll de page
              onOpenNote ? onOpenNote(resource) : void open();
            }
          }}
          className={cn(
            "flex aspect-square cursor-pointer select-none flex-col items-center justify-center rounded-2xl border p-4 text-center transition-all duration-200 ease-out outline-none hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]",
            noteColorClass(resource.meta?.color),
          )}
        >
          <span className="line-clamp-3 text-[15px] font-bold leading-snug">
            {resource.title}
          </span>
        </div>
      ) : isFile ? (
        <div
          role="button"
          tabIndex={0}
          title={`${resource.title}\n${
            resource.meta?.filePath ??
            (resource.url.startsWith("file:") ? resource.url.slice(5) : "")
          }`}
          onClick={() => void open()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void open();
            }
          }}
          className="flex aspect-square cursor-pointer select-none flex-col items-center justify-center gap-2 rounded-2xl border bg-card p-3 transition-all duration-200 ease-out outline-none hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]"
        >
          <div className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-muted">
            <FileKindIcon className={`size-8 ${fileKind?.className ?? "text-muted-foreground"}`} />
          </div>
          <span className="line-clamp-2 min-h-8 text-center text-xs font-medium leading-tight">
            {resource.title}
          </span>
        </div>
      ) : capture && resource.url.startsWith("http") && !captureError ? (
        <div
          role="button"
          tabIndex={0}
          title={`${resource.title}\n${resource.url}`}
          onClick={() => void open()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void open();
            }
          }}
          className="relative aspect-square cursor-pointer select-none overflow-hidden rounded-2xl border transition-all duration-200 ease-out outline-none hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]"
        >
          <img
            src={`https://s.wordpress.com/mshots/v1/${encodeURIComponent(resource.url)}?w=400`}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
            onError={() => setCaptureError(true)}
          />
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-2 pb-2 pt-6 text-center text-xs font-semibold text-white">
            {resource.title}
          </span>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          title={`${resource.title}${summary ? `\n${summary}` : ""}${
            resource.url.startsWith("local:")
              ? "\nSans lien — clic pour en ajouter un"
              : `\n${resource.url}`
          }`}
          onClick={() => void open()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void open();
            }
          }}
          className="flex aspect-square cursor-grab select-none flex-col items-center justify-center gap-2 rounded-2xl border bg-card p-3 transition-all duration-200 ease-out outline-none hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98] active:cursor-grabbing"
        >
          {resource.favicon && !imgError ? (
            <img
              src={resource.favicon}
              alt=""
              className="size-16 shrink-0 rounded-xl object-contain"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-muted text-xl font-bold uppercase text-muted-foreground">
              {resource.title.slice(0, 2)}
            </div>
          )}
          {/* 2 lignes réservées : hauteur identique pour tous les titres */}
          <span className="line-clamp-2 min-h-8 text-center text-xs font-medium leading-tight">
            {resource.title}
          </span>
        </div>
      )}

      {/* coin supérieur gauche : case à cocher en mode sélection, sinon favori.
          Un seul déclencheur (le wrapper) : le clic sur la checkbox bubble
          ici, et l'activation clavier aussi — double handler = double toggle
          = sélection invisible. */}
      {selectMode ? (
        <div
          className="absolute -left-1.5 -top-1.5 z-20 flex size-6 items-center justify-center rounded-full border bg-background shadow"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.(resource);
          }}
        >
          <Checkbox checked={selected} tabIndex={-1} />
        </div>
      ) : (
        resource.favorite && (
          <div className="absolute -left-1.5 -top-1.5 z-10 flex size-6 items-center justify-center rounded-full border bg-background shadow">
            <Star className="size-3.5 fill-yellow-400 text-yellow-400" />
          </div>
        )
      )}

      {/* chip de statut, coin supérieur gauche intérieur */}
      {resource.status === "todo" && !selectMode && (
        <span
          className="absolute left-2 top-2 z-10 rounded-full bg-amber-400/90 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950"
          title="À traiter"
        >
          À traiter
        </span>
      )}
      {resource.status === "archived" && !selectMode && (
        <span
          className="absolute left-2 top-2 z-10 rounded-full bg-zinc-500/85 px-1.5 py-0.5 text-[10px] font-semibold text-white"
          title="Archivé"
        >
          Archivé
        </span>
      )}

      {/* à revisiter : ajoutée il y a longtemps, jamais ouverte */}
      {stale && resource.status !== "archived" && !selectMode && (
        <div
          className="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-1 rounded-full border bg-background/85 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-300"
          title="Ajoutée il y a plus de 2 mois, jamais ouverte"
        >
          à revisiter
        </div>
      )}

      {/* menu ⋯ flottant, en dehors de la tuile — toujours visible */}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Options"
          className="absolute -right-1.5 -top-1.5 z-10 flex size-7 cursor-pointer items-center justify-center rounded-full border bg-background text-muted-foreground shadow-md outline-none transition-colors hover:text-foreground focus-visible:text-foreground data-[popup-open]:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          {isNote ? (
            <>
              <DropdownMenuItem
                onClick={() => (onOpenNote ? onOpenNote(resource) : void open())}
              >
                <ExternalLink />
                Ouvrir la note
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(resource)}>
                <Pencil />
                Modifier
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem onClick={() => void open()}>
                <ExternalLink />
                {resource.url.startsWith("local:") && !resource.meta?.filePath
                  ? "Ajouter un lien…"
                  : "Ouvrir"}
              </DropdownMenuItem>
              {/* détails : fiche complète (README pour les dépôts) */}
              {onDetails && (
                <DropdownMenuItem onClick={() => onDetails(resource)}>
                  <Info />
                  Détails
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={copy}>
                <Copy />
                Copier l'URL
              </DropdownMenuItem>
              {resource.url.startsWith("http") && (
                <DropdownMenuItem
                  onClick={() => void openShareDialog()}
                  title="Ajoute ce lien à un fichier JSON sur ton cloud (WebDAV)"
                >
                  <CloudUpload />
                  Partager vers le cloud
                </DropdownMenuItem>
              )}
              {/* fichier local : envoi réel vers le cloud WebDAV */}
              {(resource.url.startsWith("file:") || resource.meta?.filePath) && onUploadToCloud && (
                <DropdownMenuItem
                  onClick={() => onUploadToCloud(resource)}
                >
                  <CloudUpload />
                  Envoyer vers le cloud
                </DropdownMenuItem>
              )}
            </>
          )}
          <DropdownMenuItem onClick={toggle}>
            <Star
              className={resource.favorite ? "fill-yellow-400 text-yellow-400" : ""}
            />
            {resource.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
          </DropdownMenuItem>
          {/* statut de traitement */}
          {onSetStatus && resource.status !== "todo" && (
            <DropdownMenuItem onClick={() => onSetStatus(resource, "todo")}>
              <ListTodo />
              Marquer à traiter
            </DropdownMenuItem>
          )}
          {onSetStatus && resource.status !== "archived" && (
            <DropdownMenuItem onClick={() => onSetStatus(resource, "archived")}>
              <Archive />
              Archiver
            </DropdownMenuItem>
          )}
          {onSetStatus && resource.status !== "" && (
            <DropdownMenuItem onClick={() => onSetStatus(resource, "")}>
              <CircleSlash />
              Réactiver
            </DropdownMenuItem>
          )}
          {/* déplacer vers un dossier */}
          {onMoveToFolder && (folders?.length ?? 0) > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Déplacer vers…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {folders!.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    disabled={resource.folderId === f.id}
                    onClick={() => onMoveToFolder(resource, f.id)}
                  >
                    {f.name}
                  </DropdownMenuItem>
                ))}
                {resource.folderId !== null && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onMoveToFolder(resource, null)}
                    >
                      Sortir du dossier
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          {!isNote && (
            <DropdownMenuItem onClick={() => onEdit(resource)}>
              <Pencil />
              Modifier
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(resource)}>
            <Trash2 />
            Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialogue : choisir ou créer le fichier JSON de partage */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Partager vers le cloud</DialogTitle>
            <DialogDescription>
              Le lien sera enregistré dans un fichier JSON de ton dossier
              WebDAV. Choisis une liste existante ou crées-en une nouvelle
              (ex. Design, AIAPI).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Liste de destination</Label>
              <Select
                value={shareTarget}
                onValueChange={(v) => setShareTarget(v ?? "__new")}
                disabled={shareLoading || sharing}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choisir…" />
                </SelectTrigger>
                <SelectContent>
                  {(shareLists ?? []).map((l) => (
                    <SelectItem key={l.name} value={l.name}>
                      {l.title} ({l.count} lien{l.count > 1 ? "s" : ""})
                    </SelectItem>
                  ))}
                  <SelectItem value="__new">+ Nouvelle liste…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {shareTarget === "__new" && (
              <div className="grid gap-1.5">
                <Label>Nom de la nouvelle liste</Label>
                <Input
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="Design"
                  disabled={sharing}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShareOpen(false)}
              disabled={sharing}
            >
              Annuler
            </Button>
            <Button onClick={() => void runShareToCloud()} disabled={sharing}>
              {sharing && <Loader2 className="animate-spin" />}
              Partager
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

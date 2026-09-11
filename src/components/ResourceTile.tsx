import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Star } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ShareToCloudDialog } from "@/components/resource/ShareToCloudDialog";
import { TileBadges } from "@/components/resource/TileBadges";
import { TileContextMenu } from "@/components/resource/TileContextMenu";
import { Checkbox } from "@/components/ui/checkbox";
import { setRemindAt, toggleFavorite } from "@/lib/api";
import { fileKindFor } from "@/lib/fileKind";
import { useI18n } from "@/lib/i18n";
import { metaSummary } from "@/lib/metaFields";
import { openResource } from "@/lib/openResource";
import { isStale, noteColorClass, sqliteDatePlusDays } from "@/lib/resources";
import type { Folder, Resource } from "@/lib/types";
import { cn, describeError } from "@/lib/utils";

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
  const { t } = useI18n();
  const [imgError, setImgError] = useState(false);
  const [captureError, setCaptureError] = useState(false);
  const [captureLoaded, setCaptureLoaded] = useState(false);
  const resourceUrl = resource.url;
  // biome-ignore lint/correctness/useExhaustiveDependencies: resourceUrl est la primitive stable derivee (resource change d'identite)
  useEffect(() => {
    // nouvelle URL (édition) : on réarme le shimmer et la bascule d'erreur
    setCaptureLoaded(false);
    setCaptureError(false);
  }, [resourceUrl]);
  const qc = useQueryClient();
  const summary = metaSummary(resource);
  const isNote = resource.resourceType === "note";
  const isFile = resource.resourceType === "fichier";
  const isVideo = resource.resourceType === "video";
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
      toast.error(
        t("Ouverture impossible : {error}", { error: describeError(e) }),
      );
    }
  }

  function copy() {
    navigator.clipboard
      .writeText(resource.url)
      .then(() => toast.success(t("URL copiée")))
      .catch(() => toast.error(t("Copie impossible")));
  }

  // verrou local : un double-clic rapide sur « Ajouter aux favoris » envoyait
  // deux toggles (retour à l'état initial) — le second appel est ignoré
  const favBusy = useRef(false);

  function toggle() {
    if (favBusy.current) return;
    favBusy.current = true;
    toggleFavorite(resource.id)
      .then(onToggled)
      .catch((e) => toast.error(describeError(e)))
      .finally(() => {
        favBusy.current = false;
      });
  }

  /** Rappel « me rappeler dans… » (null = effacer). Ouvrir la ressource
   *  solde le rappel automatiquement. */
  async function remind(days: number | null) {
    try {
      await setRemindAt(
        resource.id,
        days === null ? null : sqliteDatePlusDays(days),
      );
      toast.success(
        days === null
          ? t("Rappel effacé")
          : t("Rappel enregistré — bonne lecture"),
      );
      onToggled?.();
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  // --- Partage vers une liste JSON sur le cloud (WebDAV) ---
  const [shareOpen, setShareOpen] = useState(false);

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
          onClick={() => {
            if (selectMode) {
              onToggleSelect?.(resource);
              return;
            }
            if (onOpenNote) onOpenNote(resource);
            else void open();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault(); // Espace : pas de scroll de page
              if (selectMode) onToggleSelect?.(resource);
              else if (onOpenNote) onOpenNote(resource);
              else void open();
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
            <FileKindIcon
              className={`size-8 ${fileKind?.className ?? "text-muted-foreground"}`}
            />
          </div>
          <span className="line-clamp-2 min-h-8 text-center text-xs font-medium leading-tight">
            {resource.title}
          </span>
        </div>
      ) : isVideo && resource.favicon && !imgError ? (
        /* vidéo avec vignette (oEmbed/miniature YouTube) : la vignette
           16:9 occupe la tuile, titre dessous — plutôt qu'une icône
           timbrée ou une capture mshots de la page de lecture */
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
          className="flex aspect-square cursor-pointer select-none flex-col gap-1.5 rounded-2xl border bg-card p-3 transition-all duration-200 ease-out outline-none hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]"
        >
          <div className="min-h-0 w-full flex-1 overflow-hidden rounded-lg bg-black">
            <img
              src={resource.favicon}
              alt=""
              loading="lazy"
              className="size-full object-cover"
              onError={() => setImgError(true)}
            />
          </div>
          <span className="line-clamp-2 text-center text-xs font-medium leading-tight">
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
          {/* shimmer pendant la génération mshots (10-30 s la 1re fois) */}
          {!captureLoaded && !captureError && (
            <div
              className="absolute inset-0 animate-pulse bg-muted/60"
              aria-hidden="true"
            />
          )}
          <img
            src={`https://s.wordpress.com/mshots/v1/${encodeURIComponent(resource.url)}?w=400`}
            alt=""
            loading="lazy"
            onLoad={() => setCaptureLoaded(true)}
            onError={() => setCaptureError(true)}
            className={cn(
              "absolute inset-0 size-full object-cover transition-opacity duration-500",
              !captureLoaded && "opacity-0",
            )}
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
              ? t("\nSans lien — clic pour en ajouter un")
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

      <TileBadges resource={resource} stale={stale} selectMode={selectMode} />

      <TileContextMenu
        resource={resource}
        isNote={isNote}
        onOpen={() => void open()}
        onCopy={copy}
        onToggleFavorite={toggle}
        onRemind={(days) => void remind(days)}
        onOpenShare={() => setShareOpen(true)}
        folders={folders}
        onMoveToFolder={onMoveToFolder}
        onOpenNote={onOpenNote}
        onUploadToCloud={onUploadToCloud}
        onSetStatus={onSetStatus}
        onDetails={onDetails}
        onEdit={onEdit}
        onDelete={onDelete}
      />

      {/* Dialogue : choisir ou créer le fichier JSON de partage */}
      <ShareToCloudDialog
        resource={resource}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  );
});

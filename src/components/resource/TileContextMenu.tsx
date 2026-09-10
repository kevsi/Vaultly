import {
  Archive,
  Bell,
  CircleSlash,
  CloudUpload,
  Copy,
  ExternalLink,
  Info,
  ListTodo,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
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
import { useI18n } from "@/lib/i18n";
import { formatRemindAt } from "@/lib/resources";
import type { Folder, Resource } from "@/lib/types";

interface Props {
  resource: Resource;
  isNote: boolean;
  /** ouvrir la ressource (sémantique complète de la tuile) */
  onOpen: () => void;
  onCopy: () => void;
  onToggleFavorite: () => void;
  /** « me rappeler dans… » (null = effacer) */
  onRemind: (days: number | null) => void;
  /** ouvre le dialogue de partage WebDAV */
  onOpenShare: () => void;
  folders?: Folder[];
  onMoveToFolder?: (r: Resource, folderId: number | null) => void;
  onOpenNote?: (r: Resource) => void;
  /** envoie le fichier local vers le cloud WebDAV */
  onUploadToCloud?: (r: Resource) => void;
  onSetStatus?: (r: Resource, status: "" | "todo" | "archived") => void;
  /** ouvre la vue « Détails » (fiche complète, README pour les dépôts) */
  onDetails?: (r: Resource) => void;
  onEdit: (r: Resource) => void;
  onDelete: (r: Resource) => void;
}

/** Menu ⋯ flottant de la tuile — en dehors de la tuile, toujours visible. */
export function TileContextMenu({
  resource,
  isNote,
  onOpen,
  onCopy,
  onToggleFavorite,
  onRemind,
  onOpenShare,
  folders,
  onMoveToFolder,
  onOpenNote,
  onUploadToCloud,
  onSetStatus,
  onDetails,
  onEdit,
  onDelete,
}: Props) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("Options")}
        className="absolute -right-1.5 -top-1.5 z-10 flex size-7 cursor-pointer items-center justify-center rounded-full border bg-background text-muted-foreground shadow-md outline-none transition-colors hover:text-foreground focus-visible:text-foreground data-[popup-open]:text-foreground"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        {isNote ? (
          <>
            <DropdownMenuItem
              onClick={() => (onOpenNote ? onOpenNote(resource) : onOpen())}
            >
              <ExternalLink />
              {t("Ouvrir la note")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(resource)}>
              <Pencil />
              {t("Modifier")}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onClick={onOpen}>
              <ExternalLink />
              {resource.url.startsWith("local:") && !resource.meta?.filePath
                ? t("Ajouter un lien…")
                : t("Ouvrir")}
            </DropdownMenuItem>
            {/* détails : fiche complète (README pour les dépôts) */}
            {onDetails && (
              <DropdownMenuItem onClick={() => onDetails(resource)}>
                <Info />
                {t("Détails")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onCopy}>
              <Copy />
              {t("Copier l'URL")}
            </DropdownMenuItem>
            {resource.url.startsWith("http") && (
              <DropdownMenuItem
                onClick={onOpenShare}
                title={t(
                  "Ajoute ce lien à un fichier JSON sur ton cloud (WebDAV)",
                )}
              >
                <CloudUpload />
                {t("Partager vers le cloud")}
              </DropdownMenuItem>
            )}
            {/* fichier local : envoi réel vers le cloud WebDAV */}
            {(resource.url.startsWith("file:") || resource.meta?.filePath) &&
              onUploadToCloud && (
                <DropdownMenuItem onClick={() => onUploadToCloud(resource)}>
                  <CloudUpload />
                  {t("Envoyer vers le cloud")}
                </DropdownMenuItem>
              )}
          </>
        )}
        <DropdownMenuItem onClick={onToggleFavorite}>
          <Star
            className={
              resource.favorite ? "fill-yellow-400 text-yellow-400" : ""
            }
          />
          {resource.favorite
            ? t("Retirer des favoris")
            : t("Ajouter aux favoris")}
        </DropdownMenuItem>
        {/* statut de traitement */}
        {onSetStatus && resource.status !== "todo" && (
          <DropdownMenuItem onClick={() => onSetStatus(resource, "todo")}>
            <ListTodo />
            {t("Marquer à traiter")}
          </DropdownMenuItem>
        )}
        {/* rappel « me rappeler dans… » */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Bell />
            {t("Me rappeler…")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {[
              { label: "Demain", days: 1 },
              { label: "Dans 3 jours", days: 3 },
              { label: "Dans 1 semaine", days: 7 },
            ].map((o) => (
              <DropdownMenuItem key={o.days} onClick={() => onRemind(o.days)}>
                {t(o.label)}
              </DropdownMenuItem>
            ))}
            {resource.remindAt && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onRemind(null)}>
                  {t("Effacer le rappel ({date})", {
                    date: formatRemindAt(resource.remindAt),
                  })}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {onSetStatus && resource.status !== "archived" && (
          <DropdownMenuItem onClick={() => onSetStatus(resource, "archived")}>
            <Archive />
            {t("Archiver")}
          </DropdownMenuItem>
        )}
        {onSetStatus && resource.status !== "" && (
          <DropdownMenuItem onClick={() => onSetStatus(resource, "")}>
            <CircleSlash />
            {t("Réactiver")}
          </DropdownMenuItem>
        )}
        {/* déplacer vers un dossier */}
        {onMoveToFolder && (folders?.length ?? 0) > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {t("Déplacer vers…")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {(folders ?? []).map((f) => (
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
                    {t("Sortir du dossier")}
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
            {t("Modifier")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onDelete(resource)}
        >
          <Trash2 />
          {t("Supprimer")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

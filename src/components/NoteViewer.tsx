import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Pencil, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog, type ConfirmState } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  deleteResource,
  getOpenPrefs,
  openResourceById,
  toggleFavorite,
} from "@/lib/api";
import { noteColorClass, parseDbDate } from "@/lib/resources";
import { sanitizeHtml } from "@/lib/sanitize";
import type { Resource } from "@/lib/types";
import { cn, describeError } from "@/lib/utils";

interface Props {
  note: Resource | null;
  onClose: () => void;
  onEdit: (r: Resource) => void;
  onChanged: () => void;
}

/** Nom court d'un exécutable configuré (« Code », « notepad++ »…). */
function exeShortName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.exe$/i, "");
}

/** Lecture d'une note : titre + corps mis en forme, actions en pied de carte. */
export function NoteViewer({ note, onClose, onEdit, onChanged }: Props) {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  // application de notes externe (Réglages › Ouverture) : bouton proposé
  // seulement si configurée — hooks avant tout return (règles de React)
  const { data: openPrefs } = useQuery({
    queryKey: ["openPrefs"],
    queryFn: getOpenPrefs,
    enabled: note !== null,
    staleTime: 60_000,
  });
  const noteApp = openPrefs?.noteAppPath?.trim()
    ? openPrefs.noteAppPath.trim()
    : null;

  if (!note) return null;

  async function remove() {
    if (!note) return;
    try {
      await deleteResource(note.id);
      toast.success("Note déplacée dans la corbeille");
      onClose();
      onChanged();
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  async function fav() {
    if (!note) return;
    try {
      await toggleFavorite(note.id);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  /** Ouverture externe : export HTML vers Documents\Vaultly\Notes puis
   *  lancement (les modifications externes ne reviennent pas dans Vaultly). */
  async function openExternal() {
    if (!note || !noteApp) return;
    try {
      await openResourceById(note.id);
      toast.success(`Ouvert dans ${exeShortName(noteApp)}`);
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  /** Les liens d'une note s'ouvrent dans le navigateur externe : sans
   *  interception, le clic ferait naviguer le WebView entier hors de l'app. */
  function onBodyClick(e: React.MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as HTMLElement).closest("a");
    const raw = anchor?.getAttribute("href");
    if (raw === null || raw === undefined) return;
    e.preventDefault();
    // ancre interne ou href vide : laisser faire / silencieux (pas de toast
    // d'erreur global venu du rejet d'openUrl("")). Seuls les liens http(s)
    // partent vers le navigateur externe.
    const href = raw.trim();
    if (href.startsWith("http://") || href.startsWith("https://")) {
      void openUrl(href);
    }
  }

  const date = note.createdAt
    ? parseDbDate(note.createdAt).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          "max-h-[85vh] gap-0 overflow-hidden border-0 p-0 sm:max-w-lg",
          noteColorClass(note.meta?.color),
        )}
      >
        {/* en-tête */}
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold leading-tight">{note.title}</h2>
            {date && <p className="mt-1 text-xs opacity-60">Le {date}</p>}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onEdit(note)}
            title="Modifier"
            className="shrink-0"
          >
            <Pencil />
          </Button>
        </div>

        {/* corps */}
        <div className="max-h-[50vh] overflow-y-auto px-6 py-5">
          <div
            className="note-content text-[15px] leading-relaxed"
            onClick={onBodyClick}
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(note.notes) || "<p><em>(note vide)</em></p>",
            }}
          />
        </div>

        {/* pied : actions */}
        <div className="flex items-center gap-2 border-t border-current/10 bg-black/5 px-6 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fav()}
            className="border-current/20 bg-transparent"
          >
            <Star
              className={note.favorite ? "fill-yellow-400 text-yellow-400" : ""}
            />
            {note.favorite ? "Retiré des favoris" : "Favori"}
          </Button>
          {noteApp && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openExternal()}
              className="border-current/20 bg-transparent"
              title="La note est exportée vers Documents\Vaultly\Notes à chaque ouverture"
            >
              <ExternalLink />
              Ouvrir avec {exeShortName(noteApp)}
            </Button>
          )}
          <span className="grow" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setConfirm({
                title: "Supprimer la note ?",
                message: `« ${note.title} » sera restaurable 30 jours dans la corbeille (Réglages).`,
                confirmLabel: "Supprimer",
                destructive: true,
                action: () => void remove(),
              })
            }
            className="text-destructive hover:bg-destructive/10"
          >
            <Trash2 />
            Supprimer
          </Button>
        </div>

        <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
      </DialogContent>
    </Dialog>
  );
}

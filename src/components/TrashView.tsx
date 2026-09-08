import { useState } from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import { Undo2, Trash2, History, Loader2 } from "lucide-react";
import { emptyTrash, listTrash, restoreTrash, type TrashEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ConfirmDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { hostOf } from "@/lib/resources";
import { useTauriMutation } from "@/lib/useTauriMutation";

/** Date SQLite « YYYY-MM-DD HH:MM:SS » (UTC) → locale FR lisible. */
function formatTrashDate(iso: string): string {
  const d = new Date(iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Corbeille : les suppressions (grille, masse, notes) restent restaurables
 *  30 jours ; la purge des entrées expirées se fait au démarrage de l'app. */
const TRASH_KEYS: QueryKey[] = [["trash"], ["resources"], ["allTags"]];

export function TrashView() {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const { run } = useTauriMutation();

  const { data: trash, isLoading } = useQuery({
    queryKey: ["trash"],
    queryFn: listTrash,
  });

  async function runRestore(entry: TrashEntry) {
    setBusyId(entry.trashId);
    await run(() => restoreTrash(entry.trashId), {
      success: (r) => `« ${r.title} » restaurée`,
      invalidate: TRASH_KEYS,
    });
    setBusyId(null);
  }

  function runEmpty() {
    const n = trash?.length ?? 0;
    if (n === 0) return;
    setConfirm({
      title: `Vider la corbeille (${n} entrée${n > 1 ? "s" : ""}) ?`,
      message: "Ces ressources seront définitivement perdues.",
      confirmLabel: "Vider",
      destructive: true,
      action: async () => {
        await run(() => emptyTrash(), {
          success: (count) => `Corbeille vidée (${count})`,
          invalidate: [["trash"]],
        });
      },
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* en-tête de page */}
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">Corbeille</h2>
        {(trash?.length ?? 0) > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {trash!.length} entrée{trash!.length > 1 ? "s" : ""}
          </span>
        )}
        <span className="grow" />
        {(trash?.length ?? 0) > 0 && (
          <Button variant="outline" size="sm" onClick={runEmpty}>
            <Trash2 className="text-destructive" />
            Vider la corbeille
          </Button>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl p-6">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Lecture de la corbeille…
            </div>
          ) : (trash?.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
              <History className="size-8 opacity-40" />
              <p className="font-medium text-foreground">La corbeille est vide</p>
              <p className="max-w-sm text-sm">
                Les ressources supprimées de la bibliothèque apparaîtront ici
                pendant 30 jours — restaurables d'un clic.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {trash!.map((e) => {
                const busy = busyId === e.trashId;
                return (
                  <div
                    key={e.trashId}
                    className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5"
                  >
                    {e.resource.favicon ? (
                      <img
                        src={e.resource.favicon}
                        alt=""
                        loading="lazy"
                        className="size-8 shrink-0 rounded-lg object-contain"
                      />
                    ) : (
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] font-bold uppercase text-muted-foreground">
                        {e.resource.title.slice(0, 2)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {e.resource.title}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {hostOf(e.resource.url) || e.resource.url}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      supprimée le {formatTrashDate(e.deletedAt)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      title="Remettre cette ressource dans la bibliothèque"
                      onClick={() => void runRestore(e)}
                    >
                      {busy ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Undo2 />
                      )}
                      Restaurer
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

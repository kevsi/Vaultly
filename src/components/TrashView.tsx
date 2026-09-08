import { useState } from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import { Undo2, Trash2, History, Loader2, CheckSquare, X } from "lucide-react";
import {
  emptyTrash,
  listTrash,
  restoreTrash,
  restoreTrashBulk,
  type TrashEntry,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

const TRASH_KEYS: QueryKey[] = [["trash"], ["resources"], ["allTags"]];

/** Corbeille : les suppressions (grille, masse, notes) restent restaurables
 *  30 jours ; la purge des entrées expirées se fait au démarrage de l'app. */
export function TrashView() {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const { run } = useTauriMutation();

  const { data: trash, isLoading } = useQuery({
    queryKey: ["trash"],
    queryFn: listTrash,
  });

  const entries = trash ?? [];
  const allSelected = entries.length > 0 && selected.size === entries.length;

  function toggleSelect(trashId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(trashId)) next.delete(trashId);
      else next.add(trashId);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(entries.map((e) => e.trashId)));
  }

  async function runRestore(entry: TrashEntry) {
    setBusyId(entry.trashId);
    await run(() => restoreTrash(entry.trashId), {
      success: (r) => `« ${r.title} » restaurée`,
      invalidate: TRASH_KEYS,
    });
    setBusyId(null);
  }

  async function runRestoreSelection() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    const result = await run(() => restoreTrashBulk(ids), {
      success: (r) => {
        const n = r.restored;
        const base = `${n} ressource${n > 1 ? "s" : ""} restaurée${n > 1 ? "s" : ""}`;
        if (r.missing.length > 0) {
          return `${base} (${r.missing.length} déjà disparue${r.missing.length > 1 ? "s" : ""})`;
        }
        return base;
      },
      invalidate: TRASH_KEYS,
    });
    setBulkBusy(false);
    if (result) setSelected(new Set());
  }

  function runEmpty() {
    const n = entries.length;
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
        setSelected(new Set());
      },
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* en-tête de page */}
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">Corbeille</h2>
        {entries.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {entries.length} entrée{entries.length > 1 ? "s" : ""}
          </span>
        )}
        <span className="grow" />
        {entries.length > 1 && (
          <Button variant="outline" size="sm" onClick={toggleAll}>
            <CheckSquare />
            {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
          </Button>
        )}
        {entries.length > 0 && (
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
          ) : entries.length === 0 ? (
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
              {entries.map((e) => {
                const busy = busyId === e.trashId;
                const checked = selected.has(e.trashId);
                return (
                  <div
                    key={e.trashId}
                    className={
                      "flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition-shadow" +
                      (checked ? " ring-2 ring-amber-500" : "")
                    }
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleSelect(e.trashId)}
                      aria-label={`Sélectionner « ${e.resource.title} »`}
                      className="size-4.5"
                    />
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
                      disabled={busy || bulkBusy}
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

      {/* barre d'actions de la sélection */}
      {selected.size > 0 && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 animate-pop-in items-center gap-2 rounded-2xl border bg-popover px-4 py-2 shadow-2xl">
          <span className="text-sm font-medium tabular-nums">
            {selected.size} sélectionnée{selected.size > 1 ? "s" : ""}
          </span>
          <Button
            size="sm"
            disabled={bulkBusy}
            onClick={() => void runRestoreSelection()}
          >
            {bulkBusy ? <Loader2 className="animate-spin" /> : <Undo2 />}
            Restaurer la sélection
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Tout désélectionner"
            onClick={() => setSelected(new Set())}
          >
            <X />
          </Button>
        </div>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

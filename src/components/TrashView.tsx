import { type QueryKey, useQuery } from "@tanstack/react-query";
import { CheckSquare, History, Loader2, Trash2, Undo2, X } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog, type ConfirmState } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  emptyTrash,
  listTrash,
  restoreTrash,
  restoreTrashBulk,
  type TrashEntry,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { hostOf, parseDbDate } from "@/lib/resources";
import { useTauriMutation } from "@/lib/useTauriMutation";

/** Date SQLite « YYYY-MM-DD HH:MM:SS » (UTC) → locale FR lisible. */
function formatTrashDate(iso: string): string {
  const d = parseDbDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TRASH_KEYS: QueryKey[] = [
  ["trash"],
  ["resources"],
  ["allTags"],
  ["stats"],
];

/** Corbeille : les suppressions (grille, masse, notes) restent restaurables
 *  30 jours ; la purge des entrées expirées se fait au démarrage de l'app. */
export function TrashView() {
  const { t } = useI18n();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const { run } = useTauriMutation();

  const {
    data: trash,
    isLoading,
    isError,
  } = useQuery({
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
    setSelected(
      allSelected ? new Set() : new Set(entries.map((e) => e.trashId)),
    );
  }

  async function runRestore(entry: TrashEntry) {
    setBusyId(entry.trashId);
    await run(() => restoreTrash(entry.trashId), {
      success: (r) => t("« {title} » restaurée", { title: r.title }),
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
        if (r.missing.length > 0) {
          return t(
            "{count} ressource(s) restaurée(s) ({count2} déjà disparue(s))",
            { count: n, count2: r.missing.length },
          );
        }
        return t("{count} ressource(s) restaurée(s)", { count: n });
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
      title: t("Vider la corbeille ({count} entrée(s)) ?", { count: n }),
      message: t("Ces ressources seront définitivement perdues."),
      confirmLabel: t("Vider"),
      destructive: true,
      action: async () => {
        await run(() => emptyTrash(), {
          success: (count) => t("Corbeille vidée ({count})", { count }),
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
        <h2 className="text-sm font-semibold">{t("Corbeille")}</h2>
        {entries.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("{count} entrée(s)", { count: entries.length })}
          </span>
        )}
        <span className="grow" />
        {entries.length > 1 && (
          <Button variant="outline" size="sm" onClick={toggleAll}>
            <CheckSquare />
            {allSelected ? t("Tout désélectionner") : t("Tout sélectionner")}
          </Button>
        )}
        {entries.length > 0 && (
          <Button variant="outline" size="sm" onClick={runEmpty}>
            <Trash2 className="text-destructive" />
            {t("Vider la corbeille")}
          </Button>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl p-6">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("Lecture de la corbeille…")}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
              <History className="size-8 opacity-40" />
              <p className="font-medium text-foreground">
                {t("Impossible de lire la corbeille")}
              </p>
              <p className="max-w-sm text-sm">
                {t(
                  "Réessaie depuis l'onglet Bibliothèque, ou redémarre Vaultly si le problème persiste.",
                )}
              </p>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
              <History className="size-8 opacity-40" />
              <p className="font-medium text-foreground">
                {t("La corbeille est vide")}
              </p>
              <p className="max-w-sm text-sm">
                {t(
                  "Les ressources supprimées de la bibliothèque apparaîtront ici pendant 30 jours — restaurables d'un clic.",
                )}
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
                      aria-label={t("Sélectionner « {title} »", {
                        title: e.resource.title,
                      })}
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
                      {t("supprimée le {date}", {
                        date: formatTrashDate(e.deletedAt),
                      })}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || bulkBusy}
                      title={t("Remettre cette ressource dans la bibliothèque")}
                      onClick={() => void runRestore(e)}
                    >
                      {busy ? <Loader2 className="animate-spin" /> : <Undo2 />}
                      {t("Restaurer")}
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
            {t("{count} sélectionnée(s)", { count: selected.size })}
          </span>
          <Button
            size="sm"
            disabled={bulkBusy}
            onClick={() => void runRestoreSelection()}
          >
            {bulkBusy ? <Loader2 className="animate-spin" /> : <Undo2 />}
            {t("Restaurer la sélection")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("Tout désélectionner")}
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

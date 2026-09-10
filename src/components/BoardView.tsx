import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { hostOf } from "@/lib/resources";
import type { Resource } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  /** ressources déjà filtrées (tous statuts) par la vue courante */
  resources: Resource[];
  /** ouvrir (note → lecteur, sinon openResource) */
  onOpen: (r: Resource) => void;
  /** changer le statut (commande pure, sans effet dossier) */
  onMove: (id: number, status: "" | "todo" | "archived") => Promise<void>;
}

type Status = "" | "todo" | "archived";

// statut inconnu traité comme « en cours » ("" = actif)
function normStatus(r: Resource): Status {
  return r.status === "todo" || r.status === "archived" ? r.status : "";
}

// Colonnes du tableau. On réutilise les 3 statuts existants : « à traiter »
// (inbox), « en cours » (actif), « fait » (archivé). Zéro migration de schéma.
const COLUMNS: { status: Status; label: string; accent: string }[] = [
  { status: "todo", label: "À traiter", accent: "bg-amber-500" },
  { status: "", label: "En cours", accent: "bg-sky-500" },
  { status: "archived", label: "Fait", accent: "bg-emerald-500" },
];

/** Vue « tableau » de la bibliothèque : cartes triées par statut, déplaçables
 *  par glisser-déposer entre colonnes OU via les flèches ◀ ▶ (accessible au
 *  clavier, testable sans souris). */
export function BoardView({ resources, onOpen, onMove }: Props) {
  const { t } = useI18n();
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const byColumn = useMemo(() => {
    const map: Record<Status, Resource[]> = {
      todo: [],
      "": [],
      archived: [],
    };
    for (const r of resources) map[normStatus(r)].push(r);
    return map;
  }, [resources]);

  async function move(r: Resource, to: Status) {
    if (normStatus(r) === to) return;
    setBusyId(r.id);
    try {
      await onMove(r.id, to);
    } finally {
      setBusyId(null);
    }
  }

  function shift(r: Resource, dir: -1 | 1) {
    const idx = COLUMNS.findIndex((c) => c.status === normStatus(r));
    const next = COLUMNS[idx + dir];
    if (next) void move(r, next.status);
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pt-3 pb-4">
      {COLUMNS.map((col) => {
        const items = byColumn[col.status];
        return (
          <section
            key={col.status || "active"}
            onDragOver={(e) => {
              if (dragId === null) return;
              e.preventDefault();
              setOver(col.status);
            }}
            onDragLeave={() => setOver((o) => (o === col.status ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              const id = Number(e.dataTransfer.getData("text/plain"));
              const r = resources.find((x) => x.id === id);
              setDragId(null);
              setOver(null);
              if (r) void move(r, col.status);
            }}
            className={cn(
              "flex min-w-72 flex-1 flex-col rounded-xl border bg-card/40 transition-colors",
              over === col.status && "border-primary/60 bg-accent/30",
            )}
          >
            <header className="flex items-center gap-2 px-3 py-2.5">
              <span className={cn("size-2 rounded-full", col.accent)} />
              <span className="text-sm font-semibold">{t(col.label)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {items.length}
              </span>
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {items.length === 0 && (
                <div className="grid flex-1 place-items-center rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  {t("Dépose une carte ici")}
                </div>
              )}
              {items.map((r) => {
                const idx = COLUMNS.findIndex(
                  (c) => c.status === normStatus(r),
                );
                return (
                  <div
                    key={r.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", String(r.id));
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(r.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOver(null);
                    }}
                    className={cn(
                      "group rounded-lg border bg-card p-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
                      dragId === r.id && "opacity-40",
                      busyId === r.id && "opacity-60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(r)}
                      className="flex w-full cursor-pointer items-start gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      title={r.url}
                    >
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                        {r.favicon ? (
                          <img
                            src={r.favicon}
                            alt=""
                            loading="lazy"
                            className="size-full object-contain"
                          />
                        ) : (
                          <span className="text-[10px] font-bold uppercase text-muted-foreground">
                            {r.title.slice(0, 2)}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm font-medium leading-snug">
                          {r.title}
                        </span>
                        {r.url.startsWith("http") && (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <ExternalLink className="size-3 shrink-0" />
                            {hostOf(r.url)}
                          </span>
                        )}
                      </span>
                    </button>
                    <div className="mt-1.5 flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={idx <= 0 || busyId === r.id}
                        onClick={() => shift(r, -1)}
                        title={t("Colonne précédente")}
                        aria-label={t("Colonne précédente")}
                      >
                        <ArrowLeft />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={idx >= COLUMNS.length - 1 || busyId === r.id}
                        onClick={() => shift(r, 1)}
                        title={t("Colonne suivante")}
                        aria-label={t("Colonne suivante")}
                      >
                        <ArrowRight />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

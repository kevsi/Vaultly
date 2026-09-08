import { Activity, Flame, Star, Tag } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getStats } from "@/lib/api";
import { typeLabel } from "@/lib/resources";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export function StatsView() {
  const { data: s, isLoading, isError, error } = useQuery({
    queryKey: ["stats"],
    queryFn: getStats,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Chargement des statistiques…
      </div>
    );
  }
  if (isError || !s) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">
          Impossible de charger les statistiques
        </p>
        <p className="max-w-sm">{String(error ?? "erreur inconnue")}</p>
      </div>
    );
  }

  const cards = [
    { label: "Ressources", value: s.total, icon: Activity },
    { label: "Favoris", value: s.favorites, icon: Star },
    { label: "Jamais ouvertes", value: s.neverOpened, icon: Tag },
  ];

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <h2 className="text-lg font-semibold">Statistiques</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ta bibliothèque en un coup d'œil.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {cards.map((c) => (
            <div key={c.label} className="rounded-xl border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <c.icon className="size-4" />
                {c.label}
              </div>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {c.value}
              </p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border p-4">
            <h3 className="font-medium">Par type</h3>
            <div className="mt-3 space-y-2">
              {s.byType.filter(([t]) => t !== "").map(([t, n]) => {
                const pct = s.total > 0 ? Math.round((n / s.total) * 100) : 0;
                return (
                  <div key={t}>
                    <div className="flex justify-between text-sm">
                      <span>{typeLabel(t)}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {n} ({pct} %)
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border p-4">
            <h3 className="flex items-center gap-2 font-medium">
              <Flame className="size-4" />
              Top utilisation
            </h3>
            <div className="mt-3 space-y-1.5">
              {s.topUsed
                .filter((r) => r.openCount > 0)
                .slice(0, 6)
                .map((r, i) => (
                  <div key={r.id} className="flex items-center gap-2 text-sm">
                    <span className="w-4 tabular-nums text-muted-foreground">
                      {i + 1}.
                    </span>
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {r.openCount} ouverture{r.openCount > 1 ? "s" : ""}
                    </span>
                  </div>
                ))}
              {s.topUsed.every((r) => r.openCount === 0) && (
                <p className="text-sm text-muted-foreground">
                  Ouvre des ressources pour voir le classement apparaître.
                </p>
              )}
            </div>
          </div>
        </div>

        <Separator />
        <p className="text-xs text-muted-foreground">
          Astuce : clique des tuiles pour faire monter les compteurs, et
          renseigne le statut des articles/vidéos pour suivre ta progression.
        </p>
      </div>
    </ScrollArea>
  );
}

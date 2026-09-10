import { useQuery } from "@tanstack/react-query";
import { Activity, Flame, Star, Tag } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { getStats } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { hostOf, parseDbDate, typeLabel } from "@/lib/resources";

const MONTHS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

/** 12 derniers mois, trous comblés à zéro : ["YYYY-MM", n] → série dense. */
function activitySeries(
  activity: [string, number][],
): { label: string; n: number }[] {
  const map = new Map(activity);
  const out: { label: string; n: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ label: MONTHS[d.getMonth()], n: map.get(key) ?? 0 });
  }
  return out;
}

/** Mini-histogramme SVG : 12 barres, sans librairie externe. */
function ActivityChart({ activity }: { activity: [string, number][] }) {
  const { t } = useI18n();
  const series = activitySeries(activity);
  const max = Math.max(...series.map((s) => s.n), 1);
  return (
    <div className="mt-3 flex h-24 items-end gap-1.5">
      {series.map((s) => (
        <div
          key={s.label}
          className="group flex min-w-0 flex-1 flex-col items-center gap-1"
          title={t("{month} : {count} ajout(s)", {
            month: t(s.label),
            count: s.n,
          })}
        >
          <div className="flex h-20 w-full items-end">
            <div
              className={
                "w-full rounded-t-md transition-colors " +
                (s.n > 0 ? "bg-primary/70 group-hover:bg-primary" : "bg-muted")
              }
              style={{
                height: `${Math.max(s.n > 0 ? (s.n / max) * 100 : 0, 3)}%`,
              }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">
            {t(s.label)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function StatsView() {
  const { t } = useI18n();
  const {
    data: s,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["stats"],
    queryFn: getStats,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("Chargement des statistiques…")}
      </div>
    );
  }
  if (isError || !s) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">
          {t("Impossible de charger les statistiques")}
        </p>
        <p className="max-w-sm">{String(error ?? t("erreur inconnue"))}</p>
      </div>
    );
  }

  const cards = [
    { label: "Ressources", value: s.total, icon: Activity },
    { label: "Favoris", value: s.favorites, icon: Star },
    { label: "Jamais ouvertes", value: s.neverOpened, icon: Tag },
  ];
  const tagMax = Math.max(...s.byTag.map(([, n]) => n), 1);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <h2 className="text-lg font-semibold">{t("Statistiques")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Ta bibliothèque en un coup d'œil.")}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {cards.map((c) => (
            <div key={c.label} className="rounded-xl border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <c.icon className="size-4" />
                {t(c.label)}
              </div>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {c.value}
              </p>
            </div>
          ))}
        </div>

        {/* activité : créations par mois sur 12 mois */}
        <div className="rounded-xl border p-4">
          <h3 className="font-medium">{t("Activité — 12 derniers mois")}</h3>
          <ActivityChart activity={s.activity} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border p-4">
            <h3 className="font-medium">{t("Par type")}</h3>
            <div className="mt-3 space-y-2">
              {s.byType
                .filter(([t]) => t !== "")
                .map(([t, n]) => {
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

          {/* par tag : mêmes barres, top 10 */}
          <div className="rounded-xl border p-4">
            <h3 className="font-medium">{t("Par tag")}</h3>
            {s.byTag.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {t(
                  "Ajoute des tags à tes ressources pour voir la répartition.",
                )}
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {s.byTag.map(([tag, n]) => (
                  <div key={tag}>
                    <div className="flex justify-between text-sm">
                      <span className="min-w-0 truncate">{tag}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {n}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-chart-2/80"
                        style={{ width: `${Math.max((n / tagMax) * 100, 2)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border p-4">
            <h3 className="flex items-center gap-2 font-medium">
              <Flame className="size-4" />
              {t("Top utilisation")}
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
                      {t("{count} ouverture(s)", { count: r.openCount })}
                    </span>
                  </div>
                ))}
              {s.topUsed.every((r) => r.openCount === 0) && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    "Ouvre des ressources pour voir le classement apparaître.",
                  )}
                </p>
              )}
            </div>
          </div>

          {/* jamais ouvertes : les plus anciennes, cliquables dans la palette */}
          <div className="rounded-xl border p-4">
            <h3 className="font-medium">{t("Oubliées — jamais ouvertes")}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("Les plus anciennes d'abord : passe les revoir ou nettoie.")}
            </p>
            {s.neverOpenedList.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {t(
                  "Toutes tes ressources ont été ouvertes au moins une fois. 🎉",
                )}
              </p>
            ) : (
              <div className="mt-3 space-y-1.5">
                {s.neverOpenedList.map((r) => {
                  const d = parseDbDate(r.createdAt);
                  const when = Number.isNaN(d.getTime())
                    ? ""
                    : d.toLocaleDateString("fr-FR", {
                        month: "short",
                        year: "numeric",
                      });
                  return (
                    <div key={r.id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{r.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {typeLabel(r.resourceType)} · {hostOf(r.url)}
                        {when ? ` · ${when}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <Separator />
        <p className="text-xs text-muted-foreground">
          {t(
            "Astuce : clique des tuiles pour faire monter les compteurs, et renseigne le statut des articles/vidéos pour suivre ta progression.",
          )}
        </p>
      </div>
    </ScrollArea>
  );
}

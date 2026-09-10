import { Bell } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatRemindAt } from "@/lib/resources";
import type { Resource } from "@/lib/types";

interface Props {
  resource: Resource;
  /** ajoutée il y a longtemps, jamais ouverte (calculée par la tuile) */
  stale: boolean;
  selectMode: boolean;
}

/** Badges superposés à la tuile : statut, « à revisiter », rappel programmé. */
export function TileBadges({ resource, stale, selectMode }: Props) {
  const { t } = useI18n();
  return (
    <>
      {/* chip de statut, coin supérieur gauche intérieur */}
      {resource.status === "todo" && !selectMode && (
        <span
          className="absolute left-2 top-2 z-10 rounded-full bg-amber-400/90 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950"
          title={t("À traiter")}
        >
          {t("À traiter")}
        </span>
      )}
      {resource.status === "archived" && !selectMode && (
        <span
          className="absolute left-2 top-2 z-10 rounded-full bg-zinc-500/85 px-1.5 py-0.5 text-[10px] font-semibold text-white"
          title={t("Archivé")}
        >
          {t("Archivé")}
        </span>
      )}

      {/* à revisiter : ajoutée il y a longtemps, jamais ouverte */}
      {stale && resource.status !== "archived" && !selectMode && (
        <div
          className="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-1 rounded-full border bg-background/85 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-300"
          title={t("Ajoutée il y a plus de 2 mois, jamais ouverte")}
        >
          {t("à revisiter")}
        </div>
      )}

      {/* rappel programmé : s'efface à l'ouverture */}
      {resource.remindAt && !selectMode && (
        <div
          className="absolute right-1.5 bottom-1.5 z-10 flex items-center gap-1 rounded-full border bg-background/85 px-1.5 py-0.5 text-[10px] text-sky-600 dark:text-sky-300"
          title={t("Rappel programmé — s'efface à l'ouverture")}
        >
          <Bell className="size-3" />
          {formatRemindAt(resource.remindAt)}
        </div>
      )}
    </>
  );
}

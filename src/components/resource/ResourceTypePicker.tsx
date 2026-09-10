import { useI18n } from "@/lib/i18n";
import { RESOURCE_TYPES } from "@/lib/resources";

/** Étape 1 : choix du type — descriptifs courts sous chaque carte. */
const TYPE_DESCS: Record<string, string> = {
  site: "Page web à garder",
  app: "Logiciel à lancer",
  repo: "GitHub, GitLab…",
  outil: "Service en ligne",
  article: "À lire, doc…",
  video: "YouTube, Twitch…",
  fichier: "Fichier du PC",
  autre: "Tout le reste",
};

interface Props {
  /** Étape 1 → 2 : le type choisi, l'écran bascule vers ses options. */
  onPick: (value: string) => void;
}

/** Étape 1 du dialogue : grille de cartes « Que veux-tu ajouter ? ». */
export function ResourceTypePicker({ onPick }: Props) {
  const { t } = useI18n();
  return (
    <div className="grid animate-fade-in grid-cols-2 gap-2 sm:grid-cols-4">
      {RESOURCE_TYPES.filter((t) => t.value !== "note").map((r) => (
        <button
          key={r.value}
          type="button"
          onClick={() => onPick(r.value)}
          className="group flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-border bg-card px-2 py-3.5 text-center transition-all outline-none hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            <r.icon className="size-5" />
          </span>
          <span className="text-sm font-medium">{t(r.label)}</span>
          <span className="text-[11px] leading-tight text-muted-foreground">
            {t(TYPE_DESCS[r.value] ?? "")}
          </span>
        </button>
      ))}
    </div>
  );
}

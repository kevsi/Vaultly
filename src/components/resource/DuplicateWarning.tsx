import { TriangleAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Resource } from "@/lib/types";

interface Props {
  /** doublon détecté : la ressource existante, ou `true` (variante
   *  canonique connue du backend mais non résolue par la recherche) */
  duplicate: Resource | true;
  /** ferme le dialogue avant de naviguer vers l'existant */
  onDismiss: () => void;
  /** doublon détecté : naviguer vers la ressource existante */
  onShowExisting: (res: Resource) => void;
}

/** URL exacte déjà enregistrée : renvoi vers l'existant. */
export function DuplicateWarning({
  duplicate,
  onDismiss,
  onShowExisting,
}: Props) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1 text-xs">
        <span className="font-medium">
          {t("Cette URL est déjà dans ta bibliothèque")}
          {typeof duplicate === "object" && ` : ${duplicate.title}`}
        </span>
        {typeof duplicate === "object" && (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => {
                onDismiss();
                onShowExisting(duplicate);
              }}
              className="cursor-pointer font-medium text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {t("Voir la ressource")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

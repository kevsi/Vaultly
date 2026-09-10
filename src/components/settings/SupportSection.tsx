import { Heart } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { openKoFi, openSponsors } from "@/lib/support";
import { describeError } from "@/lib/utils";

export function SupportSection() {
  const { t } = useI18n();

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-medium">{t("Soutenir Vaultly")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "Vaultly est gratuit, sans publicité et sans compte. Si l'app te sert au quotidien, un don — même petit — aide à garder le projet vivant : hébergement, temps de développement, nouvelles fonctionnalités.",
          )}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          onClick={() =>
            void openSponsors().catch((e) => toast.error(describeError(e)))
          }
        >
          <Heart />
          GitHub Sponsors
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            void openKoFi().catch((e) => toast.error(describeError(e)))
          }
        >
          <Heart />
          {t("Ko-fi (dons ponctuels)")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          "Les liens s'ouvrent dans ton navigateur. Toutes les fonctionnalités de Vaultly restent gratuites, pour toujours.",
        )}
      </p>
    </div>
  );
}

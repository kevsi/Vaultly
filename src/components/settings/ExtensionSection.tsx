import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { type Dispatch, type SetStateAction, useState } from "react";
import { toast } from "sonner";
import type { ConfirmState } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { apiRegenerateToken, getMcpStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { describeError } from "@/lib/utils";

interface ExtensionSectionProps {
  setConfirm: Dispatch<SetStateAction<ConfirmState | null>>;
}

export function ExtensionSection({ setConfirm }: ExtensionSectionProps) {
  const { t } = useI18n();
  const { data: status } = useQuery({
    queryKey: ["mcpStatus"],
    queryFn: getMcpStatus,
  });
  const qc = useQueryClient();
  const [regenBusy, setRegenBusy] = useState(false);

  const addToken = status?.addToken ?? "";

  async function runRegenerateAddToken() {
    setConfirm({
      title: t("Régénérer le token de l'extension ?"),
      message: t(
        "Il faudra recoller le nouveau token dans le popup de l'extension navigateur.",
      ),
      confirmLabel: t("Régénérer"),
      action: async () => {
        setRegenBusy(true);
        try {
          await apiRegenerateToken();
          toast.success(t("settings.regenerated-add"));
          void qc.invalidateQueries({ queryKey: ["mcpStatus"] });
        } catch (e) {
          toast.error(describeError(e));
        } finally {
          setRegenBusy(false);
        }
      },
    });
  }

  return (
    <>
      {/* extension navigateur */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("settings.browser-extension")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Ajoute la page courante en un clic depuis Brave, Chrome ou Edge.",
            )}
          </p>
        </div>
        <ol className="ml-4 list-decimal space-y-1.5 text-sm text-muted-foreground">
          <li>
            {t("Ouvre")}{" "}
            <code className="rounded bg-muted px-1">brave://extensions</code> (
            {t("ou")}{" "}
            <code className="rounded bg-muted px-1">chrome://extensions</code>)
          </li>
          <li>{t("settings.extension-steps-dev")}</li>
          <li>
            {t("Clique")} <b>{t("Charger l'extension non empaquetée")}</b>{" "}
            {t("puis sélectionne le dossier")}{" "}
            <code className="rounded bg-muted px-1">extension</code>{" "}
            {t("à la racine du projet Vaultly")}
          </li>
          <li>
            {t("Clique l'icône Vaultly dans la barre et colle le")}{" "}
            <b>{t("token de l'extension")}</b>{" "}
            {t("(ci-dessous) une seule fois")}
          </li>
        </ol>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">
            {t("settings.extension-token")}
          </span>
          <p className="text-xs text-muted-foreground">
            {t("settings.extension-token-desc")}
          </p>
          <code className="break-all rounded-lg bg-muted p-2 text-xs">
            {addToken || "…"}
          </code>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                void navigator.clipboard.writeText(addToken);
              }}
            >
              <Copy />
              {t("Copier")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => void runRegenerateAddToken()}
              disabled={regenBusy}
            >
              {regenBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {t("Régénérer")}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            "Vaultly doit être ouvert pour recevoir les ajouts — et copier une URL suffit : l'app propose automatiquement de l'ajouter (Ctrl+N pour ouvrir le formulaire à la main).",
          )}
        </p>
      </div>
    </>
  );
}

import type { Update } from "@tauri-apps/plugin-updater";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ConfirmState } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import {
  checkForUpdates,
  currentVersion,
  installUpdate,
  markUpdateChecked,
} from "@/lib/updater";
import { describeError } from "@/lib/utils";

interface UpdateSectionProps {
  setConfirm: Dispatch<SetStateAction<ConfirmState | null>>;
}

export function UpdateSection({ setConfirm }: UpdateSectionProps) {
  const { t } = useI18n();
  // --- Mise à jour (GitHub Releases) ---
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [available, setAvailable] = useState<Update | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);

  useEffect(() => {
    if (appVersion !== null) return;
    void currentVersion().then(setAppVersion);
  }, [appVersion]);

  async function runUpdateCheck() {
    setUpdateBusy(true);
    setUpdateStatus(t("settings.checking"));
    try {
      const update = await checkForUpdates();
      markUpdateChecked();
      setAvailable(update);
      setUpdateStatus(
        update
          ? t("settings.version-available", { version: update.version })
          : t("settings.up-to-date"),
      );
    } catch {
      setUpdateStatus(t("settings.check-failed"));
    } finally {
      setUpdateBusy(false);
    }
  }

  function runUpdateInstall() {
    if (!available) return;
    const version = available.version;
    setConfirm({
      title: t("settings.install-question", { version }),
      message: t("settings.install-message"),
      confirmLabel: t("settings.install"),
      action: async () => {
        setUpdateBusy(true);
        try {
          await installUpdate(available);
        } catch (e) {
          toast.error(
            t(
              "Installation impossible : {error} (clé de signature manquante ?)",
              {
                error: describeError(e),
              },
            ),
          );
        } finally {
          setUpdateBusy(false);
        }
      },
    });
  }

  return (
    <>
      {/* mise à jour */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("settings.update")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.update-desc", { version: appVersion ?? "…" })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void runUpdateCheck()}
            disabled={updateBusy}
          >
            {updateBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t("settings.check")}
          </Button>
          {available && (
            <Button onClick={() => runUpdateInstall()} disabled={updateBusy}>
              <Download />
              {t("settings.install-version", {
                version: available.version,
              })}
            </Button>
          )}
        </div>
        {updateStatus && (
          <p className="text-sm text-muted-foreground">{updateStatus}</p>
        )}
      </div>
    </>
  );
}

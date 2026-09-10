import {
  open as openFileDialog,
  save as saveFileDialog,
} from "@tauri-apps/plugin-dialog";
import { Download, Loader2, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { WebDavBackupSection } from "@/components/WebDavBackupSection";
import { exportData, importData } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { describeError } from "@/lib/utils";

export function BackupSection() {
  const { t } = useI18n();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  async function runExport() {
    try {
      const path = await saveFileDialog({
        title: t("settings.export-library"),
        defaultPath: "vaultly-export.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      setExporting(true);
      const n = await exportData(path);
      toast.success(t("settings.exported", { count: n }));
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setExporting(false);
    }
  }

  async function runImport() {
    try {
      const path = await openFileDialog({
        title: t("settings.import-backup"),
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") return;
      setImporting(true);
      const r = await importData(path);
      toast.success(
        t(
          "{resourcesAdded} ressource(s) ajoutée(s), {duplicates} doublon(s), {foldersAdded} dossier(s){invalid}",
          {
            resourcesAdded: r.resourcesAdded,
            duplicates: r.duplicates,
            foldersAdded: r.foldersAdded,
            invalid:
              r.invalid > 0
                ? t(" · {invalid} entrée(s) invalide(s) ignorée(s)", {
                    invalid: r.invalid,
                  })
                : "",
          },
        ),
      );
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      {/* sauvegarde locale JSON */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("settings.backup")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.backup-desc")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void runExport()}
            disabled={exporting}
          >
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            {t("settings.export-all")}
          </Button>
          <Button
            variant="outline"
            onClick={() => void runImport()}
            disabled={importing}
          >
            {importing ? <Loader2 className="animate-spin" /> : <Upload />}
            {t("settings.import-backup-label")}
          </Button>
        </div>
      </div>

      <Separator />

      <WebDavBackupSection />
    </>
  );
}

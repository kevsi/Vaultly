import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Check, FileInput } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { detectOpeners, getOpenPrefs, setOpenPrefs } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn, describeError } from "@/lib/utils";

/** Nom court d'un exécutable configuré (« Code », « notepad++ »…). */
function exeBase(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.exe$/i, "");
}

/** Ligne de choix radio (navigateur / application de notes). */
function OpenerOption({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "border-primary ring-2 ring-primary/30"
          : "cursor-pointer border-border hover:bg-accent/50",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
          active ? "bg-primary" : "bg-muted-foreground/40",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle && (
          <span
            className="block truncate text-xs text-muted-foreground"
            title={subtitle}
          >
            {subtitle}
          </span>
        )}
      </span>
      {active && <Check className="size-4 shrink-0 text-primary" />}
    </button>
  );
}

export function OpenersSection() {
  const { t } = useI18n();
  const qc = useQueryClient();

  // --- Applications d'ouverture (navigateur + notes externes) ---
  const { data: openers } = useQuery({
    queryKey: ["openers"],
    queryFn: detectOpeners,
  });
  const { data: openPrefs } = useQuery({
    queryKey: ["openPrefs"],
    queryFn: getOpenPrefs,
  });
  const [openBusy, setOpenBusy] = useState(false);

  async function applyOpenPrefs(browserPath: string, noteAppPath: string) {
    setOpenBusy(true);
    try {
      await setOpenPrefs(browserPath, noteAppPath);
      toast.success(t("settings.open-prefs-saved"));
      void qc.invalidateQueries({ queryKey: ["openPrefs"] });
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setOpenBusy(false);
    }
  }

  async function pickCustomOpener(kind: "browser" | "note") {
    try {
      const file = await openFileDialog({
        multiple: false,
        title:
          kind === "browser"
            ? t("settings.choose-browser")
            : t("settings.choose-note-app"),
        filters: [{ name: t("Exécutable"), extensions: ["exe"] }],
      });
      if (typeof file !== "string") return;
      const prefs = openPrefs ?? { browserPath: "", noteAppPath: "" };
      if (kind === "browser") {
        await applyOpenPrefs(file, prefs.noteAppPath);
      } else {
        await applyOpenPrefs(prefs.browserPath, file);
      }
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  return (
    <>
      {/* navigateur par défaut */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("settings.open-browser")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Quel navigateur ouvre tes liens web. « Système » = ton navigateur par défaut Windows.",
            )}
          </p>
        </div>
        <div className="grid gap-1.5">
          <OpenerOption
            active={!openPrefs?.browserPath}
            onClick={() =>
              void applyOpenPrefs("", openPrefs?.noteAppPath ?? "")
            }
            title={t("settings.system-default")}
          />
          {(openers?.browsers ?? []).map((b) => (
            <OpenerOption
              key={b.id}
              active={openPrefs?.browserPath === b.path}
              onClick={() =>
                void applyOpenPrefs(b.path, openPrefs?.noteAppPath ?? "")
              }
              title={b.name}
              subtitle={b.path}
            />
          ))}
          {openPrefs?.browserPath &&
            !(openers?.browsers ?? []).some(
              (b) => b.path === openPrefs.browserPath,
            ) && (
              <OpenerOption
                active
                onClick={() =>
                  void applyOpenPrefs(
                    openPrefs.browserPath,
                    openPrefs?.noteAppPath ?? "",
                  )
                }
                title={exeBase(openPrefs.browserPath)}
                subtitle={openPrefs.browserPath}
              />
            )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={openBusy}
          onClick={() => void pickCustomOpener("browser")}
        >
          <FileInput />
          {t("Choisir un exécutable…")}
        </Button>
      </div>

      <Separator />

      {/* application de notes externe */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("settings.note-app")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Sans réglage, les notes s'ouvrent dans le lecteur intégré. Avec une application, la note est exportée vers Documents\\Vaultly\\Notes à chaque ouverture — les modifications externes ne reviennent pas dans Vaultly.",
            )}
          </p>
        </div>
        <div className="grid gap-1.5">
          <OpenerOption
            active={!openPrefs?.noteAppPath}
            onClick={() =>
              void applyOpenPrefs(openPrefs?.browserPath ?? "", "")
            }
            title={t("settings.vaultly-builtin")}
          />
          {(openers?.noteApps ?? []).map((b) => (
            <OpenerOption
              key={b.id}
              active={openPrefs?.noteAppPath === b.path}
              onClick={() =>
                void applyOpenPrefs(openPrefs?.browserPath ?? "", b.path)
              }
              title={b.name}
              subtitle={b.path}
            />
          ))}
          {openPrefs?.noteAppPath &&
            !(openers?.noteApps ?? []).some(
              (b) => b.path === openPrefs.noteAppPath,
            ) && (
              <OpenerOption
                active
                onClick={() =>
                  void applyOpenPrefs(
                    openPrefs?.browserPath ?? "",
                    openPrefs.noteAppPath,
                  )
                }
                title={exeBase(openPrefs.noteAppPath)}
                subtitle={openPrefs.noteAppPath}
              />
            )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={openBusy}
          onClick={() => void pickCustomOpener("note")}
        >
          <FileInput />
          {t("Choisir un exécutable…")}
        </Button>
      </div>
    </>
  );
}

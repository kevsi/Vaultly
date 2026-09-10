import { openUrl } from "@tauri-apps/plugin-opener";
import { Archive, ExternalLink, Link2Off, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { checkDeadLinks, type DeadLink, waybackAvailable } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { suppressClipboardCapture } from "@/lib/useClipboardCapture";
import { describeError } from "@/lib/utils";

export function LinksSection() {
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);
  const [deadLinks, setDeadLinks] = useState<DeadLink[] | null>(null);
  const [waybackBusy, setWaybackBusy] = useState<number | null>(null);

  async function runDeadLinkCheck() {
    setChecking(true);
    setDeadLinks(null);
    try {
      const dead = await checkDeadLinks();
      setDeadLinks(dead);
      // la pastille de l'onglet Réglages suit la vérification manuelle
      localStorage.setItem(
        "vaultly-deadlinks",
        JSON.stringify({ at: Date.now(), count: dead.length }),
      );
      window.dispatchEvent(new CustomEvent("vaultly:deadlinks-changed"));
      toast.success(
        dead.length === 0
          ? t("settings.all-links-alive")
          : t("settings.dead-links-found", { count: dead.length }),
      );
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setChecking(false);
    }
  }

  /** Cherche une capture archive.org du lien mort : trouvée → lien copié ;
   *  absente → ouvre la demande de sauvegarde (web.archive.org/save/…). */
  async function runWayback(d: DeadLink) {
    setWaybackBusy(d.id);
    try {
      const snap = await waybackAvailable(d.url);
      if (snap) {
        await navigator.clipboard.writeText(snap.url).catch(() => {});
        suppressClipboardCapture(snap.url);
        const ts = snap.timestamp;
        const when =
          ts.length >= 8
            ? ` (${ts.slice(6, 8)}/${ts.slice(4, 6)}/${ts.slice(0, 4)})`
            : "";
        toast.success(t("settings.archive-found", { when }));
      } else {
        toast.info(t("settings.no-archive"));
        // web.archive.org/save/<url> accepte l'URL telle quelle (le chemin
        // complet fait partie de l'endpoint — pas d'encodage ici)
        void openUrl(`https://web.archive.org/save/${d.url}`).catch(() => {});
      }
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setWaybackBusy(null);
    }
  }

  return (
    <>
      {/* liens morts */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("settings.dead-links")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Vérifie que chaque lien web de ta bibliothèque répond encore (404, 5xx, erreur réseau). Ça peut prendre quelques secondes.",
            )}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void runDeadLinkCheck()}
          disabled={checking}
        >
          {checking ? <Loader2 className="animate-spin" /> : <Link2Off />}
          {t("settings.check-links")}
        </Button>
        {deadLinks && deadLinks.length > 0 && (
          <div className="max-h-56 overflow-y-auto rounded-xl border p-2">
            {deadLinks.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              >
                <Link2Off className="size-4 shrink-0 text-destructive" />
                <button
                  type="button"
                  // ouverture via le plugin opener (comme partout ailleurs),
                  // jamais par un <a href> qui naviguerait dans le WebView
                  onClick={() =>
                    void openUrl(d.url).catch((e) =>
                      toast.error(describeError(e)),
                    )
                  }
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 truncate text-left"
                  title={d.url}
                >
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <span className="shrink-0 text-xs text-destructive">
                    {d.reason}
                  </span>
                  <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
                {/* Wayback : retrouver une capture du lien mort, ou en demander une */}
                <button
                  type="button"
                  onClick={() => void runWayback(d)}
                  disabled={waybackBusy === d.id}
                  title={t("settings.wayback-tooltip")}
                  className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {waybackBusy === d.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Archive className="size-3.5" />
                  )}
                  {t("settings.archive")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { openResourceById, recordOpen } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Resource } from "@/lib/types";
import { describeError } from "@/lib/utils";
import { videoEmbedUrl } from "@/lib/videoEmbed";

interface Props {
  /** vidéo choisie ; null = fermé (iframe démontée, lecture stoppée) */
  resource: Resource | null;
  onClose: () => void;
}

/** Autoplay à la demande « Lire dans l'app » (paramètres par lecteur). */
function withAutoplay(embed: string): string {
  try {
    const u = new URL(embed);
    if (u.hostname.includes("youtube-nocookie")) {
      u.searchParams.set("autoplay", "1");
    } else if (
      u.hostname === "player.vimeo.com" ||
      u.hostname === "www.dailymotion.com"
    ) {
      u.searchParams.set("autoplay", "1");
    } else if (
      u.hostname === "player.twitch.tv" ||
      u.hostname === "clips.twitch.tv"
    ) {
      u.searchParams.set("autoplay", "true");
    }
    return u.toString();
  } catch {
    return embed;
  }
}

/**
 * Choix d'ouverture d'une vidéo : lire dans l'app (lecteur embarqué) ou
 * ouvrir dans le navigateur. La partie « lecture » démonte l'iframe à la
 * fermeture (son coupé). L'ouverture n'est comptabilisée qu'UNE fois le
 * choix fait (aucune ouverture passive ne gonfle le compteur).
 */
export function VideoViewer({ resource, onClose }: Props) {
  const { t } = useI18n();
  const [playing, setPlaying] = useState(false);
  const embed = resource ? videoEmbedUrl(resource.url) : null;

  // nouvelle vidéo demandée → on repart du choix (pas de reprise de lecture)
  useEffect(() => {
    setPlaying(false);
  }, []);

  function playInApp() {
    if (!resource) return;
    setPlaying(true);
    void recordOpen(resource.id).catch((e) => toast.error(describeError(e)));
  }

  function openInBrowser() {
    if (!resource) return;
    // passe par la commande standard : comptabilise + ouvre le navigateur
    void openResourceById(resource.id).catch((e) =>
      toast.error(describeError(e)),
    );
    onClose();
  }

  return (
    <Dialog
      open={!!resource && !!embed}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className={
          resource && embed && playing
            ? "w-[min(94vw,1400px)] sm:max-w-[94vw]"
            : "sm:max-w-md"
        }
      >
        {/* min-w-0 : sans lui, un titre long fait déborder la grille du
            dialog (min-width:auto) et le truncate ne s'active jamais */}
        <DialogHeader className="min-w-0">
          <DialogTitle className="min-w-0 truncate pr-10">
            {resource?.title}
          </DialogTitle>
        </DialogHeader>
        {resource && embed && playing ? (
          <>
            {/* 16/9 le plus grand possible : plafonné par la largeur (94vw)
                ET par la hauteur de la fenêtre (l'aspect suit le cap height) */}
            <div
              className="mx-auto aspect-video w-full overflow-hidden rounded-xl border bg-black"
              style={{ maxWidth: "calc((100vh - 180px) * 16 / 9)" }}
            >
              {/* démonté à la fermeture : stoppe la lecture et libère le son */}
              <iframe
                key={resource.id}
                src={withAutoplay(embed)}
                title={resource.title}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                className="size-full border-0"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void openUrl(resource.url).catch((e) =>
                    toast.error(describeError(e)),
                  )
                }
              >
                <ExternalLink />
                {t("Ouvrir dans le navigateur")}
              </Button>
            </div>
          </>
        ) : (
          resource && (
            <div className="flex justify-center gap-2 py-1">
              <Button size="sm" onClick={playInApp}>
                <Play />
                {t("Lire dans l'app")}
              </Button>
              <Button size="sm" variant="outline" onClick={openInBrowser}>
                <ExternalLink />
                {t("Ouvrir dans le navigateur")}
              </Button>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

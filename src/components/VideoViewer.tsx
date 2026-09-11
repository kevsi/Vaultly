import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import type { Resource } from "@/lib/types";
import { describeError } from "@/lib/utils";
import { videoEmbedUrl } from "@/lib/videoEmbed";

interface Props {
  /** vidéo à prévisualiser ; null = fermé (iframe démontée, lecture stoppée) */
  resource: Resource | null;
  onClose: () => void;
}

/** Aperçu vidéo in-app : lecteur embarqué de la plateforme (YouTube, TikTok,
 *  Vimeo, Dailymotion, Twitch), échappement vers le navigateur en secours. */
export function VideoViewer({ resource, onClose }: Props) {
  const { t } = useI18n();
  const embed = resource ? videoEmbedUrl(resource.url) : null;
  return (
    <Dialog
      open={!!resource && !!embed}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-10">
            {resource?.title}
          </DialogTitle>
        </DialogHeader>
        {resource && embed && (
          <>
            <div className="aspect-video w-full overflow-hidden rounded-xl border bg-black">
              {/* démonté à la fermeture : stoppe la lecture et libère le son */}
              <iframe
                key={resource.id}
                src={embed}
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
        )}
      </DialogContent>
    </Dialog>
  );
}

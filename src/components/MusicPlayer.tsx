import {
  Download,
  ListMusic,
  Loader2,
  Music2,
  Pause,
  Play,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  audioEngineInstall,
  audioEngineInstalled,
  audioResolve,
  sniffResource,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { hostOf } from "@/lib/resources";
import { cn, describeError } from "@/lib/utils";
import { videoEmbedUrl } from "@/lib/videoEmbed";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

interface Track {
  url: string;
  title: string;
  cover: string;
}

/** autoplay selon le lecteur embarqué (best-effat : sans geste utilisateur,
 *  certains ignorent le paramètre — l'utilisateur a déjà cliqué « Lancer ») */
function withEmbedAutoplay(embed: string): string {
  try {
    const u = new URL(embed);
    const h = u.hostname;
    if (h.includes("youtube-nocookie")) {
      u.searchParams.set("enablejsapi", "1");
      u.searchParams.set("autoplay", "1");
    } else if (h.includes("vimeo") || h.includes("dailymotion")) {
      u.searchParams.set("autoplay", "1");
    } else if (h.includes("twitch")) {
      u.searchParams.set("autoplay", "true");
    }
    return u.toString();
  } catch {
    return embed;
  }
}

/**
 * Lecteur « Musique » : n'importe quel lien vidéo devient un morceau.
 * 1. Moteur audio installé (yt-dlp sidecar, optionnel) → flux AUDIO pur dans
 *    un élément <audio> : vrais contrôles, fond opaque, rien d'autre ne joue.
 * 2. Sinon, lecteur web de la plateforme monté HORS ÉCRAN : on n'entend que
 *    le son ; pause/lecture via postMessage (YouTube/Vimeo/Dailymotion).
 * La fenêtre minimisée ou masquée dans le tray garde la lecture (WebView2).
 */
export function MusicPlayer({ open, onOpenChange }: Props) {
  const { t } = useI18n();
  const [track, setTrack] = useState<Track | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"audio" | "embed" | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [embedUrl, setEmbedUrl] = useState("");
  const [playing, setPlaying] = useState(true);
  const [engine, setEngine] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  async function play(url: string, title?: string, cover?: string) {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      toast.error(t("Le lien doit commencer par http:// ou https://"));
      return;
    }
    setBusy(true);
    try {
      let shownTitle = title ?? "";
      let shownCover = cover ?? "";
      if (!shownTitle) {
        try {
          const s = await sniffResource(trimmed);
          shownTitle = s.title;
          shownCover = shownCover || s.image;
        } catch {
          /* hors-ligne : on affichera l'hôte */
        }
      }
      let hasEngine = false;
      try {
        hasEngine = await audioEngineInstalled();
      } catch {
        /* commande absente (vieille build) : treated as absent */
      }
      setEngine(hasEngine);
      if (hasEngine) {
        try {
          const stream = await audioResolve(trimmed);
          setAudioUrl(stream);
          setMode("audio");
          setPlaying(true);
          setTrack({
            url: trimmed,
            title: shownTitle || hostOf(trimmed) || trimmed,
            cover: shownCover,
          });
          return;
        } catch (e) {
          toast.warning(
            t("Extraction audio impossible — lecture via le lecteur web."),
            {
              description: describeError(e),
            },
          );
        }
      }
      const embed = videoEmbedUrl(trimmed);
      if (!embed) {
        toast.error(t("Aucun lecteur connu pour ce lien."));
        return;
      }
      setEmbedUrl(withEmbedAutoplay(embed));
      setMode("embed");
      setPlaying(true);
      setTrack({
        url: trimmed,
        title: shownTitle || hostOf(trimmed) || trimmed,
        cover: shownCover,
      });
    } finally {
      setBusy(false);
    }
  }

  // « Écouter » depuis les tuiles vidéo (événement porté par le Resource) :
  // play() lu via une ref pour que le listener ne se redéroule pas à chaque render
  const playRef = useRef(play);
  playRef.current = play;
  useEffect(() => {
    const onEvent = (e: Event) => {
      const r = (
        e as CustomEvent<{ url?: string; title?: string; favicon?: string }>
      ).detail;
      if (!r?.url) return;
      onOpenChange(true);
      void playRef.current(r.url, r.title, r.favicon);
    };
    window.addEventListener("vaultly:play-as-music", onEvent);
    return () => window.removeEventListener("vaultly:play-as-music", onEvent);
  }, [onOpenChange]);

  // statut du moteur à l'ouverture du panneau
  useEffect(() => {
    if (open)
      void audioEngineInstalled()
        .then(setEngine)
        .catch(() => setEngine(false));
  }, [open]);

  function stop() {
    setTrack(null);
    setMode(null);
    setAudioUrl("");
    setEmbedUrl("");
    setPlaying(true);
  }

  function toggle() {
    if (mode === "audio" && audioRef.current) {
      if (playing) audioRef.current.pause();
      else void audioRef.current.play();
      setPlaying(!playing);
      return;
    }
    if (mode === "embed" && iframeRef.current?.contentWindow) {
      const w = iframeRef.current.contentWindow;
      try {
        if (embedUrl.includes("youtube-nocookie")) {
          w?.postMessage(
            JSON.stringify({
              event: "command",
              func: playing ? "pauseVideo" : "playVideo",
              args: [],
            }),
            "*",
          );
        } else if (embedUrl.includes("player.vimeo.com")) {
          w?.postMessage(
            JSON.stringify({ method: playing ? "pause" : "play" }),
            "*",
          );
        } else if (embedUrl.includes("dailymotion")) {
          w?.postMessage(
            JSON.stringify({ command: playing ? "pause" : "play" }),
            "*",
          );
        }
        setPlaying(!playing);
      } catch {
        toast.info(
          t(
            "Ce lecteur web ne répond pas aux commandes — utilise ses propres contrôles en lecture affichée.",
          ),
        );
      }
    }
  }

  const canToggle =
    mode === "audio" ||
    (mode === "embed" &&
      /youtube-nocookie|player\.vimeo|dailymotion/.test(embedUrl));

  async function install() {
    setInstalling(true);
    try {
      const v = await audioEngineInstall();
      setEngine(true);
      toast.success(
        `${t("Moteur audio installé — les liens vidéo ne livreront plus que le son.")} (${v})`,
      );
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setInstalling(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed bottom-4 left-4 z-40 w-[360px] max-w-[calc(100vw-2rem)] animate-pop-in space-y-2 rounded-2xl border bg-popover p-3 text-popover-foreground shadow-2xl">
      <div className="flex items-center gap-2">
        <Music2 className="size-4 text-primary" />
        <span className="text-sm font-semibold">{t("Musique")}</span>
        <span className="grow" />
        {track && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={stop}
            title={t("Nouveau lien")}
          >
            <ListMusic />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onOpenChange(false)}
          title={t("Fermer")}
        >
          <X />
        </Button>
      </div>

      {track ? (
        <>
          <div className="flex items-center gap-2.5">
            {track.cover ? (
              <img
                src={track.cover}
                alt=""
                className="size-11 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Music2 className="size-4 text-muted-foreground" />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{track.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {hostOf(track.url)} ·{" "}
                {mode === "audio" ? t("son pur") : t("lecteur web (son seul)")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {canToggle && (
              <Button
                variant="outline"
                size="icon-sm"
                onClick={toggle}
                title={playing ? t("Pause") : t("Lecture")}
              >
                {playing ? <Pause /> : <Play />}
              </Button>
            )}
            <Button
              variant="outline"
              size="icon-sm"
              onClick={stop}
              title={t("Arrêter")}
            >
              <Square />
            </Button>
            {mode === "audio" && (
              <input
                type="range"
                min={0}
                max={100}
                defaultValue={80}
                aria-label={t("Volume")}
                className="ml-1 w-24 accent-primary"
                onChange={(e) => {
                  if (audioRef.current)
                    audioRef.current.volume = Number(e.target.value) / 100;
                }}
              />
            )}
          </div>
          {mode === "audio" && (
            // biome-ignore lint/a11y/useMediaCaption: flux audio de plateforme vidéo, aucune piste de sous-titres n'existe
            <audio
              ref={audioRef}
              src={audioUrl}
              autoPlay
              onError={() => {
                // un flux expiré (les URL sont temporaires) → on nettoie
                toast.error(t("Le flux audio a expiré — relance le lien."));
                stop();
              }}
              onEnded={stop}
            />
          )}
          {mode === "embed" && (
            <iframe
              ref={iframeRef}
              src={embedUrl}
              title={track.title}
              aria-hidden="true"
              tabIndex={-1}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="pointer-events-none absolute size-px opacity-0"
            />
          )}
        </>
      ) : (
        <>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void play(input);
              setInput("");
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("Coller un lien vidéo (YouTube, TikTok…)")}
              disabled={busy}
              className="h-8 text-sm"
            />
            <Button type="submit" size="sm" disabled={busy || !input.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Play />}
              {t("Lancer")}
            </Button>
          </form>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {engine === null ? (
              <span>…</span>
            ) : engine ? (
              <span className={cn("text-emerald-500")}>
                ✓ {t("Moteur audio installé")}
              </span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void install()}
                disabled={installing}
              >
                {installing ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Download />
                )}
                {t("Installer le moteur audio")}
              </Button>
            )}
          </div>
          {engine === false && (
            <p className="text-xs text-muted-foreground">
              {t(
                "Sans le moteur, la vidéo tourne masquée (son seul) ; avec, tu obtiens un vrai flux audio.",
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}

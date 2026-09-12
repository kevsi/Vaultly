import {
  ChevronUp,
  ListMusic,
  Music2,
  Pause,
  Play,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { audioEngineInstalled, audioResolve } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  advance,
  previous,
  setPlaying,
  stop,
  toggleShuffle,
  usePlayer,
} from "@/lib/playerStore";
import { hostOf } from "@/lib/resources";
import { cn, describeError } from "@/lib/utils";
import { videoEmbedUrl } from "@/lib/videoEmbed";

/** autoplay selon le lecteur embarqué (best-effort : sans geste utilisateur,
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

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

/**
 * Barre lecteur Musique globale : pilotée par le store de file
 * (playerStore.ts), donc la vue Musique, le menu ⋯ des tuiles et cette
 * barre sont toujours synchronisés. Moteur yt-dlp dispo → vrai flux audio
 * (seek/volume/next) ; sinon lecteur web masqué (next sur YouTube via
 * onStateChange, contrôles basiques ailleurs). La lecture continue quand
 * la fenêtre est masquée dans le tray (WebView2).
 */
export function MusicPlayer({ open, onOpenChange }: Props) {
  const { t } = useI18n();
  const player = usePlayer();
  const [mode, setMode] = useState<"audio" | "embed" | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [embedUrl, setEmbedUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const [pos, setPos] = useState({ cur: 0, dur: 0 });
  const audioRef = useRef<HTMLAudioElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const track = player.track;
  const trackUrl = track?.url ?? "";

  // — résolution par piste : moteur (audio pur) sinon web player masqué —
  useEffect(() => {
    if (!trackUrl) {
      setMode(null);
      setAudioUrl("");
      setEmbedUrl("");
      setPos({ cur: 0, dur: 0 });
      return;
    }
    let cancel = false;
    setResolving(true);
    void (async () => {
      let hasEngine = false;
      try {
        hasEngine = await audioEngineInstalled();
      } catch {
        /* treated as absent */
      }
      if (hasEngine && !cancel) {
        try {
          const stream = await audioResolve(trackUrl);
          if (cancel) return;
          setAudioUrl(stream);
          setMode("audio");
          setResolving(false);
          return;
        } catch (e) {
          if (!cancel)
            toast.warning(
              t("Extraction audio impossible — lecture via le lecteur web."),
              { description: describeError(e) },
            );
        }
      }
      if (cancel) return;
      const embed = videoEmbedUrl(trackUrl);
      if (embed) {
        setEmbedUrl(withEmbedAutoplay(embed));
        setMode("embed");
      } else {
        toast.error(t("Aucun lecteur connu pour ce lien."));
        stop();
      }
      setResolving(false);
    })();
    return () => {
      cancel = true;
    };
  }, [trackUrl, t]);

  // — play/pause piloté par le store (audio : élément natif) —
  useEffect(() => {
    if (mode !== "audio" || !audioRef.current) return;
    if (player.playing) void audioRef.current.play().catch(() => {});
    else audioRef.current.pause();
  }, [mode, player.playing]);

  // — fin de piste YouTube (onStateChange 0) → piste suivante —
  useEffect(() => {
    if (mode !== "embed" || !embedUrl.includes("youtube-nocookie")) return;
    const onMsg = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      try {
        const d = JSON.parse(e.data);
        if (d?.event === "onStateChange" && d?.info?.playerState === 0)
          advance();
      } catch {
        /* message non JSON d'un autre iframe : ignorer */
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [mode, embedUrl]);

  function toggle() {
    setPlaying(!player.playing);
  }

  const canRemoteControl =
    mode === "audio" ||
    (mode === "embed" &&
      /youtube-nocookie|player\.vimeo|dailymotion/.test(embedUrl));

  function stopAll() {
    stop();
  }

  // — mini-barre quand une piste joue mais le panneau est fermé —
  if (!open && track) {
    return (
      <div className="fixed bottom-4 left-4 z-40 flex max-w-[420px] items-center gap-2 rounded-2xl border bg-popover p-2 pl-2.5 text-popover-foreground shadow-2xl">
        {track.cover ? (
          <img
            src={track.cover}
            alt=""
            className="size-9 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Music2 className="size-4 text-muted-foreground" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{track.title}</p>
          {player.source && (
            <p className="truncate text-[11px] text-muted-foreground">
              {player.source}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={previous}
          disabled={player.index <= 0}
          title={t("Piste précédente")}
        >
          <SkipBack />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggle}
          title={player.playing ? t("Pause") : t("Lecture")}
        >
          {player.playing ? <Pause /> : <Play />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => advance()}
          disabled={player.index >= player.queue.length - 1}
          title={t("Piste suivante")}
        >
          <SkipForward />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onOpenChange(true)}
          title={t("Ouvrir le lecteur")}
        >
          <ChevronUp />
        </Button>
      </div>
    );
  }
  if (!open) return null;

  return (
    <div className="fixed bottom-4 left-4 z-40 w-[380px] max-w-[calc(100vw-2rem)] animate-pop-in space-y-2.5 rounded-2xl border bg-popover p-3.5 text-popover-foreground shadow-2xl">
      <div className="flex items-center gap-2">
        <Music2 className="size-4 text-primary" />
        <span className="text-sm font-semibold">{t("Musique")}</span>
        <span className="grow" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onOpenChange(false)}
          title={t("Réduire")}
        >
          <X />
        </Button>
      </div>

      {track ? (
        <>
          {/* « en ce moment » */}
          <div className="flex items-center gap-3">
            {track.cover ? (
              <img
                src={track.cover}
                alt=""
                className="size-14 shrink-0 rounded-xl object-cover shadow-md"
              />
            ) : (
              <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-muted">
                <Music2 className="size-5 text-muted-foreground" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{track.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {player.source ? `${player.source} · ` : ""}
                {hostOf(track.url)}
                {resolving && " · …"}
                {!resolving && mode === "audio" && ` · ${t("son pur")}`}
                {!resolving && mode === "embed" && ` · ${t("lecteur web")}`}
              </p>
            </div>
          </div>

          {/* progression (audio natif uniquement) */}
          {mode === "audio" && pos.dur > 0 && (
            <div className="flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
              <span>{fmtTime(pos.cur)}</span>
              <input
                type="range"
                min={0}
                max={pos.dur}
                value={pos.cur}
                aria-label={t("Progression")}
                className="h-1 flex-1 accent-primary"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (audioRef.current) audioRef.current.currentTime = v;
                  setPos((p) => ({ ...p, cur: v }));
                }}
              />
              <span>{fmtTime(pos.dur)}</span>
            </div>
          )}

          {/* contrôles de file */}
          <div className="flex items-center justify-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleShuffle}
              title={t("Lecture aléatoire")}
              className={cn(player.shuffle && "bg-primary/10 text-primary")}
            >
              <Shuffle />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={previous}
              disabled={player.index <= 0}
              title={t("Piste précédente")}
            >
              <SkipBack />
            </Button>
            <Button
              size="icon"
              className="size-10 rounded-full"
              onClick={toggle}
              disabled={!canRemoteControl}
              title={player.playing ? t("Pause") : t("Lecture")}
            >
              {player.playing ? <Pause /> : <Play />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => advance()}
              disabled={player.index >= player.queue.length - 1}
              title={t("Piste suivante")}
            >
              <SkipForward />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={stopAll}
              title={t("Arrêter")}
            >
              <Square />
            </Button>
          </div>

          {/* volume (audio natif) */}
          {mode === "audio" && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {t("Volume")}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                defaultValue={80}
                aria-label={t("Volume")}
                className="h-1 flex-1 accent-primary"
                onChange={(e) => {
                  if (audioRef.current)
                    audioRef.current.volume = Number(e.target.value) / 100;
                }}
              />
            </div>
          )}

          {mode === "embed" && !canRemoteControl && (
            <p className="text-[11px] text-muted-foreground">
              {t(
                "Ce lecteur web ne se pilote pas à distance — utilise ses propres contrôles.",
              )}
            </p>
          )}
          {player.queue.length > 1 && (
            <p className="text-center text-[11px] text-muted-foreground tabular-nums">
              {player.index + 1} / {player.queue.length}
            </p>
          )}

          {mode === "audio" && (
            // biome-ignore lint/a11y/useMediaCaption: flux audio de plateforme vidéo, aucune piste de sous-titres n'existe
            <audio
              key={audioUrl}
              ref={audioRef}
              src={audioUrl}
              onPlay={() => setPlaying(true)}
              onPause={() => {
                // « advance() » enchaîne sans pause : ne pas éteindre la
                // volonté de lecture sur les micro-pauses du décodage
                if (!audioRef.current?.ended) setPlaying(false);
              }}
              onTimeUpdate={(e) =>
                setPos({
                  cur: e.currentTarget.currentTime,
                  dur: e.currentTarget.duration || 0,
                })
              }
              onLoadedMetadata={(e) =>
                setPos((p) => ({
                  ...p,
                  dur: e.currentTarget.duration || 0,
                }))
              }
              onEnded={() => {
                if (!advance()) setPlaying(false);
              }}
              onError={() => {
                // un flux expiré (les URL sont temporaires) → piste suivante
                toast.error(t("Le flux audio a expiré — piste suivante."));
                if (!advance()) stop();
              }}
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
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <ListMusic className="size-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {t("Choisis une vidéo ou une playlist dans l'onglet Musique.")}
          </p>
        </div>
      )}
    </div>
  );
}

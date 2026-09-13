import {
  ChevronUp,
  ListMusic,
  Minus,
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
    } else if (h.includes("vimeo")) {
      u.searchParams.set("autoplay", "1");
      // la Player API rejette les messages postMessage sans cette origine
      u.searchParams.set("origin", window.location.origin);
    } else if (h.includes("dailymotion")) {
      u.searchParams.set("autoplay", "1");
      // nécessaire pour recevoir/émettre les commandes play/pause
      u.searchParams.set("api", "postMessage");
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

const VOLUME_KEY = "vaultly-music-volume";
const DEFAULT_VOLUME = 0.8;

function initialVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const n = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

/** Les flux audio/live peuvent annoncer Infinity ; un <input max> infini
 *  casse le seek : on le traite comme une durée inconnue. */
function boundedDuration(seconds: number): number {
  return Number.isFinite(seconds) ? seconds : 0;
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
  const [miniCollapsed, setMiniCollapsed] = useState(false);
  const [volume, setVolume] = useState(initialVolume);
  const audioRef = useRef<HTMLAudioElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const embedReadyRef = useRef(false);
  const track = player.track;
  const trackUrl = track?.url ?? "";
  // t lu via ref : la fonction de traduction change d'identité à chaque
  // render, la mettre dans les deps relancerait la résolution en boucle
  const tRef = useRef(t);
  tRef.current = t;

  function isCurrentAudio(
    target: EventTarget | null,
  ): target is HTMLAudioElement {
    // `key={audioUrl}` remonte un <audio> par piste : l'identité du nœud
    // suffit à ignorer les événements différés de l'ancien élément.
    return target instanceof HTMLAudioElement && target === audioRef.current;
  }

  useEffect(() => {
    if (!player.track) setMiniCollapsed(false);
  }, [player.track]);

  // — résolution par piste : moteur (audio pur) sinon web player masqué —
  useEffect(() => {
    if (!trackUrl) {
      // mises à jour guarded (bail si déjà vides) : sans ça, l'objet neuf de
      // setPos re-déclenche un render à chaque passe et alimente la boucle
      setMode((m) => (m === null ? m : null));
      setAudioUrl((a) => (a === "" ? a : ""));
      setEmbedUrl((e) => (e === "" ? e : ""));
      embedReadyRef.current = false;
      setResolving((r) => (r ? false : r));
      setPos((p) => (p.cur === 0 && p.dur === 0 ? p : { cur: 0, dur: 0 }));
      return;
    }
    let cancel = false;
    setResolving(true);
    // stoppe l'ancienne piste tout de suite : sinon elle joue en fond le
    // temps que le nouveau flux se résolve (parfois plusieurs secondes)
    setMode(null);
    setAudioUrl("");
    setEmbedUrl("");
    embedReadyRef.current = false;
    setPos((p) => (p.cur === 0 && p.dur === 0 ? p : { cur: 0, dur: 0 }));
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
              tRef.current(
                "Extraction audio impossible — lecture via le lecteur web.",
              ),
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
        toast.error(tRef.current("Aucun lecteur connu pour ce lien."));
        stop();
      }
      setResolving(false);
    })();
    return () => {
      cancel = true;
    };
  }, [trackUrl]);

  // — play/pause piloté par le store (audio : élément natif) —
  // audioUrl en deps : au changement de piste le <audio> remonte et doit
  // être relancé explicitement (l'autoplay navigateur n'est pas garanti)
  // biome-ignore lint/correctness/useExhaustiveDependencies: audioUrl relance la lecture quand une nouvelle URL arrive
  useEffect(() => {
    if (mode !== "audio" || !audioRef.current) return;
    if (player.playing) {
      void audioRef.current.play().catch(() => {
        // autoplay refusé (politique navigateur, sortie audio) : on ne laisse
        // pas une UI « Pause » sur un silence
        setPlaying(false);
        toast.error(tRef.current("Lecture impossible — réessaie."));
      });
    } else audioRef.current.pause();
  }, [mode, player.playing, audioUrl]);

  // — fin de piste YouTube (onStateChange 0) → piste suivante —
  // l'origine ET la source sont vérifiées : n'importe quel iframe de la page
  // (lecteur vidéo, TikTok…) pourrait sinon faire sauter la file
  useEffect(() => {
    if (mode !== "embed" || !embedUrl.includes("youtube-nocookie")) return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== "https://www.youtube-nocookie.com") return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (typeof e.data !== "string") return;
      try {
        const d = JSON.parse(e.data);
        if (d?.event === "onStateChange" && d?.info?.playerState === 0)
          advance();
      } catch {
        /* message non JSON : ignorer */
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [mode, embedUrl]);

  /** Commande réelle vers le lecteur web (best-effort : domaines connus). */
  function sendEmbedCommand(cmd: "play" | "pause") {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    try {
      if (embedUrl.includes("youtube-nocookie")) {
        w.postMessage(
          JSON.stringify({
            event: "command",
            func: cmd === "pause" ? "pauseVideo" : "playVideo",
            args: [],
          }),
          "https://www.youtube-nocookie.com",
        );
      } else if (embedUrl.includes("player.vimeo.com")) {
        w.postMessage(JSON.stringify({ method: cmd }), "*");
      } else if (embedUrl.includes("dailymotion")) {
        w.postMessage(JSON.stringify({ command: cmd }), "*");
      }
    } catch {
      /* lecteur démonté entre-temps : ignorer */
    }
  }

  const canRemoteControl =
    mode === "audio" ||
    (mode === "embed" &&
      /youtube-nocookie|player\.vimeo|dailymotion/.test(embedUrl));

  /** Passe à la suivante avec arrêt propre si la file est épuisée (utile en
   *  shuffle sur une file à 1 piste, où advance() échoue). */
  function goNext() {
    if (!advance()) setPlaying(false);
  }

  function toggle() {
    setPlaying(!player.playing);
  }

  function changeVolume(value: number) {
    const next = Math.min(1, Math.max(0, value));
    setVolume(next);
    try {
      localStorage.setItem(VOLUME_KEY, String(next));
    } catch {
      /* stockage indisponible : la session garde quand même le réglage */
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: audioUrl remonte l'élément, il faut réappliquer le volume
  useEffect(() => {
    if (mode === "audio" && audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [mode, audioUrl, volume]);

  // — play/pause pour les lecteurs web contrôlables —
  // Toute la logique passe par le store : sans cet effet, MusicView/mini-barre
  // pouvaient afficher « Pause » alors que l'iframe continuait à jouer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sendEmbedCommand lit embedUrl, déjà en dependency
  useEffect(() => {
    if (mode !== "embed" || !canRemoteControl || !embedReadyRef.current) return;
    sendEmbedCommand(player.playing ? "play" : "pause");
  }, [mode, embedUrl, player.playing, canRemoteControl]);

  function stopAll() {
    stop();
  }

  /** Médias hors conditionnels d'ouverture : le son DOIT exister même quand
   *  le panneau est fermé (mini-barre) et se remonter à chaque URL (sinon la
   *  piste suivante monte en silence dès que le panneau est réduit). */
  const media = (
    <>
      {mode === "audio" && (
        // biome-ignore lint/a11y/useMediaCaption: flux audio de plateforme vidéo, aucune piste de sous-titres n'existe
        <audio
          key={audioUrl}
          ref={audioRef}
          src={audioUrl}
          autoPlay={player.playing}
          onPlay={(e) => {
            if (!isCurrentAudio(e.target)) return;
            setPlaying(true);
          }}
          onPause={(e) => {
            const el = e.target;
            // un événement reçu par l'ancien élément pendant un changement
            // de piste ne doit jamais éteindre la lecture de la nouvelle
            if (!isCurrentAudio(el) || el.ended) return;
            setPlaying(false);
          }}
          onTimeUpdate={(e) => {
            const el = e.target;
            if (!isCurrentAudio(el)) return;
            setPos({
              cur: el.currentTime,
              dur: boundedDuration(el.duration),
            });
          }}
          onLoadedMetadata={(e) => {
            const el = e.target;
            if (!isCurrentAudio(el)) return;
            setPos((p) => ({ ...p, dur: boundedDuration(el.duration) }));
          }}
          onEnded={(e) => {
            if (!isCurrentAudio(e.target)) return;
            if (!advance()) setPlaying(false);
          }}
          onError={(e) => {
            // un flux expiré (les URL sont temporaires) → piste suivante
            if (!isCurrentAudio(e.target)) return;
            toast.error(t("Le flux audio a expiré — piste suivante."));
            if (!advance()) setPlaying(false);
          }}
        />
      )}
      {mode === "embed" && (
        <iframe
          ref={iframeRef}
          src={embedUrl}
          title={track?.title ?? t("Musique")}
          aria-hidden="true"
          tabIndex={-1}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          onLoad={() => {
            // l'URL de l'iframe est résolue après le clic : le paramètre
            // autoplay est parfois ignoré, on aligne le lecteur une fois prêt
            embedReadyRef.current = true;
            if (canRemoteControl)
              sendEmbedCommand(player.playing ? "play" : "pause");
          }}
          className="pointer-events-none absolute size-px opacity-0"
        />
      )}
    </>
  );

  // — mini-barre quand une piste joue mais le panneau est fermé —
  // Le <audio> est toujours en premier enfant : changer seulement l'habillage
  // réduit/étendu ne doit pas remonter le média et relancer la piste.
  if (!open && track) {
    return (
      <>
        {media}
        <div
          className={cn(
            "fixed bottom-4 left-4 z-40 flex max-w-[420px] items-center gap-2 rounded-2xl border bg-popover p-2 pl-2.5 text-popover-foreground shadow-2xl",
            miniCollapsed && "hidden",
          )}
        >
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
            <p className="truncate text-[11px] text-muted-foreground">
              {player.source}
              {resolving && " · …"}
              {!resolving &&
                canRemoteControl &&
                ` · ${t(player.playing ? "Pause" : "Lecture")}`}
              {!resolving &&
                !canRemoteControl &&
                ` · ${t("Ce lecteur web ne se pilote pas à distance — utilise ses propres contrôles.")}`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={previous}
            disabled={resolving || player.index <= 0}
            title={t("Piste précédente")}
            aria-label={t("Piste précédente")}
          >
            <SkipBack />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggle}
            disabled={resolving || !canRemoteControl}
            title={player.playing ? t("Pause") : t("Lecture")}
            aria-label={player.playing ? t("Pause") : t("Lecture")}
          >
            {player.playing ? <Pause /> : <Play />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={goNext}
            disabled={
              resolving ||
              (player.shuffle
                ? player.queue.length < 2
                : player.index >= player.queue.length - 1)
            }
            title={t("Piste suivante")}
            aria-label={t("Piste suivante")}
          >
            <SkipForward />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(true)}
            title={t("Ouvrir le lecteur")}
            aria-label={t("Ouvrir le lecteur")}
          >
            <ChevronUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMiniCollapsed(true)}
            title={t("Réduire en pastille")}
            aria-label={t("Réduire en pastille")}
          >
            <Minus />
          </Button>
        </div>
        {miniCollapsed && (
          <button
            type="button"
            onClick={() => setMiniCollapsed(false)}
            aria-label={t("Agrandir la barre de lecture")}
            title={track.title}
            className={cn(
              "fixed bottom-4 left-4 z-40 flex size-12 overflow-hidden rounded-full border bg-popover text-popover-foreground shadow-2xl transition-transform outline-none hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring/50",
              player.playing && "ring-2 ring-primary/70",
            )}
          >
            {track.cover ? (
              <img
                src={track.cover}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <Music2 className="m-auto size-5 text-muted-foreground" />
            )}
          </button>
        )}
      </>
    );
  }
  if (!open) return null;

  return (
    <>
      {media}
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
                disabled={resolving || player.index <= 0}
                title={t("Piste précédente")}
                aria-label={t("Piste précédente")}
              >
                <SkipBack />
              </Button>
              <Button
                size="icon"
                className="size-10 rounded-full"
                onClick={toggle}
                disabled={resolving || !canRemoteControl}
                title={player.playing ? t("Pause") : t("Lecture")}
                aria-label={player.playing ? t("Pause") : t("Lecture")}
              >
                {player.playing ? <Pause /> : <Play />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={goNext}
                disabled={
                  resolving ||
                  (player.shuffle
                    ? player.queue.length < 2
                    : player.index >= player.queue.length - 1)
                }
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
                  value={Math.round(volume * 100)}
                  aria-label={t("Volume")}
                  className="h-1 flex-1 accent-primary"
                  onChange={(e) => {
                    changeVolume(Number(e.target.value) / 100);
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
    </>
  );
}

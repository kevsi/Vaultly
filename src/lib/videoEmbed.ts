/**
 * URL d'intégration du lecteur officiel pour les liens vidéo connus
 * (aperçu in-app), ou null si la plateforme/le format n'est pas
 * embarquable — l'app appelle alors le navigateur.
 *
 * Les domains autorisés ici doivent être ajoutés au `frame-src` de la CSP
 * (src-tauri/tauri.conf.json) sous peine d'être bloqués par le WebView.
 */
export function videoEmbedUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const path = u.pathname;
  // ids d'assets : alphanumériques, assez longs pour éviter les faux positifs
  const okId = (v: string | null | undefined): v is string =>
    !!v && /^[\w-]{5,}$/.test(v);

  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com"
  ) {
    const vid =
      u.searchParams.get("v") ??
      /\/shorts\/([\w-]+)/.exec(path)?.[1] ??
      /\/live\/([\w-]+)/.exec(path)?.[1] ??
      /\/embed\/([\w-]+)/.exec(path)?.[1];
    if (!okId(vid)) return null;
    const list = u.searchParams.get("list");
    const qs = okId(list) ? `?list=${list}` : "";
    return `https://www.youtube-nocookie.com/embed/${vid}${qs}`;
  }
  if (host === "youtu.be") {
    const vid = path.slice(1).split("/")[0];
    return okId(vid) ? `https://www.youtube-nocookie.com/embed/${vid}` : null;
  }
  if (host === "tiktok.com") {
    const m = /\/video\/(\d+)/.exec(path);
    return m ? `https://www.tiktok.com/embed/v2/${m[1]}` : null;
  }
  if (host === "vimeo.com") {
    const m = /^\/(?:video\/)?(\d+)/.exec(path);
    return m ? `https://player.vimeo.com/video/${m[1]}` : null;
  }
  if (host === "dailymotion.com" || host === "dai.ly") {
    const m =
      /\/video\/([\w]+)/.exec(path) ??
      (host === "dai.ly" ? /^\/([\w]+)/.exec(path) : null);
    return m ? `https://www.dailymotion.com/embed/video/${m[1]}` : null;
  }
  if (host === "twitch.tv" || host === "m.twitch.tv") {
    // VOD seulement : les pages de chaîne live ne s'embarquent pas → navigateur
    const vid = /\/videos\/(\d+)/.exec(path)?.[1];
    return vid
      ? `https://player.twitch.tv/?video=${vid}&parent=tauri.localhost&parent=localhost`
      : null;
  }
  if (host === "clips.twitch.tv") {
    const slug = /^\/([\w]+)/.exec(path)?.[1];
    return slug
      ? `https://clips.twitch.tv/embed?clip=${slug}&parent=tauri.localhost&parent=localhost`
      : null;
  }
  return null;
}

const YOUTUBE_ORIGIN = "https://www.youtube-nocookie.com";
const VIMEO_ORIGIN = "https://player.vimeo.com";

/**
 * Autoplay « à la demande » (l'utilisateur vient de cliquer) : paramètres
 * par lecteur, avec les options d'API nécessaires aux commandes
 * play/pause (postMessage) — une seule source de vérité partagée par la
 * barre Musique et le visionneur vidéo.
 *
 * Best-effort : sans geste utilisateur, certains lecteurs ignorent
 * autoplay. Hôte inconnu ou URL non décodable : retourné inchangé.
 */
export function withEmbedAutoplay(embed: string): string {
  try {
    const u = new URL(embed);
    const h = u.hostname;
    if (h.includes("youtube-nocookie")) {
      u.searchParams.set("enablejsapi", "1");
      u.searchParams.set("autoplay", "1");
    } else if (h.includes("vimeo")) {
      u.searchParams.set("autoplay", "1");
      // la Player API rejette les messages postMessage sans cette origine
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      u.searchParams.set("origin", origin);
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

/**
 * Un message postMessage du lecteur embarqué annonce-t-il la fin de la
 * piste (→ enchaîner la suivante) ? Origine vérifiée : n'importe quel
 * iframe de la page ne doit pas pouvoir faire sauter la file.
 *
 * Plateformes couvertes : YouTube (`onStateChange` état 0) et Vimeo
 * (`finish`, après `addEventListener`). Dailymotion/TikTok/Twitch : aucun
 * event « fin » documenté sans SDK chargé → toujours false (l'utilisateur
 * enchaîne lui-même).
 *
 * @param embedUrl URL de l'iframe lecteur (telle que construite par `videoEmbedUrl`)
 * @param origin `MessageEvent.origin` du message reçu
 * @param data `MessageEvent.data` déjà décodé (objet) ou valeur non-objet
 * @returns true si la piste est terminée
 */
export function embedEnded(
  embedUrl: string,
  origin: string,
  data: unknown,
): boolean {
  if (typeof data !== "object" || data === null) return false;
  const msg = data as { event?: unknown; info?: { playerState?: unknown } };
  if (embedUrl.includes("youtube-nocookie.com")) {
    return (
      origin === YOUTUBE_ORIGIN &&
      msg.event === "onStateChange" &&
      msg.info?.playerState === 0
    );
  }
  if (embedUrl.includes("player.vimeo.com")) {
    return origin === VIMEO_ORIGIN && msg.event === "finish";
  }
  return false;
}

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

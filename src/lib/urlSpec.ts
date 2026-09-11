/**
 * Spécification du champ « lien » principal selon le type de ressource.
 * Le formulaire s'adapte vraiment : un dépôt exige un lien git, une app
 * un exécutable, une vidéo un lien de plateforme vidéo, etc.
 */
interface UrlSpec {
  /** libellé du champ principal */
  primaryLabel: string;
  primaryPlaceholder: string;
  /** afficher le bouton « Récupérer » (titre + favicon) */
  showFetch: boolean;
  /** indice sous le champ */
  hint?: string;
  /** le champ principal est un chemin d'exécutable (app) et non une URL */
  isExe?: boolean;
  /** le champ principal est un chemin de fichier local (type fichier) */
  isFile?: boolean;
  /** pour une app : champ URL web secondaire optionnel */
  secondaryLabel?: string;
  /** validation du lien principal ; retourne un message d'erreur ou null */
  validate?: (value: string) => string | null;
}

const GIT_HOSTS = [
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "codeberg.org",
  "dev.azure.com",
  "ssh://",
];

const VIDEO_HOSTS = [
  "youtube.com",
  "youtu.be",
  "m.youtube.com",
  "music.youtube.com",
  "tiktok.com",
  "vimeo.com",
  "dailymotion.com",
  "dai.ly",
  "twitch.tv",
  "peertube.tv",
];

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function requireHttps(value: string): string | null {
  if (!value) return "Ce lien est obligatoire.";
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return "Le lien doit commencer par http:// ou https://";
  }
  return null;
}

export function urlSpecFor(type: string): UrlSpec {
  switch (type) {
    case "app":
      return {
        primaryLabel: "Chemin de l'exécutable",
        primaryPlaceholder: "ex : C:\\Program Files\\Mon App\\monapp.exe",
        showFetch: false,
        isExe: true,
        secondaryLabel: "Site web de l'app (optionnel)",
        hint: "C'est le programme que la tuile lancera au clic.",
      };
    case "repo":
      return {
        primaryLabel: "Lien du dépôt",
        primaryPlaceholder: "https://github.com/owner/repo",
        showFetch: true,
        hint: "GitHub : « Récupérer » remplit la fiche (langage, étoiles, licence…). GitLab, Bitbucket ou Codeberg acceptés.",
        validate: (v) => {
          const base = requireHttps(v);
          if (base) return base;
          const host = hostOf(v);
          if (
            !GIT_HOSTS.some(
              (h) => host === h || host.endsWith(`.${h}`) || v.startsWith(h),
            )
          ) {
            return "Utilise un lien GitHub, GitLab, Bitbucket ou Codeberg.";
          }
          return null;
        },
      };
    case "video":
      return {
        primaryLabel: "Lien de la vidéo",
        primaryPlaceholder: "https://youtube.com/watch?v=…",
        showFetch: true,
        hint: "YouTube, TikTok, Vimeo, Dailymotion ou Twitch — l'aperçu s'affiche dans l'app.",
        validate: (v) => {
          const base = requireHttps(v);
          if (base) return base;
          const host = hostOf(v);
          if (!VIDEO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
            return "Utilise un lien YouTube, TikTok, Vimeo, Dailymotion ou Twitch.";
          }
          return null;
        },
      };
    case "outil":
      return {
        primaryLabel: "Lien de l'outil",
        primaryPlaceholder: "https://…",
        showFetch: true,
        hint: "Un outil en ligne : son adresse web.",
        validate: requireHttps,
      };
    case "article":
      return {
        primaryLabel: "Lien de l'article",
        primaryPlaceholder: "https://…",
        showFetch: true,
        hint: "Article, documentation ou page à relire.",
        validate: requireHttps,
      };
    case "autre":
      return {
        primaryLabel: "Lien",
        primaryPlaceholder: "https://…",
        showFetch: true,
        hint: "Tout autre type de ressource avec une adresse web.",
        validate: requireHttps,
      };
    case "fichier":
      return {
        primaryLabel: "Chemin du fichier",
        // antislashs doublés : « C:\U » insérait un retour chariot réel
        primaryPlaceholder: "ex : C:\\Users\\moi\\Documents\\rapport.pdf",
        showFetch: false,
        isFile: true,
        hint: "Le fichier s'ouvrira avec l'application Windows par défaut.",
      };
    case "note":
      return {
        primaryLabel: "",
        primaryPlaceholder: "",
        showFetch: false,
      };
    default:
      // site
      return {
        primaryLabel: "URL du site",
        primaryPlaceholder: "https://…",
        showFetch: true,
        validate: requireHttps,
      };
  }
}

/**
 * Devine le type depuis une URL capturée (presse-papiers, drag & drop) :
 * dépôt git ou vidéo → on va direct au formulaire ; le reste passe par
 * l'étape de choix du type.
 */
export function detectTypeForUrl(url: string): "repo" | "video" | null {
  const host = hostOf(url);
  if (!host) return null;
  if (
    GIT_HOSTS.some(
      (h) => host === h || host.endsWith(`.${h}`) || url.startsWith(h),
    )
  ) {
    return "repo";
  }
  if (VIDEO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return "video";
  }
  return null;
}

import {
  File,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileType,
  Film,
  Image,
  type LucideIcon,
  Music,
  Presentation,
  Terminal,
} from "lucide-react";

/** Icône + couleur par extension de fichier local : la tuile « fichier »
 *  reflète le vrai type du document (txt, pdf, zip…) au lieu d'un dossier
 *  générique. */
interface FileKind {
  icon: LucideIcon;
  /** classes de couleur de l'icône (le fond reste bg-muted) */
  className: string;
}

const KINDS: { exts: string[]; kind: FileKind }[] = [
  // texte lisible
  {
    exts: ["txt", "md", "markdown", "log", "rst", "nfo"],
    kind: { icon: FileText, className: "text-sky-600 dark:text-sky-400" },
  },
  // documents bureautiques
  {
    exts: ["pdf"],
    kind: { icon: FileType, className: "text-red-600 dark:text-red-400" },
  },
  {
    exts: ["doc", "docx", "odt", "rtf", "pages"],
    kind: { icon: FileText, className: "text-blue-600 dark:text-blue-400" },
  },
  // tableurs
  {
    exts: ["xls", "xlsx", "ods", "csv", "numbers"],
    kind: {
      icon: FileSpreadsheet,
      className: "text-emerald-600 dark:text-emerald-400",
    },
  },
  // présentations
  {
    exts: ["ppt", "pptx", "odp", "key"],
    kind: {
      icon: Presentation,
      className: "text-orange-600 dark:text-orange-400",
    },
  },
  // images
  {
    exts: [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "svg",
      "ico",
      "bmp",
      "tiff",
      "heic",
      "avif",
    ],
    kind: { icon: Image, className: "text-fuchsia-600 dark:text-fuchsia-400" },
  },
  // audio
  {
    exts: ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus", "wma"],
    kind: { icon: Music, className: "text-violet-600 dark:text-violet-400" },
  },
  // vidéo
  {
    exts: ["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v"],
    kind: { icon: Film, className: "text-rose-600 dark:text-rose-400" },
  },
  // code
  {
    exts: [
      "rs",
      "ts",
      "tsx",
      "js",
      "jsx",
      "py",
      "go",
      "c",
      "cpp",
      "h",
      "cs",
      "java",
      "kt",
      "swift",
      "rb",
      "php",
      "lua",
      "sh",
      "ps1",
      "bat",
      "json",
      "yaml",
      "yml",
      "toml",
      "xml",
      "html",
      "css",
      "sql",
      "ipynb",
    ],
    kind: { icon: FileCode, className: "text-cyan-600 dark:text-cyan-400" },
  },
  // scripts shell / terminal
  {
    exts: ["cmd", "zsh", "fish"],
    kind: { icon: Terminal, className: "text-zinc-600 dark:text-zinc-300" },
  },
  // archives
  {
    exts: ["zip", "rar", "7z", "tar", "gz", "xz", "bz2", "tgz", "iso"],
    kind: {
      icon: FileArchive,
      className: "text-amber-600 dark:text-amber-400",
    },
  },
  // audio courts / sonneries — couvert par Music plus haut
];

const FALLBACK: FileKind = {
  icon: File,
  className: "text-muted-foreground",
};

/** Chemin le plus fiable : meta.filePath (sélecteur), sinon l'URL « file:… ». */
function rawPath(resource: {
  url: string;
  meta?: Record<string, string>;
}): string {
  return (
    resource.meta?.filePath ??
    (resource.url.startsWith("file:") ? resource.url.slice(5) : "")
  );
}

/** Icône de fichier selon l'extension du chemin local. */
export function fileKindFor(resource: {
  url: string;
  meta?: Record<string, string>;
}): FileKind {
  const p = rawPath(resource);
  if (!p) return FALLBACK;
  // on ignore les arguments (?…) et on prend la dernière extension
  const name = p.split(/[\\/]/).pop()?.split("?")[0] ?? "";
  const ext = name.includes(".")
    ? (name.split(".").pop() ?? "").toLowerCase()
    : "";
  if (!ext) return FALLBACK;
  return KINDS.find((k) => k.exts.includes(ext))?.kind ?? FALLBACK;
}

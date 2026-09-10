import type { ImportedBookmark } from "./types";

/**
 * Import depuis un fichier : HTML Netscape (« Exporter les favoris » de
 * n'importe quel navigateur) ou CSV (Pocket, Raindrop…).
 * Parsing en regex/chaînes uniquement : aucune dépendance DOM, donc
 * testable en Node — les exports sont générés par des machines au format
 * stable, pas du HTML artisanal.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  "#x27": "'",
};

/** Décodage HTML en une passe (sans double-décodage). */
export function decodeEntities(s: string): string {
  return s.replace(
    /&(amp|lt|gt|quot|#39|#x27);/gi,
    (m, n: string) => ENTITIES[n.toLowerCase()] ?? m,
  );
}

/**
 * Export HTML Netscape : balises H3 (dossiers) et A (favoris) dans l'ordre
 * du document — le dossier courant suit les H3 (à plat, sans imbrication).
 */
export function parseNetscapeHtml(text: string): ImportedBookmark[] {
  const out: ImportedBookmark[] = [];
  const seen = new Set<string>();
  const re =
    /<h3[^>]*>([^<]*)<\/h3>|<a\s[^>]*?href=("([^"]+)"|'([^']+)')[^>]*>([^<]*)<\/a>/gi;
  let folder = "";
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) {
      folder = decodeEntities(m[1]).trim();
      continue;
    }
    // groupes : 2 = href quoté brut, 3/4 = intérieur "..." ou '...', 5 = texte
    const href = decodeEntities(m[3] ?? m[4] ?? "").trim();
    if (!/^https?:\/\//i.test(href) || seen.has(href)) continue;
    seen.add(href);
    const title = decodeEntities(m[5] ?? "").trim() || href;
    out.push({ title, url: href, folder, selected: true });
  }
  if (out.length === 0) {
    throw new Error("Aucun favori trouvé dans ce fichier HTML");
  }
  return out;
}

/** Découpe une ligne CSV en respectant les champs entre guillemets. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === delimiter) {
      cells.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells.map((s) => s.trim());
}

const URL_COLS = ["url", "link", "href", "uri", "lien"];
const TITLE_COLS = ["title", "name", "titre", "nom"];
const FOLDER_COLS = ["folder", "collection", "dossier"];
const TAGS_COLS = ["tags", "tag", "etiquettes", "labels", "label"];

function findCol(header: string[], names: string[]): number {
  return header.findIndex((h) => names.includes(h));
}

function splitTagsCell(cell: string): string[] {
  return cell
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * CSV type Pocket/Raindrop : en-tête avec colonne URL obligatoire
 * (url, link…), titre/folder/tags optionnels. Délimiteur , ou ; auto-détecté.
 */
export function parseCsv(text: string): ImportedBookmark[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    throw new Error("CSV vide ou sans lignes de données");
  }
  const clean = (s: string) =>
    s
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase();
  const commas = (lines[0].match(/,/g) ?? []).length;
  const semis = (lines[0].match(/;/g) ?? []).length;
  const delimiter = semis > commas ? ";" : ",";
  const header = splitCsvLine(lines[0], delimiter).map(clean);
  const urlCol = findCol(header, URL_COLS);
  if (urlCol === -1) {
    throw new Error("Colonne URL introuvable (url, link…)");
  }
  const titleCol = findCol(header, TITLE_COLS);
  const folderCol = findCol(header, FOLDER_COLS);
  const tagsCol = findCol(header, TAGS_COLS);
  const out: ImportedBookmark[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, delimiter);
    const url = (cells[urlCol] ?? "").trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const title = (titleCol >= 0 ? (cells[titleCol] ?? "").trim() : "") || url;
    out.push({
      title,
      url,
      folder: folderCol >= 0 ? (cells[folderCol] ?? "").trim() : "",
      tags: tagsCol >= 0 ? splitTagsCell(cells[tagsCol] ?? "") : [],
      selected: true,
    });
  }
  if (out.length === 0) {
    throw new Error("Aucun lien valide dans ce CSV");
  }
  return out;
}

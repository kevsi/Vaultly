/**
 * Recherche d'icônes pour la bibliothèque (modale d'ajout) :
 * - synonymes FR→EN (l'utilisateur cherche « musique », l'API parle anglais)
 * - recherche locale dans les marques (Simple Icons, hors-ligne)
 * - recherche distante d'icônes génériques (Iconify : Lucide, Material…)
 */

import { tt } from "@/lib/i18n";

/** Synonymes français → anglais (clés sans accents, minuscules). */
const FR_TO_EN: Record<string, string> = {
  musique: "music",
  chanson: "music",
  livre: "book",
  lecture: "book",
  roman: "book",
  bd: "book",
  film: "movie",
  cinema: "movie",
  serie: "movie",
  jeu: "game",
  gaming: "game",
  manette: "game",
  photo: "photo",
  image: "image",
  maison: "home",
  travail: "work",
  bureau: "desk",
  argent: "money",
  banque: "bank",
  nourriture: "food",
  recette: "food",
  cuisine: "food",
  sport: "sport",
  sante: "health",
  medecin: "health",
  ecole: "school",
  cours: "school",
  voiture: "car",
  avion: "plane",
  voyage: "travel",
  train: "train",
  coeur: "heart",
  amour: "heart",
  chien: "dog",
  chat: "cat",
  fleur: "flower",
  arbre: "tree",
  soleil: "sun",
  lune: "moon",
  etoile: "star",
  nuage: "cloud",
  pluie: "rain",
  neige: "snow",
  cle: "key",
  securite: "shield",
  parametre: "settings",
  reglage: "settings",
  recherche: "search",
  utilisateur: "user",
  personne: "user",
  message: "message",
  mail: "mail",
  email: "mail",
  telephone: "phone",
  calendrier: "calendar",
  horloge: "clock",
  carte: "map",
  monde: "globe",
  internet: "globe",
  ordinateur: "computer",
  portable: "laptop",
  imprimante: "printer",
  dossier: "folder",
  fichier: "file",
  document: "file",
  crayon: "pencil",
  boutique: "shop",
  cadeau: "gift",
  fete: "party",
  camera: "camera",
  micro: "mic",
  casque: "headphones",
  video: "video",
  tele: "tv",
  radio: "radio",
  journal: "news",
  actualite: "news",
  meteo: "weather",
  lampe: "light",
  ampoule: "light",
  outil: "tool",
  marteau: "hammer",
  jardin: "garden",
  lit: "bed",
  cafe: "coffee",
  the: "tea",
  biere: "beer",
  vin: "wine",
  velo: "bike",
  moto: "moto",
  bateau: "boat",
  bus: "bus",
  enfant: "child",
  bebe: "baby",
  famille: "family",
  ami: "friend",
  eglise: "church",
  hopital: "hospital",
  pharmacie: "pharmacy",
  dentiste: "dentist",
  avocat: "law",
  police: "police",
  pompier: "fire",
  feu: "fire",
  eau: "water",
  verre: "glass",
  assiette: "plate",
  fourchette: "food",
  couteau: "food",
  cuillere: "food",
  pain: "food",
  fromage: "food",
  fruit: "food",
  pomme: "food",
  legume: "food",
  viande: "food",
  poisson: "fish",
  oiseau: "bird",
  papillon: "butterfly",
  abeille: "bug",
  araignee: "bug",
  serpent: "snake",
  cheval: "horse",
  vache: "cow",
  cochon: "pig",
  poulet: "bird",
  lion: "cat",
  tigre: "cat",
  ours: "bear",
  panda: "bear",
  singe: "monkey",
  elephant: "elephant",
  girafe: "giraffe",
  zebre: "zebra",
  kangourou: "kangaroo",
  pingouin: "penguin",
  baleine: "whale",
  requin: "fish",
  dauphin: "fish",
  tortue: "turtle",
  grenouille: "frog",
  escargot: "snail",
  champignon: "mushroom",
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function singular(tok: string): string {
  return tok.endsWith("s") && tok.length > 3 ? tok.slice(0, -1) : tok;
}

function splitQuery(q: string): string[] {
  return norm(q)
    .split(/[\s,_-]+/)
    .filter(Boolean);
}

/** Formes acceptées d'un token : lui-même, son singulier, sa traduction. */
function tokenForms(tok: string): string[] {
  const out = [tok];
  const s = singular(tok);
  if (s !== tok) out.push(s);
  const en = FR_TO_EN[tok] ?? (s !== tok ? FR_TO_EN[s] : undefined);
  if (en && !out.includes(en)) out.push(en);
  return out;
}

/** Vrai si TOUS les mots de la requête matchent (FR ou EN). */
export function brandMatches(title: string, slug: string, q: string): boolean {
  const hay = norm(`${title} ${slug}`);
  const toks = splitQuery(q);
  if (toks.length === 0) return true;
  return toks.every((tok) => tokenForms(tok).some((f) => hay.includes(f)));
}

/** Requête traduite en anglais pour l'API Iconify. */
export function englishQuery(q: string): string {
  return splitQuery(q)
    .map((tok) => FR_TO_EN[tok] ?? FR_TO_EN[singular(tok)] ?? tok)
    .join(" ");
}

/** Recherche distante d'icônes génériques (noms « set:nom »). */
export async function searchGenericIcons(
  query: string,
  limit = 96,
): Promise<string[]> {
  const res = await fetch(
    `https://api.iconify.design/search?query=${encodeURIComponent(query)}&limit=${limit}`,
  );
  if (!res.ok) throw new Error(tt("Recherche d'icônes indisponible"));
  const data = await res.json();
  return Array.isArray(data?.icons) ? data.icons.slice(0, limit) : [];
}

/** URL d'aperçu / téléchargement d'une icône générique, couleur imposée. */
export function genericIconUrl(
  id: string,
  colorHex: string,
  height = 64,
): string {
  return `https://api.iconify.design/${id}.svg?height=${height}&color=%23${colorHex}`;
}

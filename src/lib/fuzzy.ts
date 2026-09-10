/**
 * Recherche fuzzy légère (aucune dépendance) : sous-séquence avec bonus
 * de score. Suffisante pour une palette (tri des meilleurs candidats,
 * tolérance aux fautes de frappe dans l'ordre des lettres).
 *
 * - "ghb" → "GitHub Branches" (initiales)
 * - "gitub" → "GitHub" (lettre manquante : la sous-séquence reste vraie
 *   tant que les lettres sont dans l'ordre)
 * - score : lettres contiguës et débuts de mots avantagés
 */

export interface FuzzyMatch {
  /** score : plus grand = meilleur */
  score: number;
  /** indices des caractères matchés (pour un surlignage éventuel) */
  indices: number[];
}

export function fuzzyMatch(
  needle: string,
  haystack: string,
): FuzzyMatch | null {
  if (!needle) return { score: 0, indices: [] };
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let hi = 0;
  let prevMatched = -2; // pour détecter la contiguïté
  for (let ni = 0; ni < n.length; ni++) {
    const c = n[ni];
    if (c === " ") continue; // mots multiples : l'ordre global suffit
    let found = -1;
    for (let i = hi; i < h.length; i++) {
      if (h[i] === c) {
        found = i;
        break;
      }
    }
    if (found === -1) return null; // lettre absente dans l'ordre : pas un match
    // lettres contiguës = préfixe/abréviation naturelle
    score += found === prevMatched + 1 ? 8 : 2;
    // début de mot (début de chaîne, séparateur, ou majuscule en camelCase)
    const prev = found > 0 ? h[found - 1] : "";
    const wordStart =
      found === 0 || /[\s\-_/.[]/.test(prev) || h[found] !== haystack[found];
    if (wordStart) score += 6;
    // bonus léger de précocité
    score += Math.max(0, 4 - Math.floor(found / 8));
    indices.push(found);
    prevMatched = found;
    hi = found + 1;
  }
  return { score, indices };
}

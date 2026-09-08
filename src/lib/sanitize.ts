/**
 * Nettoie le HTML des notes avant rendu : retire les éléments exécutables
 * (script, iframe…) et les vecteurs d'événements/URL, garde la mise en
 * forme (titres, listes, gras, citations, liens http).
 */

/** Schémas d'URL autorisés dans href/src (allowlist : tout le reste —
 *  javascript:, data:, vbscript:… — est retiré). */
const SAFE_URL_SCHEMES = ["http:", "https:", "mailto:"];

function isSafeUrl(raw: string): boolean {
  // les caractères de contrôle (< 0x20) sont ignorés par le parseur
  // d'URL du navigateur : « java\tscript: » sinon contournerait le test.
  const cleaned = raw
    .split("")
    .filter((c) => c.charCodeAt(0) >= 0x20)
    .join("")
    .trim()
    .toLowerCase();
  if (cleaned === "" || cleaned.startsWith("#")) return true; // ancre interne
  // schéma relatif (pas de « : » avant le premier « / ») : ok
  const colon = cleaned.indexOf(":");
  const slash = cleaned.indexOf("/");
  if (colon === -1 || (slash !== -1 && slash < colon)) return true;
  return SAFE_URL_SCHEMES.some((s) => cleaned.startsWith(s));
}

/** Attributs conservés par balise — tout le reste (style, class, id,
 *  target, data-*) est retiré : la note n'apporte que de la mise en forme. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href"]),
  IMG: new Set(["src", "alt"]),
};

const ALLOWED_TAGS = new Set([
  "H1", "H2", "H3", "P", "BR", "STRONG", "B", "EM", "I", "U", "S",
  "UL", "OL", "LI", "BLOCKQUOTE", "A", "CODE", "PRE", "SPAN", "DIV",
  "IMG",
]);

export function sanitizeHtml(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");

  // éléments dangereux retirés entièrement (sur TOUT le document : les
  // <script>/<style> peuvent être dans le <head>)
  doc
    .querySelectorAll("script, style, iframe, object, embed, link, meta, base, form, input, button")
    .forEach((el) => el.remove());

  // On itère sur les DESCENDANTS de <body>, jamais sur doc.querySelectorAll("*")
  // : celui-ci inclut <html>/<head>/<body>, et déplier <html> en ses deux
  // enfants (<head>+<body>) lève « HierarchyRequestError: Only one element on
  // document allowed » — ce qui faisait planter le sanitizer sur TOUTE entrée.
  doc.body.querySelectorAll("*").forEach((el) => {
    const allowedAttrs = ALLOWED_ATTRS[el.tagName];
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      // 1) on* supprimé, 2) href/src contrôlés par allowlist de schémas,
      // 3) tout autre attribut hors allowlist par balise : retiré.
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      } else if (name === "href" || name === "src") {
        if (!isSafeUrl(attr.value)) el.removeAttribute(attr.name);
      } else if (!allowedAttrs?.has(name)) {
        el.removeAttribute(attr.name);
      }
    }
    // les seules balises de formatage autorisées restent, le reste est déplié
    if (!ALLOWED_TAGS.has(el.tagName)) {
      el.replaceWith(...el.childNodes);
    }
  });

  return doc.body.innerHTML;
}

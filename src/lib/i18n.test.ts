import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dicts, getLang, setLang, tt } from "./i18n";

const { fr, en } = dicts;

/** Récupère le texte source de i18n.ts (pour détecter les doublons de clés,
 *  invisibles dans l'objet JS : le dernier écrase silencieusement). */
const I18N_SRC = readFileSync(new URL("./i18n.ts", import.meta.url), "utf8");

/** Parse les clés d'un dict dans la source : clés quotées ET identifiants
 *  nus (Biome retire les guillemets des clés accentuées valides). */
function keysOf(dictName: string): string[] {
  const start = I18N_SRC.indexOf(`const ${dictName}: Dict = {`);
  expect(start).toBeGreaterThan(0);
  const open = I18N_SRC.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < I18N_SRC.length; i++) {
    if (I18N_SRC[i] === "{") depth++;
    else if (I18N_SRC[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = I18N_SRC.slice(open + 1, end);
  const keys: string[] = [];
  for (const m of body.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)) {
    keys.push(JSON.parse(`"${m[1]}"`) as string);
  }
  for (const m of body.matchAll(/'((?:[^'\\]|\\.)*)'\s*:/g)) {
    keys.push(m[1].replace(/\\'/g, "'"));
  }
  for (const m of body.matchAll(/(^|\n)\s*([\p{L}_$][\p{L}\p{N}$]*)\s*:/gu)) {
    keys.push(m[2]);
  }
  return keys;
}

/** Liste tous les .ts/.tsx de src (hors assets). */
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== "node_modules" && e !== "assets") walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(e) && !/\.test\.(ts|tsx)$/.test(e)) {
      acc.push(p);
    }
  }
  return acc;
}

/** Clés littérales utilisées dans le code : t("...") / tt("..."). */
function usedKeys(): string[] {
  const keys: string[] = [];
  for (const file of walk("src")) {
    if (file.replace(/\\/g, "/").endsWith("lib/i18n.ts")) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(
      /\b(?:t|tt)\(\s*(["'])((?:[^'"\\]|\\.)*)\1/g,
    )) {
      const raw = m[2];
      try {
        keys.push(JSON.parse(`"${raw}"`) as string);
      } catch {
        keys.push(raw.replace(/\\'/g, "'"));
      }
    }
  }
  return [...new Set(keys)];
}

describe("cohérence du dictionnaire i18n", () => {
  it("n'a aucune clé dupliquée dans en (le dernier écraserait silencieusement)", () => {
    const keys = keysOf("en");
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  it("n'a aucune clé dupliquée dans fr", () => {
    const keys = keysOf("fr");
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  it("chaque clé identifiants du dict fr a sa traduction en", () => {
    // les clés texte-FR n'existent que dans en (fallback = la clé) : on ne
    // vérifie que le sens fr → en, qui ne doit jamais manquer.
    const missing = Object.keys(fr).filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it("toutes les clés littérales t()/tt() du code existent dans en (sinon l'EN affiche du français)", () => {
    const missing = usedKeys().filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it("chaque valeur {param} de en utilise des paramètres compatibles avec sa clé", () => {
    // garde-fou léger : si la clé contient {x}, la valeur EN doit exposer
    // {x} aussi (sinon l'interpolation perd l'info en anglais).
    for (const [k, v] of Object.entries(en)) {
      const keyParams = [...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const valParams = [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const p of keyParams) {
        expect(
          valParams,
          `clé "${k}" : {${p}} absent de la traduction EN`,
        ).toContain(p);
      }
    }
  });
});

describe("comportement de traduction", () => {
  it("tt() retombe sur la clé (texte FR) pour une clé inconnue", () => {
    setLang("fr");
    expect(tt("Clé inexistante")).toBe("Clé inexistante");
  });

  it("tt() interpole les paramètres sur une clé inconnue", () => {
    expect(tt("Bonjour {name}", { name: "Léa" })).toBe("Bonjour Léa");
  });

  it("la langue par défaut est fr", () => {
    expect(getLang()).toBe("fr");
  });
});

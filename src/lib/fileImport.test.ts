import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  parseCsv,
  parseNetscapeHtml,
  splitCsvLine,
} from "./fileImport";

describe("decodeEntities", () => {
  it("décode en une passe, sans double-décodage", () => {
    expect(decodeEntities("R&amp;D")).toBe("R&D");
    expect(decodeEntities("&lt;tag&gt;")).toBe("<tag>");
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeEntities("plain")).toBe("plain");
  });
});

describe("parseNetscapeHtml", () => {
  const sample = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
<DT><H3 ADD_DATE="1">Dev</H3>
<DL><p>
<DT><A HREF="https://example.com/a" ADD_DATE="2">Alpha &amp; Co</A>
<DT><A HREF="https://example.com/a">Alpha doublon</A>
<DT><A HREF="javascript:void(0)">Pas un lien</A>
</DL><p>
<DT><H3>Perso</H3>
<DL><p>
<DT><A HREF='https://example.com/b'>Beta</A>
</DL><p>
</DL><p>`;

  it("extrait titres, dossiers, dédoublonne, ignore le non-http", () => {
    const out = parseNetscapeHtml(sample);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      title: "Alpha & Co",
      url: "https://example.com/a",
      folder: "Dev",
    });
    expect(out[1]).toMatchObject({
      title: "Beta",
      folder: "Perso",
    });
  });

  it("titre vide = URL", () => {
    const out = parseNetscapeHtml(
      `<DL><p><DT><A HREF="https://x.com/"></A></DL>`,
    );
    expect(out[0].title).toBe("https://x.com/");
  });

  it("jette une erreur sans favori", () => {
    expect(() => parseNetscapeHtml("<html><body>rien</body></html>")).toThrow(
      /Aucun favori/,
    );
  });
});

describe("splitCsvLine", () => {
  it("respecte les guillemets et les doublons", () => {
    expect(splitCsvLine('a,"b, c","d""e",f', ",")).toEqual([
      "a",
      "b, c",
      'd"e',
      "f",
    ]);
  });
});

describe("parseCsv", () => {
  const pocket = `Title,Url,Time Added,Tags,Status
"Mon article","https://example.com/a","1720000000","lecture, important","unread"
"Sans tags","https://example.com/b","1720000001","","unread"
"Pas un lien","javascript:void(0)","","","unread"`;

  it("Pocket : colonnes, tags, filtre non-http", () => {
    const out = parseCsv(pocket);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      title: "Mon article",
      url: "https://example.com/a",
      tags: ["lecture", "important"],
    });
    expect(out[1].tags).toEqual([]);
  });

  it("point-virgule auto-détecté (Raindrop-like)", () => {
    const csv = `title;url;folder\nA;https://a.com/;Dev\nB;https://b.com/;`;
    const out = parseCsv(csv);
    expect(out[0].folder).toBe("Dev");
    expect(out[1].folder).toBe("");
  });

  it("titre absent = URL", () => {
    const out = parseCsv(`url\nhttps://x.com/`);
    expect(out[0].title).toBe("https://x.com/");
  });

  it("erreurs explicites", () => {
    expect(() => parseCsv("juste une ligne")).toThrow(/sans lignes/);
    expect(() => parseCsv("nom,titre\nfoo,bar")).toThrow(/URL introuvable/);
    expect(() => parseCsv("url\njavascript:void(0)")).toThrow(/Aucun lien/);
  });
});

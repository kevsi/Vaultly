import { describe, expect, it } from "vitest";
import { detectTypeForUrl, urlSpecFor } from "./urlSpec";

describe("urlSpecFor", () => {
  it("site par défaut avec validation https", () => {
    const spec = urlSpecFor("site");
    expect(spec.primaryLabel).toBe("URL du site");
    expect(spec.showFetch).toBe(true);
    expect(spec.validate?.("")).toMatch(/obligatoire/);
    expect(spec.validate?.("ftp://x")).toMatch(/http/);
    expect(spec.validate?.("https://example.com")).toBeNull();
  });

  it("repo exige un hôte git connu", () => {
    const v = urlSpecFor("repo").validate;
    expect(v?.("https://github.com/o/r")).toBeNull();
    expect(v?.("https://gitlab.com/o/r")).toBeNull();
    expect(v?.("https://example.com/o/r")).toMatch(/GitHub/);
  });

  it("video accepte les variantes d'hôtes", () => {
    const v = urlSpecFor("video").validate;
    expect(v?.("https://www.youtube.com/watch?v=1")).toBeNull();
    expect(v?.("https://youtu.be/1")).toBeNull();
    expect(v?.("https://example.com/v")).toMatch(/YouTube/);
  });

  it("app et fichier exposent un sélecteur natif, pas de fetch", () => {
    expect(urlSpecFor("app").isExe).toBe(true);
    expect(urlSpecFor("app").showFetch).toBe(false);
    expect(urlSpecFor("fichier").isFile).toBe(true);
    expect(urlSpecFor("fichier").showFetch).toBe(false);
  });
});

describe("detectTypeForUrl", () => {
  it("détecte dépôt et vidéo", () => {
    expect(detectTypeForUrl("https://github.com/o/r")).toBe("repo");
    expect(detectTypeForUrl("https://www.youtube.com/watch?v=1")).toBe("video");
    expect(detectTypeForUrl("https://youtu.be/1")).toBe("video");
  });

  it("reste nul pour le générique et l'invalide", () => {
    expect(detectTypeForUrl("https://example.com/page")).toBeNull();
    expect(detectTypeForUrl("pas une url")).toBeNull();
    expect(detectTypeForUrl("")).toBeNull();
  });
});

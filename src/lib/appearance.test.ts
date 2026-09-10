import { beforeEach, describe, expect, it, vi } from "vitest";
import { isSafeImageDataUrl } from "./appearance";

/** localStorage minimal pilotable par test. */
function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  });
  return store;
}

async function freshAppearance() {
  vi.resetModules();
  return await import("./appearance");
}

describe("readAppearance", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("défauts sans rien en stock", async () => {
    stubStorage();
    const { readAppearance } = await freshAppearance();
    expect(readAppearance()).toEqual({
      style: "carnet",
      font: "systeme",
      fontScale: "normal",
      buttons: "defaut",
      bg: { kind: "default" },
      bgDim: 0,
    });
  });

  it("JSON corrompu ou champs inconnus = défauts", async () => {
    stubStorage({ "vaultly-appearance": "{pas du json" });
    expect((await freshAppearance()).readAppearance().style).toBe("carnet");

    stubStorage({
      "vaultly-appearance": JSON.stringify({
        style: "nope",
        font: "nope",
        bg: { kind: "image", image: "https://evil.example/x.png" },
        bgDim: 99,
      }),
    });
    const a = (await freshAppearance()).readAppearance();
    expect(a.style).toBe("carnet");
    expect(a.bg).toEqual({ kind: "default" });
    expect(a.bgDim).toBeLessThanOrEqual(1);
  });

  it("relit une config valide complète", async () => {
    stubStorage({
      "vaultly-appearance": JSON.stringify({
        style: "anime",
        font: "mono",
        fontScale: "confort",
        buttons: "manga",
        bg: { kind: "gradient", id: "neon" },
        bgDim: 0.3,
      }),
    });
    const a = (await freshAppearance()).readAppearance();
    expect(a.style).toBe("anime");
    expect(a.bg).toEqual({ kind: "gradient", id: "neon" });
    expect(a.bgDim).toBe(0.3);
  });
});

describe("updateAppearance", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("persiste et applique sans document (node)", async () => {
    const store = stubStorage();
    const { updateAppearance, getAppearance } = await freshAppearance();
    updateAppearance({ style: "neon", bgDim: 0.5 });
    expect(getAppearance().style).toBe("neon");
    expect(store.has("vaultly-appearance")).toBe(true);
  });
});

describe("isSafeImageDataUrl", () => {
  it("accepte un data URL d'image propre", () => {
    expect(isSafeImageDataUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isSafeImageDataUrl("data:image/jpeg,abc-123_=")).toBe(true);
  });

  it('rejette tout caractère capable de sortir de url("…")', () => {
    expect(
      isSafeImageDataUrl('data:image/png;base64,AA"),background:url("evil'),
    ).toBe(false);
    expect(isSafeImageDataUrl('data:image/png;base64,AA)" }')).toBe(false);
    expect(isSafeImageDataUrl("data:image/png;base64,AA\\BB")).toBe(false);
    // pas une image : refusé
    expect(isSafeImageDataUrl("data:application/x-msdownload,AA")).toBe(false);
    expect(isSafeImageDataUrl("https://example.com/x.png")).toBe(false);
  });

  it("readAppearance ignore une image de fond altérée", async () => {
    stubStorage({
      "vaultly-appearance": JSON.stringify({
        bg: { kind: "image", image: 'data:image/png;base64,AA"),x:y(' },
      }),
    });
    const { readAppearance } = await freshAppearance();
    expect(readAppearance().bg).toEqual({ kind: "default" });
  });
});

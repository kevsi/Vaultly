import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
}

async function fresh() {
  vi.resetModules();
  return await import("./onboarding");
}

describe("onboarding flags", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("non onboarded par défaut, puis marqué", async () => {
    stubStorage();
    const m = await fresh();
    expect(m.isOnboarded()).toBe(false);
    m.markOnboarded();
    expect(m.isOnboarded()).toBe(true);
  });

  it("storage indisponible => considéré onboarded (ne pas harceler)", async () => {
    vi.stubGlobal("localStorage", undefined);
    const m = await fresh();
    expect(m.isOnboarded()).toBe(true);
    expect(() => m.markOnboarded()).not.toThrow();
  });

  it("prefersReducedMotion faux sans matchMedia", async () => {
    const m = await fresh();
    expect(m.prefersReducedMotion()).toBe(false);
  });

  it("replayTour émet l'événement attendu", async () => {
    const m = await fresh();
    const seen: string[] = [];
    const win = {
      addEventListener: (_: string, cb: () => void) => {
        void cb;
        seen.push("added");
      },
      removeEventListener: () => {},
      dispatchEvent: (e: { type: string }) => {
        seen.push(e.type);
        return true;
      },
    };
    vi.stubGlobal("window", win);
    m.replayTour();
    expect(seen).toContain(m.REPLAY_EVENT);
  });
});

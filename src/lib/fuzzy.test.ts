import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("aiguille vide = match nul à zéro", () => {
    expect(fuzzyMatch("", "GitHub")).toEqual({ score: 0, indices: [] });
  });

  it("trouve une sous-séquence dans l'ordre", () => {
    const m = fuzzyMatch("ghb", "GitHub Branches");
    expect(m).not.toBeNull();
    expect(m?.indices).toHaveLength(3);
  });

  it("tolère une lettre manquante", () => {
    expect(fuzzyMatch("gitub", "GitHub")).not.toBeNull();
  });

  it("rejette les lettres hors ordre ou absentes", () => {
    expect(fuzzyMatch("hbg", "GitHub")).toBeNull();
    expect(fuzzyMatch("zzz", "GitHub")).toBeNull();
  });

  it("est insensible à la casse", () => {
    expect(fuzzyMatch("GITHUB", "github")).not.toBeNull();
  });

  it("ignore les espaces de l'aiguille", () => {
    expect(fuzzyMatch("g h", "GitHub")).not.toBeNull();
  });

  it("préfère le préfixe contigu au dispersé", () => {
    const prefix = fuzzyMatch("git", "GitHub");
    const sparse = fuzzyMatch("git", "Go Install Tool");
    expect(prefix?.score).toBeGreaterThan(sparse?.score ?? -1);
  });

  it("retourne les indices dans l'ordre croissant", () => {
    const m = fuzzyMatch("hub", "GitHub");
    expect(m).not.toBeNull();
    const sorted = [...(m?.indices ?? [])].sort((a, b) => a - b);
    expect(m?.indices).toEqual(sorted);
  });
});

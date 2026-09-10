import { describe, expect, it } from "vitest";
import { brandMatches, englishQuery } from "./iconSearch";

describe("brandMatches", () => {
  it("matche exact, insensible à la casse", () => {
    expect(brandMatches("GitHub", "github", "github")).toBe(true);
    expect(brandMatches("GitHub", "github", "GITHUB")).toBe(true);
    expect(brandMatches("GitHub", "github", "lab")).toBe(false);
  });

  it("comprend le français", () => {
    expect(brandMatches("Music", "music", "musique")).toBe(true);
    expect(brandMatches("Book", "book", "livres")).toBe(true);
  });

  it("exige tous les mots", () => {
    expect(brandMatches("Google Chrome", "googlechrome", "google chrome")).toBe(
      true,
    );
    expect(brandMatches("Google Chrome", "googlechrome", "google maps")).toBe(
      false,
    );
  });

  it("requête vide = tout", () => {
    expect(brandMatches("X", "x", "  ")).toBe(true);
  });
});

describe("englishQuery", () => {
  it("traduit mot à mot", () => {
    expect(englishQuery("musique")).toBe("music");
    expect(englishQuery("jeu de société")).toBe("game de societe");
  });

  it("laisse l'anglais intact", () => {
    expect(englishQuery("cloud music")).toBe("cloud music");
  });
});

import { describe, expect, it } from "vitest";
import { metaFieldsFor } from "./metaFields";
import { tileMinPx } from "./tileSize";

describe("metaFieldsFor", () => {
  it("repo expose langage, owner, étoiles…", () => {
    const keys = metaFieldsFor("repo").map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining(["language", "owner", "stars"]),
    );
  });

  it("type inconnu = aucun champ", () => {
    expect(metaFieldsFor("nope")).toEqual([]);
    expect(metaFieldsFor("autre")).toEqual([]);
  });
});

describe("tileMinPx", () => {
  it("tailles connues et repli", () => {
    expect(tileMinPx("small")).toBe(96);
    expect(tileMinPx("normal")).toBe(144);
    expect(tileMinPx("large")).toBe(192);
    expect(tileMinPx("nope" as never)).toBe(144);
  });
});

import { describe, expect, it } from "vitest";
import { formatRemindAt, parseDbDate, sqliteDatePlusDays } from "./resources";

describe("sqliteDatePlusDays", () => {
  it("format SQLite triable, à N jours", () => {
    const s = sqliteDatePlusDays(3);
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const diff = parseDbDate(s).getTime() - Date.now();
    expect(diff).toBeGreaterThan(2 * 86_400_000);
    expect(diff).toBeLessThan(4 * 86_400_000);
  });
});

describe("formatRemindAt", () => {
  it("libellés relatifs", () => {
    expect(formatRemindAt(sqliteDatePlusDays(0))).toBe("aujourd'hui");
    expect(formatRemindAt(sqliteDatePlusDays(1))).toBe("demain");
    expect(formatRemindAt(sqliteDatePlusDays(3))).toBe("dans 3 j");
    expect(formatRemindAt("2000-01-01 00:00:00")).toBe("aujourd'hui");
  });

  it("date courte au-delà d'une semaine", () => {
    const label = formatRemindAt(sqliteDatePlusDays(30));
    expect(label).not.toBe("");
    expect(label).not.toMatch(/dans/);
  });

  it("invalide = vide", () => {
    expect(formatRemindAt("pas une date")).toBe("");
  });
});

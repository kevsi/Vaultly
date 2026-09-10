import { describe, expect, it } from "vitest";
import { isSafeLinkHref } from "./sanitize";

describe("isSafeLinkHref", () => {
  it("accepte http/https/mailto et les relatifs/ancre", () => {
    expect(isSafeLinkHref("https://example.com")).toBe(true);
    expect(isSafeLinkHref("http://example.com/a")).toBe(true);
    expect(isSafeLinkHref("mailto:me@x.io")).toBe(true);
    expect(isSafeLinkHref("#section")).toBe(true);
    expect(isSafeLinkHref("/relative/path")).toBe(true);
    expect(isSafeLinkHref("example.com/x")).toBe(true); // pas de schéma
    expect(isSafeLinkHref("")).toBe(true); // vide : inoffensif
  });

  it("bloque les schémas exécutables / dangereux", () => {
    expect(isSafeLinkHref("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("JavaScript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("data:text/html,<script>1</script>")).toBe(false);
    expect(isSafeLinkHref("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeLinkHref("file:///C:/x")).toBe(false);
  });

  it("ignore les caractères de contrôle (anti java\\tscript)", () => {
    expect(isSafeLinkHref("java\tscript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("java\nscript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("  javascript:x")).toBe(false);
  });

  it("normalise &amp; avant le test de schéma", () => {
    // « https://a?x=1&amp;y=2 » doit rester un lien sain
    expect(isSafeLinkHref("https://a?x=1&amp;y=2")).toBe(true);
  });
});

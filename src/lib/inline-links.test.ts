import { describe, expect, it } from "vitest";
import { inlineLinks, plainInline } from "./inline-links";

describe("inlineLinks", () => {
  it("splits markdown links into parts", () => {
    expect(inlineLinks("Self-taught thanks to [J Perm](https://www.jperm.net/3x3). Send help.")).toEqual([
      { text: "Self-taught thanks to " },
      { text: "J Perm", href: "https://www.jperm.net/3x3" },
      { text: ". Send help." },
    ]);
  });

  it("leaves plain text and non-http links alone", () => {
    expect(inlineLinks("Plain [x](javascript:alert(1))")).toEqual([{ text: "Plain [x](javascript:alert(1))" }]);
  });

  it("strips link syntax for plain text", () => {
    expect(plainInline("Mostly [inserts](https://example.com/a), plus prints.")).toBe("Mostly inserts, plus prints.");
  });
});

import { describe, expect, it } from "vitest";
import { asArray, attr, decodeEntities, htmlToText, parseXml, text } from "./xml";

describe("XML helpers", () => {
  it("normalizes optional and singleton values to arrays", () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray("one")).toEqual(["one"]);
    expect(asArray(["one", "two"])).toEqual(["one", "two"]);
  });

  it("reads and trims text values", () => {
    expect(text(" value ")).toBe("value");
    expect(text({ "#text": " value " })).toBe("value");
    expect(text("  ")).toBeUndefined();
    expect(text({ other: "value" })).toBeUndefined();
  });

  it("reads prefixed attributes", () => {
    expect(attr({ "@_name": " value " }, "name")).toBe("value");
    expect(attr({}, "name")).toBeUndefined();
  });

  it("parses attributes and keeps XML values as strings", () => {
    expect(parseXml('<root count="2"><item> 3 </item></root>')).toEqual({
      root: { "@_count": "2", item: "3" },
    });
  });

  it("decodes named, decimal, and hexadecimal entities", () => {
    expect(decodeEntities("&amp; &lt; &gt; &quot; &#39; &#039; &apos; &nbsp; &#65; &#x41;"))
      .toBe("& < > \" ' ' '   A A");
    expect(decodeEntities("&#x110000; &unknown;")).toBe("&#x110000; &unknown;");
  });

  it("converts HTML to trimmed text paragraphs", () => {
    expect(htmlToText("<p> First <b>line</b><br>second </p><p> Third &amp; fourth </p><p> </p>"))
      .toBe("First line\nsecond\n\nThird & fourth");
  });
});

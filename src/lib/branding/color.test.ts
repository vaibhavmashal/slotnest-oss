import { describe, expect, it } from "vitest";
import { contrast, contrastReport, normalizeHex, palette, readableAccent, SURFACES, textOn } from "./color";

const worst = (c: string, mode: "light" | "dark") => Math.min(...SURFACES[mode].map((s) => contrast(c, s)));

describe("colour maths", () => {
  it("normalises hex input", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("2f5bea")).toBe("#2f5bea");
    expect(normalizeHex(" #2F5BEA ")).toBe("#2f5bea");
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
  });

  it("matches known WCAG contrast ratios", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrast("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("picks black or white text for readability", () => {
    expect(textOn("#ffeb3b")).toBe("#000000"); // yellow
    expect(textOn("#1a237e")).toBe("#ffffff"); // navy
    expect(textOn("#2f5bea")).toBe("#ffffff");
  });
});

describe("readable accents", () => {
  const brands = ["#2f5bea", "#ffeb3b", "#00e5ff", "#1a237e", "#000000", "#ffffff", "#ff5722", "#888888", "#7c3aed", "#10b981"];

  it("every brand colour yields AA (4.5:1) accents and buttons in both modes", () => {
    for (const b of brands) {
      const p = palette(b);
      expect(worst(p.light.accent, "light"), `${b} light`).toBeGreaterThanOrEqual(4.5);
      expect(worst(p.dark.accent, "dark"), `${b} dark`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.light.accent, p.light.accentText), `${b} light button`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.dark.accent, p.dark.accentText), `${b} dark button`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps a colour that already passes and only adjusts when needed", () => {
    expect(readableAccent("#1a237e", "light")).toEqual({ color: "#1a237e", adjusted: false });
    expect(readableAccent("#1a237e", "dark").adjusted).toBe(true); // navy is too dark on a dark surface
    expect(readableAccent("#ffeb3b", "light").adjusted).toBe(true); // yellow is too light on white
    expect(readableAccent("#ffeb3b", "dark")).toEqual({ color: "#ffeb3b", adjusted: false });
  });

  it("keeps the hue when adjusting", () => {
    const { color } = readableAccent("#ffeb3b", "light");
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b); // still a yellow/olive, not grey or blue
  });

  it("reports raw contrast so the UI can warn", () => {
    const r = contrastReport("#ffeb3b");
    expect(r.onLight).toBeLessThan(4.5);
    expect(r.onDark).toBeGreaterThan(4.5);
    expect(r.buttonLight).toBeGreaterThanOrEqual(4.5);
  });
});

// Brand colour handling with WCAG 2.x contrast maths.
// The brand colour is used for buttons (filled), and for links/outlined buttons (coloured text).
// - Filled buttons: text is black or white, whichever contrasts more. One of the two always reaches 4.5:1.
// - Coloured text: if the brand colour is below 4.5:1 against a surface, a darker (light mode) or lighter
//   (dark mode) shade of the same hue is used instead, so links and time buttons stay readable.

export const SURFACES = {
  light: ["#ffffff", "#f6f7f9"], // card and page backgrounds (app/globals.css)
  dark: ["#181b20", "#0f1114"],
} as const;

export const DEFAULT_BRAND = "#2f5bea";
const AA_TEXT = 4.5;

export function normalizeHex(input: string): string | null {
  const s = input.trim().toLowerCase();
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${h}`;
}

function rgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex);
  if (!h) throw new Error(`Invalid colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16)) as [number, number, number];
}

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever is more readable on `bg`. */
export function textOn(bg: string): "#000000" | "#ffffff" {
  return contrast(bg, "#000000") >= contrast(bg, "#ffffff") ? "#000000" : "#ffffff";
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  if (s === 0) return toHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return toHex(f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255);
}

const worstContrast = (color: string, surfaces: readonly string[]) => Math.min(...surfaces.map((s) => contrast(color, s)));

/** The brand colour, or the nearest shade of its hue that reaches 4.5:1 on every surface of the mode. */
export function readableAccent(brand: string, mode: "light" | "dark"): { color: string; adjusted: boolean } {
  const surfaces = SURFACES[mode];
  const hex = normalizeHex(brand)!;
  if (worstContrast(hex, surfaces) >= AA_TEXT) return { color: hex, adjusted: false };
  const [h, s, l] = rgbToHsl(rgb(hex));
  const step = mode === "light" ? -0.01 : 0.01;
  for (let x = l + step; x >= 0 && x <= 1; x += step) {
    const candidate = hslToHex(h, s, x);
    if (worstContrast(candidate, surfaces) >= AA_TEXT) return { color: candidate, adjusted: true };
  }
  return { color: mode === "light" ? "#000000" : "#ffffff", adjusted: true };
}

export interface BrandPalette {
  brand: string;
  light: { accent: string; accentText: string; adjusted: boolean };
  dark: { accent: string; accentText: string; adjusted: boolean };
}

export interface ContrastReport {
  /** Brand colour as text/outline on the light and dark surfaces (worst case). */
  onLight: number;
  onDark: number;
  /** Button label on a button filled with the (possibly adjusted) accent. */
  buttonLight: number;
  buttonDark: number;
}

export function palette(brand: string): BrandPalette {
  const hex = normalizeHex(brand) ?? DEFAULT_BRAND;
  const l = readableAccent(hex, "light");
  const d = readableAccent(hex, "dark");
  return {
    brand: hex,
    light: { accent: l.color, accentText: textOn(l.color), adjusted: l.adjusted },
    dark: { accent: d.color, accentText: textOn(d.color), adjusted: d.adjusted },
  };
}

export function contrastReport(brand: string): ContrastReport {
  const p = palette(brand);
  return {
    onLight: worstContrast(p.brand, SURFACES.light),
    onDark: worstContrast(p.brand, SURFACES.dark),
    buttonLight: contrast(p.light.accent, p.light.accentText),
    buttonDark: contrast(p.dark.accent, p.dark.accentText),
  };
}

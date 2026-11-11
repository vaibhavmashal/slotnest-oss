// Client-safe email bodies. Every email has a text version. HTML uses inline styles, table layout for the
// button (Outlook), absolute image URLs with explicit width/height, and a light background (email clients'
// dark modes recolour light designs more reliably than dark ones).
import { DateTime } from "luxon";
import { DEFAULT_BRAND, palette } from "@/lib/branding/color";
import { config } from "@/lib/config";
import type { Branding } from "@/lib/branding";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function formatWhen(start: Date, end: Date, timeZone: string): string {
  const s = DateTime.fromJSDate(start).setZone(timeZone);
  const e = DateTime.fromJSDate(end).setZone(timeZone);
  return `${s.toFormat("cccc, d LLLL yyyy")}, ${s.toFormat("HH:mm")}–${e.toFormat("HH:mm")} (${timeZone.replaceAll("_", " ")})`;
}

/** Everything an email needs to look like the account's brand. */
export interface EmailBranding {
  name: string;
  logo: { url: string; width: number; height: number } | null;
  avatarUrl: string | null;
  /** Button fill and its label colour. */
  button: { bg: string; fg: string };
  /** Link colour, readable on white. */
  link: string;
  showPoweredBy: boolean;
}

const LOGO_MAX = { w: 200, h: 56 };

export function emailBranding(b: Branding): EmailBranding {
  const p = palette(b.palette?.brand ?? DEFAULT_BRAND);
  let logo: EmailBranding["logo"] = null;
  if (b.logo) {
    const scale = Math.min(LOGO_MAX.w / b.logo.width, LOGO_MAX.h / b.logo.height, 1);
    logo = { url: b.logo.absolute, width: Math.round(b.logo.width * scale), height: Math.round(b.logo.height * scale) };
  }
  return {
    name: b.name,
    logo,
    avatarUrl: b.avatar?.absolute ?? null,
    button: { bg: p.light.accent, fg: p.light.accentText },
    link: p.light.accent,
    showPoweredBy: b.showPoweredBy,
  };
}

/** Slotnest's own branding, for account emails such as sign-in links. */
export const slotnestBranding: EmailBranding = {
  name: "Slotnest",
  logo: null,
  avatarUrl: null,
  button: { bg: palette(DEFAULT_BRAND).light.accent, fg: palette(DEFAULT_BRAND).light.accentText },
  link: palette(DEFAULT_BRAND).light.accent,
  showPoweredBy: false,
};

interface Section {
  heading: string;
  lines: string[];
  /** Primary call to action, rendered as a button. */
  link?: { label: string; url: string };
  links?: { label: string; url: string }[];
  branding?: EmailBranding;
}

const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function header(b: EmailBranding): string {
  if (b.logo) {
    return `<img src="${esc(b.logo.url)}" width="${b.logo.width}" height="${b.logo.height}" alt="${esc(b.name)}" style="display:block;border:0;outline:none;height:${b.logo.height}px;width:${b.logo.width}px">`;
  }
  const avatar = b.avatarUrl
    ? `<td style="padding-right:10px;vertical-align:middle"><img src="${esc(b.avatarUrl)}" width="40" height="40" alt="" style="display:block;border:0;border-radius:20px;width:40px;height:40px"></td>`
    : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${avatar}<td style="vertical-align:middle;${FONT};font-size:16px;font-weight:600;color:#15171a">${esc(b.name)}</td></tr></table>`;
}

function button(l: { label: string; url: string }, b: EmailBranding): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px"><tr>
<td bgcolor="${b.button.bg}" style="border-radius:8px;background:${b.button.bg}">
<a href="${esc(l.url)}" style="display:inline-block;padding:12px 22px;${FONT};font-size:15px;font-weight:600;color:${b.button.fg};text-decoration:none;border-radius:8px">${esc(l.label)}</a>
</td></tr></table>`;
}

export function render({ heading, lines, link, links, branding }: Section): { text: string; html: string } {
  const b = branding ?? slotnestBranding;
  const all = [...(link ? [link] : []), ...(links ?? [])];
  const text = [
    heading,
    "",
    ...lines,
    ...(all.length ? ["", ...all.map((l) => `${l.label}: ${l.url}`)] : []),
    ...(b.showPoweredBy ? ["", `Powered by Slotnest: ${config.appUrl}`] : []),
  ].join("\n");

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f6f7f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f7f9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e5ea;border-radius:12px">
<tr><td style="padding:24px 28px 0">${header(b)}</td></tr>
<tr><td style="padding:16px 28px 28px;${FONT};font-size:15px;line-height:1.5;color:#15171a">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${esc(heading)}</h1>
${lines.map((l) => `<p style="margin:0 0 8px">${esc(l)}</p>`).join("\n")}
${link ? button(link, b) : ""}
${(links ?? []).map((l) => `<p style="margin:12px 0 0"><a href="${esc(l.url)}" style="color:${b.link}">${esc(l.label)}</a></p>`).join("\n")}
</td></tr></table>
${
  b.showPoweredBy
    ? `<p style="margin:16px 0 0;${FONT};font-size:12px;color:#5d6470">Powered by <a href="${esc(config.appUrl)}/?ref=email" style="color:#5d6470;font-weight:600">Slotnest</a></p>`
    : ""
}
</td></tr></table>
</body></html>`;
  return { text, html };
}

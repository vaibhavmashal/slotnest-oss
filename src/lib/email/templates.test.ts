import { describe, expect, it } from "vitest";
import { emailBranding, render } from "./templates";
import { contrast, palette } from "@/lib/branding/color";
import type { Branding } from "@/lib/branding";

const base: Branding = {
  name: "Acme <Studio>",
  palette: palette("#ffeb3b"),
  logo: { url: "/assets/a.png", absolute: "http://localhost:3100/assets/a.png", width: 800, height: 200 },
  avatar: { url: "/assets/b.jpg", absolute: "http://localhost:3100/assets/b.jpg", width: 400, height: 400 },
  showPoweredBy: true,
};

describe("branded emails", () => {
  it("uses absolute image URLs with explicit, scaled dimensions", () => {
    const { html } = render({ heading: "Booked", lines: ["x"], branding: emailBranding(base) });
    expect(html).toContain('src="http://localhost:3100/assets/a.png" width="200" height="50"');
    expect(html).not.toMatch(/src="\//); // no relative URLs
  });

  it("falls back to profile photo and name when there is no logo, and escapes the name", () => {
    const { html } = render({ heading: "Booked", lines: [], branding: emailBranding({ ...base, logo: null }) });
    expect(html).toContain('src="http://localhost:3100/assets/b.jpg" width="40" height="40"');
    expect(html).toContain("Acme &lt;Studio&gt;");
    expect(html).not.toContain("Acme <Studio>");
  });

  it("renders the call to action as a brand-coloured button with readable text", () => {
    const b = emailBranding(base);
    const { html } = render({ heading: "Booked", lines: [], link: { label: "Reschedule or cancel", url: "https://x.test/b/1?t=a&b" }, branding: b });
    // Same AA-adjusted accent as the booking page (yellow is darkened for white backgrounds), with a readable label.
    expect(contrast(b.button.bg, b.button.fg)).toBeGreaterThanOrEqual(4.5);
    expect(b.button.bg).toBe(palette("#ffeb3b").light.accent);
    expect(html).toContain(`bgcolor="${b.button.bg}"`);
    expect(html).toContain(`color:${b.button.fg}`);
    expect(html).toContain('href="https://x.test/b/1?t=a&amp;b"');
  });

  it("shows Powered by Slotnest unless the account hides it", () => {
    expect(render({ heading: "h", lines: [], branding: emailBranding(base) }).html).toContain("Powered by");
    expect(render({ heading: "h", lines: [], branding: emailBranding(base) }).text).toContain("Powered by Slotnest");
    const hidden = render({ heading: "h", lines: [], branding: emailBranding({ ...base, showPoweredBy: false }) });
    expect(hidden.html).not.toContain("Powered by");
    expect(hidden.text).not.toContain("Powered by");
  });

  it("uses only inline styles (no <style> blocks or classes)", () => {
    const { html } = render({ heading: "h", lines: ["a"], link: { label: "Go", url: "https://x.test" }, branding: emailBranding(base) });
    expect(html).not.toContain("<style");
    expect(html).not.toContain("class=");
  });
});

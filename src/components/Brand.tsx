// Client-safe branding pieces shared by the booking page, manage page and embed.
import type { CSSProperties } from "react";
import type { BrandPalette } from "@/lib/branding/color";

export interface PageBranding {
  palette: BrandPalette | null;
  logo: { url: string; width: number; height: number } | null;
  avatarUrl: string | null;
  showPoweredBy: boolean;
}

/** CSS variables for the brand theme; app/globals.css maps them onto --accent per colour scheme. */
export function brandStyle(b: PageBranding | undefined): CSSProperties | undefined {
  if (!b?.palette) return undefined;
  const p = b.palette;
  return {
    "--brand-light": p.light.accent,
    "--brand-light-text": p.light.accentText,
    "--brand-dark": p.dark.accent,
    "--brand-dark-text": p.dark.accentText,
  } as CSSProperties;
}

export const brandClass = (b: PageBranding | undefined) => (b?.palette ? "branded" : "");

export function HostIdentity({ b, hostName }: { b?: PageBranding; hostName: string }) {
  return (
    <>
      {b?.logo && (
        <img className="brand-logo" src={b.logo.url} alt={hostName} width={b.logo.width} height={b.logo.height} />
      )}
      <div className="host">
        {b?.avatarUrl && <img className="avatar" src={b.avatarUrl} alt="" width={40} height={40} />}
        <p className="muted">{hostName}</p>
      </div>
    </>
  );
}

export function PoweredBy({ b }: { b?: PageBranding }) {
  if (b && !b.showPoweredBy) return null;
  return (
    <p className="powered-by">
      <a href="/?ref=powered-by" target="_blank" rel="noopener">
        Powered by <strong>Slotnest</strong>
      </a>
    </p>
  );
}

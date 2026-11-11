import type { PageBranding } from "@/components/Brand";
import type { Branding } from "./index";

/** Serializable branding for client components (relative image URLs work on every page of this app). */
export const toPageBranding = (b: Branding): PageBranding => ({
  palette: b.palette,
  logo: b.logo && { url: b.logo.url, width: b.logo.width, height: b.logo.height },
  avatarUrl: b.avatar?.url ?? null,
  showPoweredBy: b.showPoweredBy,
});

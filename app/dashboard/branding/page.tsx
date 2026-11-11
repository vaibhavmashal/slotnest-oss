import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventTypes } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { canHidePoweredBy, getBranding } from "@/lib/branding";
import { config } from "@/lib/config";
import { savePoweredBy } from "./actions";
import { BrandColorForm, ImageUpload } from "./BrandingForms";

export default async function BrandingPage() {
  const user = await requireUser();
  const branding = await getBranding(user);
  const canHide = canHidePoweredBy(user);
  const [first] = await db
    .select({ slug: eventTypes.slug })
    .from(eventTypes)
    .where(and(eq(eventTypes.userId, user.id), eq(eventTypes.isActive, true)))
    .orderBy(asc(eventTypes.createdAt))
    .limit(1);

  return (
    <>
      <section className="panel">
        <h2>Branding</h2>
        <p className="muted small">
          Shown on your booking pages, the reschedule/cancel page, the embedded widget and every email invitees receive.{" "}
          {first && (
            <a href={`/${user.username}/${first.slug}`} target="_blank" rel="noopener">
              Preview your booking page
            </a>
          )}
        </p>
        <ImageUpload
          kind="logo"
          label="Logo"
          hint="PNG, JPEG or WebP, up to 1 MB. A wide logo about 400×100 px works best. Use a transparent PNG for dark mode."
          current={branding.logo?.url ?? null}
        />
        <ImageUpload
          kind="avatar"
          label="Profile photo"
          hint="PNG, JPEG or WebP, up to 1 MB. Square, at least 200×200 px. Shown as a circle next to your name."
          current={branding.avatar?.url ?? null}
        />
      </section>

      <section className="panel">
        <h2>Brand colour</h2>
        <p className="muted small">
          Used for buttons, selected dates and links. Button text switches between black and white automatically, and links are
          adjusted if needed to meet WCAG AA contrast (4.5:1) in light and dark mode.
        </p>
        <BrandColorForm current={user.brandColor} />
      </section>

      <section className="panel">
        <h2>“Powered by Slotnest”</h2>
        <form action={savePoweredBy} className="stack">
          <label className="day">
            <input type="checkbox" name="hide" defaultChecked={user.hidePoweredBy && canHide} disabled={!canHide} /> Hide “Powered by
            Slotnest” on my booking pages, widget and emails
          </label>
          {canHide ? (
            <button className="secondary fit small" type="submit">
              Save
            </button>
          ) : (
            <p className="muted small">
              Available on paid plans. <Link href="/dashboard/billing">See plans</Link>
            </p>
          )}
          {!config.stripe && (
            <p className="muted small">
              Billing is off on this server, so this follows UNBILLED_PAID_FEATURES ({config.unbilledPaidFeatures ? "on" : "off"}).
            </p>
          )}
        </form>
      </section>
    </>
  );
}

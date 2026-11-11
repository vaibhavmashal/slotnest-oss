import Link from "next/link";
import { notFound } from "next/navigation";
import { brandClass, brandStyle, HostIdentity, PoweredBy } from "@/components/Brand";
import { getPublicProfile } from "@/lib/booking/service";
import { toPageBranding } from "@/lib/branding/page";
import { contextBranding } from "@/lib/teams";
import { formatPrice } from "@/lib/payments/currencies";

export const dynamic = "force-dynamic";

// `user` is a handle: a username or a team slug (they share one namespace).
type Params = Promise<{ user: string }>;

const LOCATION_LABEL: Record<string, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  phone: "Phone call",
  in_person: "In person",
  custom: "",
};

export async function generateMetadata({ params }: { params: Params }) {
  const profile = await getPublicProfile((await params).user);
  return { title: profile ? `Book a time with ${profile.context.displayName}` : "Not found" };
}

/** Lists a user's or team's bookable event types; hidden ones are only reachable by their own link. */
export default async function ProfilePage({ params }: { params: Params }) {
  const { user } = await params;
  const profile = await getPublicProfile(user);
  if (!profile) notFound();
  const b = toPageBranding(await contextBranding(profile.context));
  return (
    <main className={`booking ${brandClass(b)}`} style={brandStyle(b)}>
      <section className="card confirm profile">
        <HostIdentity b={b} hostName={profile.context.displayName} />
        <h1>Book a time</h1>
        {profile.eventTypes.length === 0 ? (
          <p className="muted">There&apos;s nothing to book here right now.</p>
        ) : (
          <ul className="event-list">
            {profile.eventTypes.map((e) => (
              <li key={e.id}>
                <Link href={`/${profile.context.handle}/${e.slug}`}>
                  <strong>{e.title}</strong>
                  <span className="muted small">
                    {e.durationMinutes} min{LOCATION_LABEL[e.locationKind] ? ` · ${LOCATION_LABEL[e.locationKind]}` : ""}
                    {e.seatsPerSlot > 1 && ` · Group, up to ${e.seatsPerSlot} people`}
                    {e.priceAmount && e.priceCurrency && ` · ${formatPrice(e.priceAmount, e.priceCurrency)}`}
                  </span>
                  {e.description && <span className="muted small desc-line">{e.description}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <PoweredBy b={b} />
    </main>
  );
}

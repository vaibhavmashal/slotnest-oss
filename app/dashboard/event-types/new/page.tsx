import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { ownedTeam } from "@/lib/teams";
import { DEFAULT_REMINDERS } from "@/lib/booking/reminders";
import { paymentsAvailable } from "@/lib/payments";
import EventTypeForm from "../EventTypeForm";
import { teamFormContext } from "../team-context";

export default async function NewEventType({ searchParams }: { searchParams: Promise<{ error?: string; team?: string }> }) {
  const user = await requireUser();
  const { error, team: forTeam } = await searchParams;
  const team = forTeam === "1" ? await ownedTeam(user.id) : null;
  if (forTeam === "1" && !team) redirect("/dashboard/team");
  return (
    <section className="panel">
      <h2>{team ? `New ${team.name} event type` : "New event type"}</h2>
      <EventTypeForm
        error={error}
        payments={paymentsAvailable() ? user.stripeChargesEnabled : null}
        team={team ? await teamFormContext(team) : undefined}
        v={{
          slug: "",
          title: "",
          description: null,
          durationMinutes: 30,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          minimumNoticeMinutes: 240,
          bookingWindowDays: 60,
          maxPerDay: null,
          locationKind: "google_meet",
          locationValue: null,
          isActive: true,
          isHidden: false,
          questions: [],
          redirectUrl: null,
          redirectPassDetails: false,
          seatsPerSlot: 1,
          reminders: DEFAULT_REMINDERS,
          priceAmount: null,
          priceCurrency: null,
          refundOnCancel: true,
        }}
      />
    </section>
  );
}

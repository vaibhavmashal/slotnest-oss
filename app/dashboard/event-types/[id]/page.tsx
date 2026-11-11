import { notFound } from "next/navigation";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { eventTypes } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { ownedTeam } from "@/lib/teams";
import { paymentsAvailable } from "@/lib/payments";
import EventTypeForm from "../EventTypeForm";
import { teamFormContext } from "../team-context";

export default async function EditEventType({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { error } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const team = await ownedTeam(user.id);
  const mine = and(eq(eventTypes.userId, user.id), isNull(eventTypes.teamId));
  const [e] = await db
    .select()
    .from(eventTypes)
    .where(and(eq(eventTypes.id, id), team ? or(mine, eq(eventTypes.teamId, team.id)) : mine));
  if (!e) notFound();
  return (
    <section className="panel">
      <h2>Edit {e.title}</h2>
      <EventTypeForm v={e} error={error} payments={paymentsAvailable() ? user.stripeChargesEnabled : null} team={e.teamId && team ? await teamFormContext(team, e) : undefined} />
    </section>
  );
}

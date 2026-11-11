import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventTypeHosts } from "@/db/schema";
import { teamMemberList, type Team } from "@/lib/teams";
import type { TeamFormContext } from "./EventTypeForm";

/** Members of the team and, for an existing event type, who takes its bookings. */
export async function teamFormContext(
  team: Team,
  eventType?: { id: string; scheduling: string },
): Promise<TeamFormContext> {
  const eventTypeId = eventType?.id;
  const members = await teamMemberList(team.id);
  const hosts = eventTypeId
    ? await db.select({ id: eventTypeHosts.userId }).from(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, eventTypeId))
    : [];
  return {
    name: team.name,
    scheduling: eventType?.scheduling === "collective" ? "collective" : "round_robin",
    members: members.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email })),
    hostIds: eventTypeId ? hosts.map((h) => h.id) : members.map((m) => m.user.id),
  };
}

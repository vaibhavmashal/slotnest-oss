// Liveness and database check for the container healthcheck and uptime monitoring.
import { sql } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await sql`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}

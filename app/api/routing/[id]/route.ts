import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { routingForms, users } from "@/db/schema";
import { RoutingError, submitForm } from "@/lib/routing";
import { hasPaidFeatures } from "@/lib/teams";

/** Submit a routing form: answers in, { redirect } or { message } out. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  const [row] = await db
    .select({ form: routingForms, owner: users })
    .from(routingForms)
    .innerJoin(users, eq(users.id, routingForms.userId))
    .where(and(eq(routingForms.id, id), eq(routingForms.isActive, true)));
  if (!row || !(await hasPaidFeatures(row.owner))) return NextResponse.json({ error: "This form isn't available" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json(await submitForm(row.form, row.owner, body));
  } catch (err) {
    if (err instanceof RoutingError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[routing] submit failed", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

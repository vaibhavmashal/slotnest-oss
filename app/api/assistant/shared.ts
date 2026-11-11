import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { AssistantError, assistantAvailable } from "@/lib/assistant";

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/** Run an assistant request for the signed-in user, turning AssistantError into a 400 with its message. */
export async function handle(fn: (user: User) => Promise<unknown>) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
  if (!assistantAvailable()) return NextResponse.json({ error: "The assistant isn't set up on this server" }, { status: 404 });
  try {
    return NextResponse.json(await fn(user));
  } catch (err) {
    if (err instanceof AssistantError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[assistant]", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

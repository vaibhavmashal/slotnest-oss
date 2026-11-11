import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { handleWebhook } from "@/lib/billing/stripe";

export async function POST(req: NextRequest) {
  if (!config.stripe) return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  try {
    await handleWebhook(await req.text(), sig);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[stripe] webhook failed", err);
    // 400 for bad signatures; other errors make Stripe retry.
    const bad = (err as any)?.type === "StripeSignatureVerificationError";
    return NextResponse.json({ error: bad ? "Invalid signature" : "Webhook error" }, { status: bad ? 400 : 500 });
  }
}

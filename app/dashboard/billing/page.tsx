import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { coveredByTeamSeat } from "@/lib/teams";
import { inTrial, planName } from "@/lib/billing/access";
import { createCheckout, createPortal, describePrice, type Plan } from "@/lib/billing/stripe";
import { config } from "@/lib/config";

async function checkout(form: FormData) {
  "use server";
  const user = await requireUser();
  const plan: Plan = form.get("plan") === "team" ? "team" : "solo";
  const seats = plan === "team" ? Math.min(Math.max(Number(form.get("seats")) || 2, 2), 500) : 1;
  redirect(await createCheckout(user, plan, seats));
}

async function portal() {
  "use server";
  const user = await requireUser();
  if (!user.stripeCustomerId) redirect("/dashboard/billing");
  redirect(await createPortal(user.stripeCustomerId!));
}


export default async function Billing({ searchParams }: { searchParams: Promise<{ success?: string; canceled?: string }> }) {
  const user = await requireUser();
  const q = await searchParams;
  const plan = planName(user);
  const paying = user.billingStatus === "active" || user.billingStatus === "past_due";
  const d = (x: Date | null) => (x ? x.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—");

  if (!config.stripe) {
    return (
      <section className="panel">
        <h2>Billing</h2>
        <p className="muted">
          Billing is turned off on this server (no Stripe keys configured), so every account can take bookings. See SETUP.md to enable
          it.
        </p>
      </section>
    );
  }

  const [soloSetup, soloYearly, teamSetup, teamYearly] = await Promise.all([
    describePrice(config.stripe.prices.solo.setup),
    describePrice(config.stripe.prices.solo.yearly),
    describePrice(config.stripe.prices.team.setup),
    describePrice(config.stripe.prices.team.yearly),
  ]);

  return (
    <>
      {q.success && <p className="notice">Thanks! Your payment went through. It can take a few seconds for the status below to update.</p>}
      {q.canceled && <p className="muted">Checkout was cancelled. Nothing was charged.</p>}
      <section className="panel">
        <h2>Billing</h2>
        <p>
          Plan: <strong>{plan}</strong>
          {inTrial(user) && <> · trial ends {d(user.trialEndsAt)}, then you move to Free unless you choose a plan</>}
          {paying && user.plan === "team" && (
            <>
              {" "}
              · {user.seats} seats{user.bonusSeats > 0 && ` + ${user.bonusSeats} free`}
            </>
          )}
          {user.billingStatus === "canceled" && <> · your subscription was cancelled</>}
        </p>
        {user.billingStatus === "past_due" && <p className="error">Payment overdue: Stripe is retrying the charge. Update your card below.</p>}
        {paying && user.maintenancePaidUntil && <p className="muted">Maintenance paid until {d(user.maintenancePaidUntil)}; renews yearly.</p>}
        {plan === "Free" && (
          <p className="muted">
            Free includes one event type with calendar sync, Google Meet and Zoom, confirmations and reminders. Choose a plan for
            unlimited event types, teams, routing forms, taking payments, webhooks, custom reminder emails and your own branding.
          </p>
        )}
        {!paying && (await coveredByTeamSeat(user.id)) && (
          <p className="muted">You have a seat on a team&apos;s Team plan, which unlocks every feature for your own booking pages too.</p>
        )}
        {user.stripeCustomerId && (
          <form action={portal}>
            <button className="secondary" type="submit">
              Manage payment method and invoices
            </button>
          </form>
        )}
      </section>

      {!paying && (
        <section className="panel">
          <h2>Upgrade</h2>
          <p className="muted small">A one-time setup fee, then a yearly maintenance fee that covers hosting, updates and support.</p>
          <div className="plans">
            <form action={checkout} className="plan">
              <input type="hidden" name="plan" value="solo" />
              <h3>Solo</h3>
              <p>{soloSetup ?? "price not configured"}</p>
              <p>+ {soloYearly ?? "price not configured"}</p>
              <p className="muted small">One user. Unlimited event types, routing forms, taking payments, webhooks, custom reminder emails and your own branding.</p>
              <button className="primary" type="submit" disabled={!soloSetup || !soloYearly}>
                Buy Solo
              </button>
            </form>
            <form action={checkout} className="plan">
              <input type="hidden" name="plan" value="team" />
              <h3>Team</h3>
              <p>{teamSetup ?? "price not configured"} per seat</p>
              <p>+ {teamYearly ?? "price not configured"} per seat</p>
              <p className="muted small">Everything in Solo for your team: one shared link, round-robin and collective meetings.</p>
              <label className="small">
                Seats <input name="seats" type="number" min={2} max={500} defaultValue={2} />
              </label>
              <button className="primary" type="submit" disabled={!teamSetup || !teamYearly}>
                Buy Team
              </button>
            </form>
          </div>
        </section>
      )}
    </>
  );
}

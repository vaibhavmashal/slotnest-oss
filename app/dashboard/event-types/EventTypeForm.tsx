import type { BookingQuestion, Reminder } from "@/db/schema";
import { saveEventType } from "../actions";
import QuestionsEditor from "./QuestionsEditor";
import RemindersEditor from "./RemindersEditor";
import TitleSlugFields from "./TitleSlugFields";
import { CURRENCIES } from "@/lib/payments/currencies";

export interface EventTypeValues {
  id?: string;
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  bookingWindowDays: number;
  maxPerDay: number | null;
  locationKind: string;
  locationValue: string | null;
  isActive: boolean;
  isHidden: boolean;
  questions: BookingQuestion[];
  redirectUrl: string | null;
  redirectPassDetails: boolean;
  seatsPerSlot: number;
  reminders: Reminder[];
  priceAmount: number | null;
  priceCurrency: string | null;
  refundOnCancel: boolean;
}

/** Present for a team (round-robin) event type. */
export interface TeamFormContext {
  name: string;
  scheduling: "round_robin" | "collective";
  members: { id: string; name: string; email: string }[];
  hostIds: string[];
}

const ERRORS: Record<string, string> = {
  title: "Please enter a title.",
  slug: "The URL slug can use lowercase letters, numbers and hyphens.",
  "slug-taken": "That URL slug is already used by another event type.",
  hosts: "Choose at least one team member to take these bookings.",
  "no-team": "Create a team first (Team page).",
  questions: "Please check the booking questions: each dropdown needs at least one option.",
  redirect: "The page to show after booking must be a full https:// address.",
  reminders: "Please check the reminders: each can be sent up to 30 days before or after the meeting.",
  price: "Please enter a price like 50 or 49.99 (at least the equivalent of about 0.50 USD).",
  "price-account": "Connect your Stripe account (Overview → Payments) before charging for bookings.",
  "plan-limit": "The Free plan includes one active event type. Switch another off first, or upgrade on the Billing page.",
  "plan-price": "Charging for bookings is part of the paid plans. Upgrade on the Billing page.",
  "plan-reminders": "Custom reminder wording is part of the paid plans. Leave the subject and message empty to send the standard reminder, or upgrade on the Billing page.",
};

export default function EventTypeForm({
  v,
  error,
  team,
  payments,
}: {
  v: EventTypeValues;
  error?: string;
  team?: TeamFormContext;
  /** Whether the account owner's Stripe account can take payments (null: payments aren't set up on this server). */
  payments: boolean | null;
}) {
  return (
    <form action={saveEventType} className="stack">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      {team && <input type="hidden" name="team" value="1" />}
      {error && <p className="error">{ERRORS[error] ?? "Please check the form."}</p>}
      <TitleSlugFields title={v.title} slug={v.slug} isNew={!v.id} />
      <label>
        Description
        <textarea name="description" rows={3} defaultValue={v.description ?? ""} />
      </label>
      <div className="grid3">
        <label>
          Duration (min)
          <input name="durationMinutes" type="number" min={5} max={720} defaultValue={v.durationMinutes} />
        </label>
        <label>
          Buffer before (min)
          <input name="bufferBeforeMinutes" type="number" min={0} max={240} defaultValue={v.bufferBeforeMinutes} />
        </label>
        <label>
          Buffer after (min)
          <input name="bufferAfterMinutes" type="number" min={0} max={240} defaultValue={v.bufferAfterMinutes} />
        </label>
        <label>
          Minimum notice (hours)
          <input name="minimumNoticeHours" type="number" min={0} max={1440} defaultValue={Math.round(v.minimumNoticeMinutes / 60)} />
        </label>
        <label>
          Bookable up to (days ahead)
          <input name="bookingWindowDays" type="number" min={1} max={730} defaultValue={v.bookingWindowDays} />
        </label>
        <label>
          Max per day (blank = no limit)
          <input name="maxPerDay" type="number" min={1} max={100} defaultValue={v.maxPerDay ?? ""} />
        </label>
        {!team && (
          <label>
            People per time slot (1 = one-on-one)
            <input name="seatsPerSlot" type="number" min={1} max={500} defaultValue={v.seatsPerSlot} />
          </label>
        )}
      </div>
      <div className="grid3">
        <label>
          Location
          <select name="locationKind" defaultValue={v.locationKind}>
            <option value="google_meet">Google Meet (needs Google Calendar connected)</option>
            <option value="zoom">Zoom (needs Zoom connected)</option>
            <option value="phone">Phone call</option>
            <option value="in_person">In person</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="span2">
          Location details (phone number, address or link)
          <input name="locationValue" defaultValue={v.locationValue ?? ""} maxLength={500} />
        </label>
      </div>
      {team && (
        <fieldset className="stack">
          <legend>Team hosts</legend>
          <label className="day">
            <input type="radio" name="scheduling" value="round_robin" defaultChecked={team.scheduling === "round_robin"} /> Round-robin:
            each booking goes to one member, whoever is free and has had the fewest bookings of this event in the last 30 days
          </label>
          <label className="day">
            <input type="radio" name="scheduling" value="collective" defaultChecked={team.scheduling === "collective"} /> Collective:
            every member below joins each meeting, so only times they&apos;re all free are offered
          </label>
          <p className="muted small">
            Each member&apos;s own weekly hours, date overrides and calendars apply. Buffers and the daily limit apply per member.
            Changing this affects new bookings only.
          </p>
          {team.members.map((m) => (
            <label className="day" key={m.id}>
              <input type="checkbox" name="host" value={m.id} defaultChecked={team.hostIds.includes(m.id)} /> {m.name}{" "}
              <span className="muted small">{m.email}</span>
            </label>
          ))}
        </fieldset>
      )}
      {payments !== null && (
        <fieldset className="stack">
          <legend>Payment</legend>
          <div className="grid3">
            <label>
              Price (blank = free)
              <input name="price" inputMode="decimal" placeholder="e.g. 50" defaultValue={v.priceAmount ? (v.priceAmount / 100).toFixed(2) : ""} />
            </label>
            <label>
              Currency
              <select name="priceCurrency" defaultValue={v.priceCurrency ?? "usd"}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="day">
            <input type="checkbox" name="refundOnCancel" defaultChecked={v.refundOnCancel} /> Refund automatically when a paid booking is cancelled
          </label>
          <p className="muted small">
            {payments
              ? "People pay with Stripe when they book; the money goes to your Stripe account. Slotnest takes no cut (Stripe's own fees apply)."
              : "To charge for bookings, first connect your Stripe account under Overview → Payments."}
          </p>
        </fieldset>
      )}
      <QuestionsEditor initial={v.questions} />
      <RemindersEditor initial={v.reminders} />
      <fieldset className="stack">
        <legend>After booking</legend>
        <label>
          Send people to your own page (optional)
          <input name="redirectUrl" type="url" placeholder="https://at20.ai/thank-you" defaultValue={v.redirectUrl ?? ""} maxLength={2000} />
        </label>
        <p className="muted small">Leave blank to show Slotnest&apos;s confirmation. Works in embeds too.</p>
        <label className="day">
          <input type="checkbox" name="redirectPassDetails" defaultChecked={v.redirectPassDetails} /> Add the invitee&apos;s name,
          email and meeting time to that address, so your page can greet them
        </label>
      </fieldset>
      <label className="day">
        <input type="checkbox" name="isActive" defaultChecked={v.isActive} /> Accepting bookings
      </label>
      <label className="day">
        <input type="checkbox" name="isHidden" defaultChecked={v.isHidden} /> Hidden: only people with the link can book; it isn&apos;t
        listed on your public page
      </label>
      <button className="primary fit" type="submit">
        Save
      </button>
    </form>
  );
}

// Typed mirror of db/migrations/*.sql for Drizzle queries. The SQL files are the source of truth
// (the exclusion constraint on bookings can't be expressed in Drizzle's schema builder).
import {
  bigint,
  boolean,
  customType,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** A question an event type asks invitees (see lib/booking/questions). */
export interface BookingQuestion {
  id: string;
  label: string;
  type: "text" | "textarea" | "phone" | "select";
  required: boolean;
  options?: string[];
}
/** A reminder or follow-up email an event type sends (see lib/booking/reminders). */
export interface Reminder {
  id: string;
  /** "before" the start, or "after" the end. */
  when: "before" | "after";
  minutes: number;
  to: "invitee" | "host";
  /** Custom wording; the built-in email is used without them. */
  subject?: string;
  body?: string;
}
/** An invitee's answer, keeping the question's label as it was when they booked. */
export interface BookingAnswer {
  id: string;
  label: string;
  value: string;
}

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const locationKind = pgEnum("location_kind", ["google_meet", "zoom", "phone", "in_person", "custom"]);
export const bookingStatus = pgEnum("booking_status", ["confirmed", "cancelled", "rescheduled"]);
export const calendarProvider = pgEnum("calendar_provider", ["google", "microsoft", "zoom"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  timeZone: text("time_zone").notNull(),
  plan: text("plan").$type<"solo" | "team">().notNull().default("solo"),
  seats: integer("seats").notNull().default(1),
  /** Free seats granted on the admin page, on top of the paid `seats` (which Stripe keeps in sync). */
  bonusSeats: integer("bonus_seats").notNull().default(0),
  /** Set on the admin page: booking pages are off until an admin restores the account. */
  suspendedAt: tstz("suspended_at"),
  billingStatus: text("billing_status").$type<"free" | "trialing" | "active" | "past_due" | "canceled">().notNull().default("free"),
  trialEndsAt: tstz("trial_ends_at").notNull(),
  maintenancePaidUntil: tstz("maintenance_paid_until"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  brandColor: text("brand_color"),
  logoAssetId: uuid("logo_asset_id"),
  avatarAssetId: uuid("avatar_asset_id"),
  hidePoweredBy: boolean("hide_powered_by").notNull().default(false),
  /** Connected Stripe account for taking payment for bookings (see lib/payments). */
  stripeAccountId: text("stripe_account_id").unique(),
  stripeChargesEnabled: boolean("stripe_charges_enabled").notNull().default(false),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  kind: text("kind").$type<"logo" | "avatar">().notNull(),
  contentType: text("content_type").$type<"image/png" | "image/jpeg" | "image/webp">().notNull(),
  byteSize: integer("byte_size").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  sha256: text("sha256").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const loginTokens = pgTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: tstz("expires_at").notNull(),
  usedAt: tstz("used_at"),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  idHash: text("id_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  expiresAt: tstz("expires_at").notNull(),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: tstz("received_at").notNull().defaultNow(),
});

export const schedules = pgTable("schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const availabilityRules = pgTable("availability_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  scheduleId: uuid("schedule_id").notNull().references(() => schedules.id),
  weekday: smallint("weekday").notNull(),
  startMinute: smallint("start_minute").notNull(),
  endMinute: smallint("end_minute").notNull(),
});

export const dateOverrides = pgTable("date_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  scheduleId: uuid("schedule_id").notNull().references(() => schedules.id),
  date: date("date", { mode: "string" }).notNull(),
  startMinute: smallint("start_minute"),
  endMinute: smallint("end_minute"),
});

export const eventTypes = pgTable("event_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  /** Null for team event types: each host's default schedule applies. */
  scheduleId: uuid("schedule_id").references(() => schedules.id),
  teamId: uuid("team_id").references(() => teams.id),
  scheduling: text("scheduling").$type<"personal" | "round_robin" | "collective">().notNull().default("personal"),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  durationMinutes: smallint("duration_minutes").notNull(),
  slotIntervalMinutes: smallint("slot_interval_minutes"),
  bufferBeforeMinutes: smallint("buffer_before_minutes").notNull().default(0),
  bufferAfterMinutes: smallint("buffer_after_minutes").notNull().default(0),
  minimumNoticeMinutes: integer("minimum_notice_minutes").notNull().default(240),
  bookingWindowDays: smallint("booking_window_days").notNull().default(60),
  maxPerDay: smallint("max_per_day"),
  locationKind: locationKind("location_kind").notNull().default("google_meet"),
  locationValue: text("location_value"),
  isActive: boolean("is_active").notNull().default(true),
  questions: jsonb("questions").$type<BookingQuestion[]>().notNull().default([]),
  isHidden: boolean("is_hidden").notNull().default(false),
  redirectUrl: text("redirect_url"),
  redirectPassDetails: boolean("redirect_pass_details").notNull().default(false),
  /** 1 = one-on-one; more = a group event where that many invitees can book the same slot. */
  seatsPerSlot: smallint("seats_per_slot").notNull().default(1),
  /** Price in the currency's smallest unit; null = free. Paid to the account owner's connected Stripe account. */
  priceAmount: integer("price_amount"),
  priceCurrency: text("price_currency"),
  refundOnCancel: boolean("refund_on_cancel").notNull().default(true),
  // Default as in migration 0009 (and DEFAULT_REMINDERS): 24 hours and 1 hour before, to the invitee.
  reminders: jsonb("reminders")
    .$type<Reminder[]>()
    .notNull()
    .default([
      { id: "r24h", when: "before", minutes: 1440, to: "invitee" },
      { id: "r1h", when: "before", minutes: 60, to: "invitee" },
    ]),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id").notNull().references(() => teams.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: text("role").$type<"owner" | "member">().notNull().default("member"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export const teamInvites = pgTable("team_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => users.id),
  expiresAt: tstz("expires_at").notNull(),
  acceptedAt: tstz("accepted_at"),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const eventTypeHosts = pgTable(
  "event_type_hosts",
  {
    eventTypeId: uuid("event_type_id").notNull().references(() => eventTypes.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventTypeId, t.userId] })],
);

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventTypeId: uuid("event_type_id").notNull().references(() => eventTypes.id),
  hostId: uuid("host_id").notNull().references(() => users.id),
  icalUid: text("ical_uid").notNull().unique(),
  icalSequence: integer("ical_sequence").notNull().default(0),
  startAt: tstz("start_at").notNull(),
  endAt: tstz("end_at").notNull(),
  status: bookingStatus("status").notNull().default("confirmed"),
  inviteeName: text("invitee_name").notNull(),
  inviteeEmail: text("invitee_email").notNull(),
  inviteeTimeZone: text("invitee_time_zone").notNull(),
  notes: text("notes"),
  meetingUrl: text("meeting_url"),
  externalEventId: text("external_event_id"),
  manageTokenHash: text("manage_token_hash").notNull(),
  manageTokenEnc: bytea("manage_token_enc"),
  rescheduledFromId: uuid("rescheduled_from_id"),
  cancelReason: text("cancel_reason"),
  externalConnectionId: uuid("external_connection_id"),
  videoConnectionId: uuid("video_connection_id"),
  videoMeetingId: text("video_meeting_id"),
  answers: jsonb("answers").$type<BookingAnswer[]>().notNull().default([]),
  /** Group events: bookings in the same slot share this key (see sessionKey in lib/booking/service). */
  sessionKey: text("session_key"),
  /** "pending" holds the slot while the invitee pays; side effects wait for "paid" (or "none" when free). */
  paymentStatus: text("payment_status").$type<"none" | "pending" | "paid" | "refunded" | "expired">().notNull().default("none"),
  paymentAmount: integer("payment_amount"),
  paymentCurrency: text("payment_currency"),
  paymentExpiresAt: tstz("payment_expires_at"),
  stripeAccountId: text("stripe_account_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  createdAt: tstz("created_at").notNull().defaultNow(),
  cancelledAt: tstz("cancelled_at"),
});

/** Every host of every booking (see migration 0006). Rows for the organizer are created by a trigger. */
export const bookingHosts = pgTable(
  "booking_hosts",
  {
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    hostId: uuid("host_id").notNull().references(() => users.id),
    startAt: tstz("start_at").notNull(),
    endAt: tstz("end_at").notNull(),
    status: bookingStatus("status").notNull(),
    externalEventId: text("external_event_id"),
    externalConnectionId: uuid("external_connection_id"),
    sessionKey: text("session_key"),
  },
  (t) => [primaryKey({ columns: [t.bookingId, t.hostId] })],
);

export const calendarConnections = pgTable("calendar_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  provider: calendarProvider("provider").notNull(),
  accountEmail: text("account_email").notNull(),
  accessTokenEnc: bytea("access_token_enc").notNull(),
  refreshTokenEnc: bytea("refresh_token_enc").notNull(),
  tokenExpiresAt: tstz("token_expires_at").notNull(),
  scopes: text("scopes").array().notNull(),
  checkForConflicts: boolean("check_for_conflicts").notNull().default(true),
  isWriteTarget: boolean("is_write_target").notNull().default(false),
  calendarId: text("calendar_id").notNull().default("primary"),
  lastError: text("last_error"),
  lastErrorAt: tstz("last_error_at"),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  url: text("url").notNull(),
  secretEnc: bytea("secret_enc").notNull(),
  events: text("events").array().$type<WebhookEvent[]>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastStatus: integer("last_status"),
  lastError: text("last_error"),
  lastDeliveredAt: tstz("last_delivered_at"),
  createdAt: tstz("created_at").notNull().defaultNow(),
});
export type WebhookEvent = "booking.created" | "booking.rescheduled" | "booking.cancelled";

/** Where a routing form sends someone (see lib/routing). */
export type RouteTarget = { type: "event"; eventTypeId: string } | { type: "url"; url: string } | { type: "message"; text: string };
/** One routing rule: if the answer to `questionId` matches, go to `target`. */
export interface RoutingRule {
  id: string;
  questionId: string;
  op: "is" | "is_not" | "contains";
  value: string;
  target: RouteTarget;
}

export const routingForms = pgTable("routing_forms", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  questions: jsonb("questions").$type<BookingQuestion[]>().notNull().default([]),
  routes: jsonb("routes").$type<RoutingRule[]>().notNull().default([]),
  fallback: jsonb("fallback").$type<RouteTarget>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const routingSubmissions = pgTable("routing_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  formId: uuid("form_id").notNull().references(() => routingForms.id),
  inviteeName: text("invitee_name").notNull(),
  inviteeEmail: text("invitee_email").notNull(),
  answers: jsonb("answers").$type<BookingAnswer[]>().notNull().default([]),
  routedTo: text("routed_to").notNull(),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

/** A change the assistant proposed; nothing happens until the user confirms it (see lib/assistant). */
export interface AssistantAction {
  /** The tool_use id that proposed it. */
  id: string;
  kind: "cancel_meeting" | "create_event_type";
  params: Record<string, unknown>;
  summary: string;
  status: "pending" | "done" | "dismissed" | "failed";
  result?: string;
}

export const assistantConversations = pgTable("assistant_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  /** The Messages API history (Anthropic.Beta.BetaMessageParam[]), append-only. */
  messages: jsonb("messages").$type<unknown[]>().notNull().default([]),
  actions: jsonb("actions").$type<AssistantAction[]>().notNull().default([]),
  pendingNote: text("pending_note"),
  createdAt: tstz("created_at").notNull().defaultNow(),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
});

export const assistantUsage = pgTable(
  "assistant_usage",
  {
    userId: uuid("user_id").notNull().references(() => users.id),
    day: date("day", { mode: "string" }).notNull(),
    requests: integer("requests").notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

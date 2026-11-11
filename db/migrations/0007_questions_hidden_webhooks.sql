-- Custom booking questions, hidden event types, a redirect after booking, and outgoing webhooks.

-- [{ id, label, type: "text" | "textarea" | "phone" | "select", required, options? }], at most 10 (checked in the app).
ALTER TABLE event_types ADD COLUMN questions jsonb NOT NULL DEFAULT '[]';
-- Hidden event types work by direct link but aren't listed on the public profile page.
ALTER TABLE event_types ADD COLUMN is_hidden boolean NOT NULL DEFAULT false;
-- After booking, send the invitee here (https only); optionally with their name, email and the meeting time.
ALTER TABLE event_types ADD COLUMN redirect_url text;
ALTER TABLE event_types ADD COLUMN redirect_pass_details boolean NOT NULL DEFAULT false;

-- The invitee's answers, with each question's label as it was when they booked: [{ id, label, value }].
ALTER TABLE bookings ADD COLUMN answers jsonb NOT NULL DEFAULT '[]';

-- A user's webhook endpoints. They fire for bookings of event types the user owns and meetings the user hosts.
CREATE TABLE webhooks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url                text NOT NULL,
  -- HMAC-SHA256 signing secret, encrypted like OAuth tokens (we need it back to sign).
  secret_enc         bytea NOT NULL,
  events             text[] NOT NULL,
  is_active          boolean NOT NULL DEFAULT true,
  last_status        integer,
  last_error         text,
  last_delivered_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhooks_user ON webhooks (user_id);

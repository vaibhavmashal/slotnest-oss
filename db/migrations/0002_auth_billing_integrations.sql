-- Host sign-in (magic link), billing state, Zoom connections, and calendar write details.

ALTER TABLE users
  ADD COLUMN plan text NOT NULL DEFAULT 'solo' CHECK (plan IN ('solo', 'team')),
  ADD COLUMN seats integer NOT NULL DEFAULT 1 CHECK (seats > 0),
  ADD COLUMN billing_status text NOT NULL DEFAULT 'trialing'
    CHECK (billing_status IN ('trialing', 'active', 'past_due', 'canceled')),
  ADD COLUMN trial_ends_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  ADD COLUMN maintenance_paid_until timestamptz,
  ADD COLUMN stripe_customer_id text UNIQUE,
  ADD COLUMN stripe_subscription_id text UNIQUE;

CREATE TABLE login_tokens (
  token_hash  text PRIMARY KEY,
  email       text NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id_hash     text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Zoom is a video provider, not a calendar; it shares the token storage.
ALTER TYPE calendar_provider ADD VALUE IF NOT EXISTS 'zoom';
ALTER TABLE calendar_connections
  ADD COLUMN calendar_id text NOT NULL DEFAULT 'primary',
  ADD COLUMN last_error text,
  ADD COLUMN last_error_at timestamptz;

ALTER TABLE bookings
  ADD COLUMN external_connection_id uuid REFERENCES calendar_connections(id) ON DELETE SET NULL,
  ADD COLUMN video_connection_id uuid REFERENCES calendar_connections(id) ON DELETE SET NULL,
  ADD COLUMN video_meeting_id text;

-- Stripe webhook idempotency.
CREATE TABLE stripe_events (
  id          text PRIMARY KEY,
  type        text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

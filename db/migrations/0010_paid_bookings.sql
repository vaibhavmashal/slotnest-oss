-- Paid bookings: hosts connect their own Stripe account (Connect, direct charges), set a price on an event type,
-- and invitees pay with Stripe Checkout before the booking is confirmed.

-- The host's connected Stripe account, and whether Stripe lets it take payments yet.
ALTER TABLE users ADD COLUMN stripe_account_id text UNIQUE;
ALTER TABLE users ADD COLUMN stripe_charges_enabled boolean NOT NULL DEFAULT false;

-- Price in the currency's smallest unit (cents); null = free.
ALTER TABLE event_types ADD COLUMN price_amount integer CHECK (price_amount IS NULL OR price_amount > 0);
ALTER TABLE event_types ADD COLUMN price_currency text;
-- Give the money back automatically when a paid booking is cancelled.
ALTER TABLE event_types ADD COLUMN refund_on_cancel boolean NOT NULL DEFAULT true;

-- A paid booking holds its time while the invitee pays: it's 'confirmed' (so the overlap constraints keep the slot)
-- with payment_status 'pending' until Checkout completes. Unpaid holds are cancelled when payment_expires_at passes.
-- Emails, calendar events and webhooks only happen once payment_status is 'paid' (or 'none' for free events).
ALTER TABLE bookings ADD COLUMN payment_status text NOT NULL DEFAULT 'none'
  CHECK (payment_status IN ('none', 'pending', 'paid', 'refunded', 'expired'));
ALTER TABLE bookings ADD COLUMN payment_amount integer;
ALTER TABLE bookings ADD COLUMN payment_currency text;
ALTER TABLE bookings ADD COLUMN payment_expires_at timestamptz;
-- The connected account the payment went to, and the Checkout Session / PaymentIntent on it.
ALTER TABLE bookings ADD COLUMN stripe_account_id text;
ALTER TABLE bookings ADD COLUMN stripe_checkout_session_id text UNIQUE;
ALTER TABLE bookings ADD COLUMN stripe_payment_intent_id text;
CREATE INDEX bookings_payment_pending ON bookings (payment_expires_at) WHERE payment_status = 'pending';

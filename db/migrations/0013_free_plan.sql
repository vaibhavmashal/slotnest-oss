-- The Free plan (see src/lib/billing/access.ts): new accounts start on 'free' instead of a 14-day trial. Trials that
-- have already ended become Free; running trials keep going until their end date.
ALTER TABLE users DROP CONSTRAINT users_billing_status_check;
ALTER TABLE users ADD CONSTRAINT users_billing_status_check
  CHECK (billing_status IN ('free', 'trialing', 'active', 'past_due', 'canceled'));
ALTER TABLE users ALTER COLUMN billing_status SET DEFAULT 'free';
UPDATE users SET billing_status = 'free' WHERE billing_status = 'trialing' AND trial_ends_at <= now();

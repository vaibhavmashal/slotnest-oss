-- Admin controls (see src/lib/admin). Bonus seats are free seats an admin grants on top of the paid ones; Stripe only
-- ever writes `seats`, so it can't overwrite them. A suspended account's booking pages are off whatever its billing says.
ALTER TABLE users
  ADD COLUMN bonus_seats integer NOT NULL DEFAULT 0 CHECK (bonus_seats >= 0),
  ADD COLUMN suspended_at timestamptz;

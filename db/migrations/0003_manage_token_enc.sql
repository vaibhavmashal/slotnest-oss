-- Background jobs (reminders, reschedule notices) need the manage link, so keep an encrypted copy of the token.
-- The hash stays the lookup/verification value.
ALTER TABLE bookings ADD COLUMN manage_token_enc bytea;

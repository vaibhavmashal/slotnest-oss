-- Group events: several invitees can book the same time slot of an event type (a class, webinar or group demo).
-- Each invitee is still their own booking; bookings that share a slot share a session_key and one calendar event.

-- 1 = one-on-one (every existing event type). Group events are personal event types only (checked in the app).
ALTER TABLE event_types ADD COLUMN seats_per_slot smallint NOT NULL DEFAULT 1 CHECK (seats_per_slot BETWEEN 1 AND 500);

-- "{event_type_id}:{start ISO}" for group bookings; null for one-on-one, round-robin and collective bookings.
ALTER TABLE bookings ADD COLUMN session_key text;
ALTER TABLE booking_hosts ADD COLUMN session_key text;
CREATE INDEX bookings_session ON bookings (session_key) WHERE session_key IS NOT NULL;

-- A host still can't be in two overlapping confirmed meetings, except bookings in the same group session.
-- Bookings without a session use their own id as the key, so they conflict with everything that overlaps.
ALTER TABLE bookings DROP CONSTRAINT bookings_no_overlap;
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
  host_id WITH =,
  tstzrange(start_at, end_at, '[)') WITH &&,
  (COALESCE(session_key, id::text)) WITH <>
) WHERE (status = 'confirmed');

ALTER TABLE booking_hosts DROP CONSTRAINT booking_hosts_no_overlap;
ALTER TABLE booking_hosts ADD CONSTRAINT booking_hosts_no_overlap EXCLUDE USING gist (
  host_id WITH =,
  tstzrange(start_at, end_at, '[)') WITH &&,
  (COALESCE(session_key, booking_id::text)) WITH <>
) WHERE (status = 'confirmed');

-- booking_hosts copies session_key along with the times and status.
CREATE OR REPLACE FUNCTION booking_hosts_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO booking_hosts (booking_id, host_id, start_at, end_at, status, session_key)
    VALUES (NEW.id, NEW.host_id, NEW.start_at, NEW.end_at, NEW.status, NEW.session_key);
  ELSIF (NEW.start_at, NEW.end_at, NEW.status, NEW.session_key) IS DISTINCT FROM (OLD.start_at, OLD.end_at, OLD.status, OLD.session_key) THEN
    UPDATE booking_hosts SET start_at = NEW.start_at, end_at = NEW.end_at, status = NEW.status, session_key = NEW.session_key
    WHERE booking_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER bookings_hosts_sync ON bookings;
CREATE TRIGGER bookings_hosts_sync AFTER INSERT OR UPDATE OF start_at, end_at, status, session_key ON bookings
  FOR EACH ROW EXECUTE FUNCTION booking_hosts_sync();

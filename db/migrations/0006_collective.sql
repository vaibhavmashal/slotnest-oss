-- Collective event types: one meeting with every chosen team member, at a time they're all free.

-- Every host of every booking. bookings.host_id stays the organizer (the only host for personal and
-- round-robin bookings); collective bookings add a row per extra host. Times and status are copied from
-- bookings by triggers so the exclusion constraint below can guard all of a host's meetings at once.
CREATE TABLE booking_hosts (
  booking_id              uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  host_id                 uuid NOT NULL REFERENCES users(id),
  start_at                timestamptz NOT NULL,
  end_at                  timestamptz NOT NULL,
  status                  booking_status NOT NULL,
  -- The event on this host's own calendar. The organizer's lives on bookings (external_event_id).
  external_event_id       text,
  external_connection_id  uuid REFERENCES calendar_connections(id) ON DELETE SET NULL,
  PRIMARY KEY (booking_id, host_id),
  -- A host can't be in two confirmed meetings at once, whether as organizer or as a collective member.
  CONSTRAINT booking_hosts_no_overlap EXCLUDE USING gist (
    host_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status = 'confirmed')
);
CREATE INDEX booking_hosts_host_start ON booking_hosts (host_id, start_at);

INSERT INTO booking_hosts (booking_id, host_id, start_at, end_at, status)
SELECT id, host_id, start_at, end_at, status FROM bookings;

CREATE FUNCTION booking_hosts_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO booking_hosts (booking_id, host_id, start_at, end_at, status)
    VALUES (NEW.id, NEW.host_id, NEW.start_at, NEW.end_at, NEW.status);
  ELSIF (NEW.start_at, NEW.end_at, NEW.status) IS DISTINCT FROM (OLD.start_at, OLD.end_at, OLD.status) THEN
    UPDATE booking_hosts SET start_at = NEW.start_at, end_at = NEW.end_at, status = NEW.status WHERE booking_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER bookings_hosts_sync AFTER INSERT OR UPDATE OF start_at, end_at, status ON bookings
  FOR EACH ROW EXECUTE FUNCTION booking_hosts_sync();

ALTER TABLE event_types DROP CONSTRAINT event_types_scheduling_check;
ALTER TABLE event_types ADD CONSTRAINT event_types_scheduling_check
  CHECK (scheduling IN ('personal', 'round_robin', 'collective'));

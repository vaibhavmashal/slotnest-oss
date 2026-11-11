-- Initial schema. All instants are timestamptz (stored UTC); wall-clock availability is minutes-since-midnight
-- interpreted in the schedule's IANA time zone.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  username    text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9-]{1,38}$'),
  time_zone   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  time_zone   text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX schedules_one_default_per_user ON schedules (user_id) WHERE is_default;

CREATE TABLE availability_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  weekday       smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- ISO, 1 = Monday
  start_minute  smallint NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute    smallint NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  CHECK (start_minute < end_minute)
);
CREATE INDEX availability_rules_schedule ON availability_rules (schedule_id);

-- A date with override rows replaces the weekly rules for that date.
-- A row with NULL start/end marks the whole date unavailable.
CREATE TABLE date_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  date          date NOT NULL,
  start_minute  smallint CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute    smallint CHECK (end_minute BETWEEN 1 AND 1440),
  CHECK ((start_minute IS NULL AND end_minute IS NULL) OR (start_minute < end_minute))
);
CREATE INDEX date_overrides_schedule_date ON date_overrides (schedule_id, date);

CREATE TYPE location_kind AS ENUM ('google_meet', 'zoom', 'phone', 'in_person', 'custom');

CREATE TABLE event_types (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule_id             uuid NOT NULL REFERENCES schedules(id),
  slug                    text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  title                   text NOT NULL,
  description             text,
  duration_minutes        smallint NOT NULL CHECK (duration_minutes BETWEEN 5 AND 720),
  slot_interval_minutes   smallint CHECK (slot_interval_minutes BETWEEN 5 AND 720),
  buffer_before_minutes   smallint NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes    smallint NOT NULL DEFAULT 0 CHECK (buffer_after_minutes >= 0),
  minimum_notice_minutes  integer  NOT NULL DEFAULT 240 CHECK (minimum_notice_minutes >= 0),
  booking_window_days     smallint NOT NULL DEFAULT 60 CHECK (booking_window_days BETWEEN 1 AND 730),
  max_per_day             smallint CHECK (max_per_day > 0),
  location_kind           location_kind NOT NULL DEFAULT 'google_meet',
  location_value          text,
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

CREATE TYPE booking_status AS ENUM ('confirmed', 'cancelled', 'rescheduled');

CREATE TABLE bookings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type_id         uuid NOT NULL REFERENCES event_types(id),
  host_id               uuid NOT NULL REFERENCES users(id),
  ical_uid              text NOT NULL UNIQUE,           -- stable across reschedules of the same meeting
  ical_sequence         integer NOT NULL DEFAULT 0,     -- bumped on every update sent to attendees
  start_at              timestamptz NOT NULL,
  end_at                timestamptz NOT NULL,
  status                booking_status NOT NULL DEFAULT 'confirmed',
  invitee_name          text NOT NULL,
  invitee_email         text NOT NULL,
  invitee_time_zone     text NOT NULL,
  notes                 text,
  meeting_url           text,
  external_event_id     text,                           -- id of the event written to the host's calendar
  manage_token_hash     text NOT NULL,                  -- sha256 of the reschedule/cancel token; raw token only in emails
  rescheduled_from_id   uuid REFERENCES bookings(id),
  cancel_reason         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  cancelled_at          timestamptz,
  CHECK (start_at < end_at),
  -- Hard guarantee against double booking: no two confirmed bookings for a host may overlap.
  -- Concurrent inserts race on this constraint; the loser gets SQLSTATE 23P01.
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    host_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status = 'confirmed')
);
CREATE INDEX bookings_host_start ON bookings (host_id, start_at);

CREATE TYPE calendar_provider AS ENUM ('google', 'microsoft');

CREATE TABLE calendar_connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider              calendar_provider NOT NULL,
  account_email         text NOT NULL,
  access_token_enc      bytea NOT NULL,                 -- AES-GCM, key from env, never logged
  refresh_token_enc     bytea NOT NULL,
  token_expires_at      timestamptz NOT NULL,
  scopes                text[] NOT NULL,
  check_for_conflicts   boolean NOT NULL DEFAULT true,
  is_write_target       boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, account_email)
);
CREATE UNIQUE INDEX calendar_connections_one_write_target ON calendar_connections (user_id) WHERE is_write_target;

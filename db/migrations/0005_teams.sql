-- Teams and round-robin event types (the Team plan).

-- Usernames and team slugs share one URL namespace (/{handle}/{event}). Triggers keep `handles` in step
-- with both tables, so a clash fails with a unique violation on handles_pkey whichever table is written.
CREATE TABLE handles (
  handle  text PRIMARY KEY,
  kind    text NOT NULL CHECK (kind IN ('user', 'team'))
);
INSERT INTO handles (handle, kind) SELECT username, 'user' FROM users;

-- Arguments: the handle kind and the column that holds it (username or slug).
CREATE OR REPLACE FUNCTION sync_handle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  k text := TG_ARGV[0];
  new_h text;
  old_h text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_h := to_jsonb(OLD) ->> TG_ARGV[1]; END IF;
  IF TG_OP <> 'DELETE' THEN new_h := to_jsonb(NEW) ->> TG_ARGV[1]; END IF;
  IF old_h IS DISTINCT FROM new_h THEN
    IF old_h IS NOT NULL THEN DELETE FROM handles WHERE handle = old_h AND kind = k; END IF;
    IF new_h IS NOT NULL THEN INSERT INTO handles (handle, kind) VALUES (new_h, k); END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER users_handle AFTER INSERT OR DELETE OR UPDATE OF username ON users
  FOR EACH ROW EXECUTE FUNCTION sync_handle('user', 'username');

CREATE TABLE teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}$'),
  name        text NOT NULL,
  -- The owner's account pays for the seats, and its branding is the team's branding.
  owner_id    uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER teams_handle AFTER INSERT OR DELETE OR UPDATE OF slug ON teams
  FOR EACH ROW EXECUTE FUNCTION sync_handle('team', 'slug');

CREATE TABLE team_members (
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user ON team_members (user_id);

CREATE TABLE team_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email        text NOT NULL,
  token_hash   text NOT NULL UNIQUE,              -- sha256 of the token; the raw token is only in the email
  invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX team_invites_one_open ON team_invites (team_id, email) WHERE accepted_at IS NULL;

-- Team event types belong to a team; user_id is the owner who created them. They have no schedule of
-- their own: each host's default schedule applies.
ALTER TABLE event_types
  ADD COLUMN team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  ADD COLUMN scheduling text NOT NULL DEFAULT 'personal' CHECK (scheduling IN ('personal', 'round_robin')),
  ALTER COLUMN schedule_id DROP NOT NULL,
  ADD CONSTRAINT event_types_team_scheduling CHECK ((team_id IS NULL) = (scheduling = 'personal')),
  ADD CONSTRAINT event_types_personal_schedule CHECK (team_id IS NOT NULL OR schedule_id IS NOT NULL),
  DROP CONSTRAINT event_types_user_id_slug_key;
CREATE UNIQUE INDEX event_types_personal_slug ON event_types (user_id, slug) WHERE team_id IS NULL;
CREATE UNIQUE INDEX event_types_team_slug ON event_types (team_id, slug) WHERE team_id IS NOT NULL;

-- Which team members take bookings for a round-robin event type.
CREATE TABLE event_type_hosts (
  event_type_id  uuid NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_type_id, user_id)
);

-- Round-robin fairness counts each host's recent bookings of an event type.
CREATE INDEX bookings_event_host_created ON bookings (event_type_id, host_id, created_at);

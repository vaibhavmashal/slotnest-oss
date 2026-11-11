-- Routing forms: a public questionnaire (/f/{username}/{slug}) that sends each person to the right event type, an
-- external page or a message, based on their answers. See src/lib/routing.
CREATE TABLE routing_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  description text,
  -- Same shape as event_types.questions (name and email are always asked).
  questions jsonb NOT NULL DEFAULT '[]',
  -- Ordered rules, first match wins: [{ id, questionId, op, value, target }].
  routes jsonb NOT NULL DEFAULT '[]',
  -- Where everyone else goes: { type: 'event', eventTypeId } | { type: 'url', url } | { type: 'message', text }.
  fallback jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

CREATE TABLE routing_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES routing_forms(id) ON DELETE CASCADE,
  invitee_name text NOT NULL,
  invitee_email text NOT NULL,
  answers jsonb NOT NULL DEFAULT '[]',
  -- What they were shown, for the dashboard: an event type title, a URL or "Message".
  routed_to text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX routing_submissions_form ON routing_submissions (form_id, created_at DESC);

-- The AI scheduling assistant: one stored conversation at a time per user (the full Messages API history, kept
-- append-only), and a daily request count to cap spend. See src/lib/assistant.
CREATE TABLE assistant_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  messages jsonb NOT NULL DEFAULT '[]',
  -- Changes the assistant proposed (cancel a meeting, create an event type) and whether the user confirmed them.
  actions jsonb NOT NULL DEFAULT '[]',
  -- Told to the assistant with the next message, e.g. "the user confirmed cancelling …".
  pending_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_conversations_user ON assistant_conversations (user_id, updated_at DESC);

CREATE TABLE assistant_usage (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

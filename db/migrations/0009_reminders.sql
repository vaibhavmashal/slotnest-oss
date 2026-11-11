-- Reminder workflows: each event type chooses its own reminder and follow-up emails.
-- [{ id, when: "before" | "after", minutes, to: "invitee" | "host", subject?, body? }], at most 10 (checked in the app).
-- "before" is measured from the start, "after" from the end. Without subject/body, the built-in wording is used.
-- Every event type starts with the reminders Slotnest always sent: 24 hours and 1 hour before, to the invitee.
ALTER TABLE event_types ADD COLUMN reminders jsonb NOT NULL DEFAULT
  '[{"id": "r24h", "when": "before", "minutes": 1440, "to": "invitee"}, {"id": "r1h", "when": "before", "minutes": 60, "to": "invitee"}]';

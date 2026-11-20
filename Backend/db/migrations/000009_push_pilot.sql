-- Additive, opt-in pilot. No existing notification preferences are changed.
CREATE TABLE messaging.push_devices (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (length(endpoint) BETWEEN 20 AND 2048),
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz
);
CREATE INDEX push_devices_person ON messaging.push_devices(person_id) WHERE revoked_at IS NULL;

CREATE TABLE messaging.push_tests (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  device_id uuid NOT NULL REFERENCES messaging.push_devices(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','accepted','failed','expired','unknown','cancelled')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '10 minutes',
  confirmed_at timestamptz,
  error_code text
);
CREATE INDEX push_tests_person ON messaging.push_tests(person_id, created_at DESC);

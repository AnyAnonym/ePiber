CREATE TABLE ops.idempotency_operations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  actor_person_id uuid REFERENCES identity.people(id) ON DELETE RESTRICT,
  command text NOT NULL CHECK (command ~ '^[A-Za-z][A-Za-z0-9_.:-]{1,126}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('started', 'success', 'failed', 'unknown')),
  response_projection jsonb,
  response_expires_at timestamptz(3),
  started_at timestamptz(3) NOT NULL,
  completed_at timestamptz(3),
  expires_at timestamptz(3) NOT NULL,
  UNIQUE (tenant_id, operation_id),
  CHECK ((status = 'started') = (completed_at IS NULL)),
  CHECK (response_projection IS NULL OR jsonb_typeof(response_projection) = 'object')
);
CREATE INDEX idempotency_operations_recovery ON ops.idempotency_operations (started_at) WHERE status = 'started';

CREATE TABLE ops.jobs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  job_type text NOT NULL CHECK (job_type ~ '^[a-z][a-z0-9_.-]{1,126}$'),
  payload_version integer NOT NULL CHECK (payload_version > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'leased', 'retrying', 'success', 'aborted', 'dead', 'unknown')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz(3) NOT NULL,
  lease_owner text,
  lease_until timestamptz(3),
  last_error_code text,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz(3),
  clarified_at timestamptz(3),
  UNIQUE (tenant_id, job_type, idempotency_key),
  CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX jobs_due ON ops.jobs (available_at, id) WHERE status IN ('pending', 'retrying');
CREATE INDEX jobs_expired_lease ON ops.jobs (lease_until, id) WHERE status = 'leased';

CREATE TABLE ops.outbox (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{1,126}$'),
  payload_version integer NOT NULL CHECK (payload_version > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'leased', 'sent', 'failed', 'unknown')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz(3) NOT NULL,
  lease_owner text,
  lease_until timestamptz(3),
  completed_at timestamptz(3),
  last_error_code text,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, event_type, idempotency_key),
  CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX outbox_due ON ops.outbox (available_at, id) WHERE status IN ('pending', 'failed');

CREATE TABLE ops.audit_operations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  actor_person_id uuid REFERENCES identity.people(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.-]{1,126}$'),
  subject_type text,
  subject_id text,
  status text NOT NULL CHECK (status IN ('started', 'success', 'failed', 'unknown')),
  source_ip inet,
  before_projection jsonb,
  after_projection jsonb,
  started_at timestamptz(3) NOT NULL,
  completed_at timestamptz(3),
  expires_at timestamptz(3) NOT NULL,
  UNIQUE (tenant_id, operation_id),
  CHECK ((status = 'started') = (completed_at IS NULL)),
  CHECK (before_projection IS NULL OR jsonb_typeof(before_projection) = 'object'),
  CHECK (after_projection IS NULL OR jsonb_typeof(after_projection) = 'object')
);
CREATE INDEX audit_operations_retention ON ops.audit_operations (expires_at, id);

CREATE TABLE ops.audit_transitions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  audit_operation_id uuid NOT NULL REFERENCES ops.audit_operations(id) ON DELETE CASCADE,
  transition text NOT NULL CHECK (transition IN ('started', 'success', 'failed', 'unknown')),
  occurred_at timestamptz(3) NOT NULL,
  error_code text,
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  UNIQUE (audit_operation_id, transition)
);

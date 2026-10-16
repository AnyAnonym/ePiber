CREATE TABLE messaging.events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  contract_id text NOT NULL CHECK (contract_id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{1,126}$'),
  template_key text NOT NULL CHECK (template_key ~ '^[a-z][a-z0-9_.-]{1,126}$'),
  template_version integer NOT NULL CHECK (template_version > 0),
  template_parameters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(template_parameters) = 'object'),
  competition_id uuid REFERENCES play.competitions(id) ON DELETE RESTRICT,
  match_id uuid REFERENCES play.matches(id) ON DELETE RESTRICT,
  match_result_history_id uuid REFERENCES play.match_result_history(id) ON DELETE RESTRICT,
  source_type text CHECK (source_type IS NULL OR source_type ~ '^[a-z][a-z0-9_.-]{0,62}$'),
  source_contract_id text CHECK (source_contract_id IS NULL OR length(source_contract_id) BETWEEN 1 AND 160),
  actor_person_id uuid REFERENCES identity.people(id) ON DELETE SET NULL,
  actor_contract_id_snapshot text,
  actor_name_snapshot text,
  summary_snapshot text,
  detail_snapshot text,
  result_snapshot text,
  source_operation_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL,
  UNIQUE (tenant_id, contract_id),
  UNIQUE (tenant_id, source_operation_id, event_type)
);
CREATE INDEX messaging_events_competition_time ON messaging.events (competition_id, created_at DESC, id);

CREATE TABLE messaging.event_participants (
  event_id uuid NOT NULL REFERENCES messaging.events(id) ON DELETE CASCADE,
  person_id uuid REFERENCES identity.people(id) ON DELETE SET NULL,
  participant_role text NOT NULL CHECK (participant_role ~ '^[a-z][a-z0-9_.-]{1,62}$'),
  contract_id_snapshot text NOT NULL,
  first_name_snapshot text,
  last_name_snapshot text NOT NULL,
  PRIMARY KEY (event_id, participant_role, contract_id_snapshot)
);

CREATE TABLE messaging.event_recipients (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  event_id uuid NOT NULL REFERENCES messaging.events(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE CASCADE,
  template_key text NOT NULL,
  template_version integer NOT NULL CHECK (template_version > 0),
  template_parameters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(template_parameters) = 'object'),
  legacy_subject text,
  legacy_body text,
  created_at timestamptz(3) NOT NULL,
  UNIQUE (event_id, person_id)
);
CREATE INDEX event_recipients_person_time ON messaging.event_recipients (person_id, created_at DESC, id DESC);

CREATE TABLE messaging.receipts (
  recipient_id uuid PRIMARY KEY REFERENCES messaging.event_recipients(id) ON DELETE CASCADE,
  read_at timestamptz(3),
  acknowledged_at timestamptz(3),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (acknowledged_at IS NULL OR read_at IS NOT NULL)
);

CREATE TABLE messaging.deliveries (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  recipient_id uuid NOT NULL REFERENCES messaging.event_recipients(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  status text NOT NULL CHECK (status IN ('not_configured', 'pending', 'sent', 'failed', 'unknown')),
  idempotency_key text NOT NULL,
  provider_reference text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code text,
  updated_at timestamptz(3) NOT NULL,
  UNIQUE (recipient_id, channel),
  UNIQUE (channel, idempotency_key)
);

CREATE TABLE messaging.comments (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  event_id uuid NOT NULL REFERENCES messaging.events(id) ON DELETE CASCADE,
  author_person_id uuid REFERENCES identity.people(id) ON DELETE SET NULL,
  author_contract_id_snapshot text,
  author_first_name_snapshot text,
  author_last_name_snapshot text,
  body text,
  created_at timestamptz(3) NOT NULL,
  updated_at timestamptz(3),
  moderation_status text NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'under_review')),
  moderated_at timestamptz(3),
  moderated_by_person_id uuid REFERENCES identity.people(id) ON DELETE SET NULL,
  deleted_at timestamptz(3),
  deletion_status text CHECK (deletion_status IN ('deleted_by_author', 'deleted_by_admin')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK ((deleted_at IS NULL AND deletion_status IS NULL AND body IS NOT NULL)
      OR (deleted_at IS NOT NULL AND deletion_status IS NOT NULL AND body IS NULL
          AND author_contract_id_snapshot IS NULL AND author_first_name_snapshot IS NULL AND author_last_name_snapshot IS NULL)),
  CHECK (updated_at IS NULL OR updated_at >= created_at),
  CHECK (moderated_at IS NULL OR moderated_at >= created_at)
);
CREATE INDEX comments_event_time ON messaging.comments (event_id, created_at DESC, id DESC);

CREATE TABLE messaging.reactions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  event_id uuid REFERENCES messaging.events(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES messaging.comments(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE CASCADE,
  reaction_key text NOT NULL CHECK (reaction_key ~ '^[a-z0-9_+-]{1,32}$'),
  created_at timestamptz(3) NOT NULL,
  CHECK ((event_id IS NULL) <> (comment_id IS NULL))
);
CREATE UNIQUE INDEX reactions_event_person ON messaging.reactions (event_id, person_id) WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX reactions_comment_person ON messaging.reactions (comment_id, person_id) WHERE comment_id IS NOT NULL;

CREATE TABLE messaging.user_revisions (
  person_id uuid PRIMARY KEY REFERENCES identity.people(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE messaging.history_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE messaging.notification_preferences (
  person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  enabled boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (person_id, channel)
);

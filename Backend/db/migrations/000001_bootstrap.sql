CREATE SCHEMA ops;

CREATE TABLE ops.schema_migrations (
  migration_id integer PRIMARY KEY CHECK (migration_id > 0),
  name text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9_-]*$'),
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  git_commit text NOT NULL,
  app_version text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  result text NOT NULL CHECK (result IN ('running', 'success', 'failed')),
  CHECK ((result = 'running') = (completed_at IS NULL)),
  CHECK ((result = 'running') = (duration_ms IS NULL))
);

CREATE SCHEMA core;
CREATE SCHEMA identity;
CREATE SCHEMA play;
CREATE SCHEMA venue;
CREATE SCHEMA messaging;
CREATE SCHEMA finance;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA core, identity, play, venue, messaging, finance, ops FROM PUBLIC;

CREATE TABLE core.tenants (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_code text NOT NULL UNIQUE CHECK (tenant_code ~ '^[a-z][a-z0-9-]{2,62}$'),
  display_name text NOT NULL CHECK (display_name = btrim(display_name) AND display_name <> ''),
  time_zone text NOT NULL CHECK (time_zone = 'Europe/Vienna'),
  locale text NOT NULL CHECK (locale = 'de-AT'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton)
);

CREATE TABLE core.sections (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  section_code text NOT NULL CHECK (section_code ~ '^[a-z][a-z0-9-]{1,62}$'),
  display_name text NOT NULL CHECK (display_name = btrim(display_name) AND display_name <> ''),
  active boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, section_code),
  UNIQUE (id, tenant_id)
);

CREATE TABLE core.configuration_entries (
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  configuration_key text NOT NULL CHECK (configuration_key ~ '^[a-z][a-z0-9_.-]{1,126}$'),
  value jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, configuration_key)
);

CREATE TABLE core.projection_revisions (
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  projection_key text NOT NULL CHECK (projection_key ~ '^[a-z][a-z0-9_.-]{1,126}$'),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, projection_key)
);

CREATE TABLE ops.seed_runs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid REFERENCES core.tenants(id) ON DELETE RESTRICT,
  seed_name text NOT NULL,
  seed_version text NOT NULL,
  as_of timestamptz NOT NULL,
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  result text NOT NULL CHECK (result IN ('running', 'success', 'failed'))
);

CREATE TABLE ops.import_runs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  source_instance text NOT NULL,
  export_run_id text NOT NULL,
  source_manifest_sha256 text NOT NULL CHECK (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  format_version integer NOT NULL CHECK (format_version > 0),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  result text NOT NULL CHECK (result IN ('running', 'success', 'failed', 'blocked')),
  UNIQUE (tenant_id, export_run_id)
);

CREATE TABLE ops.import_findings (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  import_run_id uuid NOT NULL REFERENCES ops.import_runs(id) ON DELETE CASCADE,
  finding_code text NOT NULL,
  source_projection text NOT NULL,
  source_reference text,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'blocker')),
  count bigint NOT NULL DEFAULT 1 CHECK (count > 0),
  UNIQUE (import_run_id, finding_code, source_projection, source_reference)
);

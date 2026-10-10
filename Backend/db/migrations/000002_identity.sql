CREATE TABLE identity.people (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  contract_id text NOT NULL CHECK (contract_id ~ '^[1-9][0-9]*$'),
  first_name text CHECK (first_name = btrim(first_name) AND length(first_name) BETWEEN 1 AND 100),
  last_name text NOT NULL CHECK (last_name = btrim(last_name) AND length(last_name) BETWEEN 1 AND 100),
  birth_date date,
  gender_code smallint CHECK (gender_code IN (1, 2, 3)),
  active boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, contract_id),
  UNIQUE (id, tenant_id)
);

CREATE SEQUENCE identity.person_contract_id_seq AS bigint MINVALUE 1;

CREATE TABLE identity.person_contacts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE CASCADE,
  contact_type text NOT NULL CHECK (contact_type IN ('email', 'mobile')),
  contact_value text NOT NULL CHECK (contact_value = btrim(contact_value) AND contact_value <> ''),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CHECK ((active AND revoked_at IS NULL) OR (NOT active AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX person_contacts_one_active_type
  ON identity.person_contacts (person_id, contact_type) WHERE active;

CREATE TABLE identity.person_addresses (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE CASCADE,
  country_label text,
  postal_code text CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{4}$'),
  city text,
  address_line text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CHECK (country_label IS NULL OR country_label = btrim(country_label)),
  CHECK (city IS NULL OR city = btrim(city)),
  CHECK (address_line IS NULL OR address_line = btrim(address_line)),
  CHECK ((active AND revoked_at IS NULL) OR (NOT active AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX person_addresses_one_active
  ON identity.person_addresses (person_id) WHERE active;

CREATE TABLE identity.person_external_identifiers (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('clubdesk')),
  external_value text NOT NULL CHECK (external_value ~ '^[1-9][0-9]{0,63}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  FOREIGN KEY (person_id, tenant_id) REFERENCES identity.people(id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, provider, external_value),
  CHECK ((active AND revoked_at IS NULL) OR (NOT active AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX person_external_identifiers_one_active
  ON identity.person_external_identifiers (person_id, provider) WHERE active;

CREATE TABLE identity.memberships (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  section_id uuid NOT NULL REFERENCES core.sections(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE RESTRICT,
  classification text NOT NULL CHECK (classification IN ('player', 'player A', 'player B')),
  active boolean NOT NULL DEFAULT true,
  valid_from timestamptz,
  valid_until timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
  CHECK (active = (valid_until IS NULL))
);
CREATE UNIQUE INDEX memberships_one_current
  ON identity.memberships (section_id, person_id) WHERE valid_until IS NULL;

CREATE TABLE identity.user_accounts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL UNIQUE,
  login text,
  active boolean NOT NULL DEFAULT true,
  auth_revision bigint NOT NULL DEFAULT 1 CHECK (auth_revision > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (person_id, tenant_id) REFERENCES identity.people(id, tenant_id) ON DELETE RESTRICT,
  CHECK (login IS NULL OR (login = lower(login) AND login = btrim(login) AND length(login) BETWEEN 3 AND 254
    AND login ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~@-]+$')),
  UNIQUE (tenant_id, login),
  UNIQUE (id, tenant_id)
);

CREATE TABLE identity.credentials (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE CASCADE,
  credential_type text NOT NULL CHECK (credential_type = 'password'),
  credential_schema text NOT NULL CHECK (credential_schema IN ('scrypt_v1', 'legacy_sha256')),
  secret_hash text NOT NULL CHECK (secret_hash <> ''),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revoked_reason text,
  CHECK ((active AND revoked_at IS NULL AND revoked_reason IS NULL) OR (NOT active AND revoked_at IS NOT NULL)),
  CHECK (credential_schema <> 'legacy_sha256' OR secret_hash ~ '^[0-9a-fA-F]{64}$')
);
CREATE UNIQUE INDEX credentials_one_active_password
  ON identity.credentials (account_id, credential_type) WHERE active;

CREATE TABLE identity.password_authorizations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE CASCADE,
  issued_by_person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at = issued_at + interval '24 hours'),
  CHECK (consumed_at IS NULL OR revoked_at IS NULL),
  CHECK (consumed_at IS NULL OR consumed_at >= issued_at),
  CHECK (revoked_at IS NULL OR revoked_at >= issued_at)
);
CREATE UNIQUE INDEX password_authorizations_one_open
  ON identity.password_authorizations (account_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE identity.tenant_role_assignments (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL,
  role_code text NOT NULL CHECK (role_code IN ('admin', 'operator')),
  granted_at timestamptz,
  granted_by_person_id uuid REFERENCES identity.people(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revoked_by_person_id uuid REFERENCES identity.people(id) ON DELETE RESTRICT,
  FOREIGN KEY (person_id, tenant_id) REFERENCES identity.people(id, tenant_id) ON DELETE RESTRICT,
  CHECK (revoked_at IS NULL OR granted_at IS NULL OR revoked_at >= granted_at)
);
CREATE UNIQUE INDEX tenant_role_assignments_one_active
  ON identity.tenant_role_assignments (tenant_id, person_id, role_code) WHERE revoked_at IS NULL;

CREATE TABLE identity.sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  auth_revision bigint NOT NULL CHECK (auth_revision > 0),
  login_snapshot text,
  issued_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (last_seen_at >= issued_at),
  CHECK (expires_at > issued_at),
  CHECK (login_snapshot IS NULL OR login_snapshot = lower(login_snapshot))
);
CREATE INDEX sessions_account_active
  ON identity.sessions (account_id, last_seen_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry ON identity.sessions (expires_at);

CREATE TABLE identity.login_rate_limits (
  key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  key_type text NOT NULL CHECK (key_type IN ('ip', 'ip_login')),
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count > 0),
  blocked_until timestamptz,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (key_type, key_hash),
  CHECK (expires_at > window_started_at),
  CHECK (blocked_until IS NULL OR blocked_until >= window_started_at)
);
CREATE INDEX login_rate_limits_expiry ON identity.login_rate_limits (expires_at);

CREATE TABLE venue.sites (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  section_id uuid NOT NULL REFERENCES core.sections(id) ON DELETE RESTRICT,
  site_code text NOT NULL CHECK (site_code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'),
  display_name text NOT NULL CHECK (display_name = btrim(display_name) AND display_name <> ''),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (section_id, site_code)
);

CREATE TABLE venue.courts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  site_id uuid NOT NULL REFERENCES venue.sites(id) ON DELETE RESTRICT,
  court_code text NOT NULL CHECK (court_code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'),
  display_name text NOT NULL CHECK (display_name = btrim(display_name) AND display_name <> ''),
  active boolean NOT NULL DEFAULT false,
  epoch bigint NOT NULL DEFAULT 0 CHECK (epoch >= 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (site_id, court_code)
);

CREATE TABLE venue.score_sources (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  court_id uuid NOT NULL REFERENCES venue.courts(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('legacy_court_receiver')),
  source_key text NOT NULL CHECK (source_key = btrim(source_key) AND source_key <> ''),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (source_type, source_key),
  UNIQUE (court_id, source_type),
  UNIQUE (id, court_id)
);

CREATE TABLE venue.court_assignments (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  court_id uuid NOT NULL REFERENCES venue.courts(id) ON DELETE RESTRICT,
  assignment_type text NOT NULL DEFAULT 'match' CHECK (assignment_type IN ('match','manual')),
  match_id uuid REFERENCES play.matches(id) ON DELETE RESTRICT,
  competition_id uuid REFERENCES play.competitions(id) ON DELETE RESTRICT,
  match_format_version_id uuid REFERENCES play.match_format_versions(id) ON DELETE RESTRICT,
  competition_name_snapshot text,
  round_code_snapshot text,
  scheduled_at_snapshot timestamptz(3),
  automation_status text CHECK (automation_status IN ('pending','activated','finished','expired','unscheduled')),
  assigned_at timestamptz(3) NOT NULL,
  assigned_by_person_id uuid REFERENCES identity.people(id) ON DELETE RESTRICT,
  released_at timestamptz(3),
  released_by_person_id uuid REFERENCES identity.people(id) ON DELETE RESTRICT,
  CHECK (released_at IS NULL OR released_at >= assigned_at),
  CHECK ((assignment_type='match' AND match_id IS NOT NULL AND competition_id IS NOT NULL AND match_format_version_id IS NOT NULL)
      OR (assignment_type='manual' AND match_id IS NULL)),
  UNIQUE (id, court_id)
);
CREATE UNIQUE INDEX court_assignments_open_court ON venue.court_assignments (court_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX court_assignments_open_match ON venue.court_assignments (match_id) WHERE released_at IS NULL;

CREATE TABLE venue.court_assignment_participants (
  assignment_id uuid NOT NULL REFERENCES venue.court_assignments(id) ON DELETE CASCADE,
  side_no smallint NOT NULL CHECK (side_no IN (1,2)),
  position_no smallint NOT NULL CHECK (position_no IN (1,2)),
  person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE RESTRICT,
  first_name_snapshot text,
  last_name_snapshot text NOT NULL,
  PRIMARY KEY (assignment_id,side_no,position_no),
  UNIQUE (assignment_id,person_id)
);

CREATE TABLE venue.court_live_state (
  court_id uuid PRIMARY KEY REFERENCES venue.courts(id) ON DELETE CASCADE,
  assignment_id uuid,
  source_id uuid,
  active boolean NOT NULL DEFAULT false,
  awaiting_baseline boolean NOT NULL DEFAULT false,
  side_one_set_one text NOT NULL DEFAULT '0',
  side_two_set_one text NOT NULL DEFAULT '0',
  side_one_set_two text NOT NULL DEFAULT '0',
  side_two_set_two text NOT NULL DEFAULT '0',
  side_one_set_three text NOT NULL DEFAULT '0',
  side_two_set_three text NOT NULL DEFAULT '0',
  side_one_points text NOT NULL DEFAULT '0',
  side_two_points text NOT NULL DEFAULT '0',
  baseline_sha256 bytea CHECK (baseline_sha256 IS NULL OR octet_length(baseline_sha256) = 32),
  source_state text NOT NULL DEFAULT 'unknown' CHECK (source_state IN ('unknown', 'ready', 'stale', 'failed')),
  last_source_at timestamptz(3),
  epoch bigint NOT NULL DEFAULT 0 CHECK (epoch >= 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (assignment_id, court_id) REFERENCES venue.court_assignments(id, court_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_id, court_id) REFERENCES venue.score_sources(id, court_id) ON DELETE RESTRICT,
  CHECK (NOT active OR source_id IS NOT NULL)
);

CREATE TABLE venue.score_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  event_id uuid NOT NULL UNIQUE,
  court_id uuid NOT NULL REFERENCES venue.courts(id) ON DELETE RESTRICT,
  assignment_id uuid,
  source_id uuid NOT NULL,
  court_sequence bigint NOT NULL CHECK (court_sequence > 0),
  source_occurred_at timestamptz(3),
  accepted_at timestamptz(3) NOT NULL,
  side_one_set_one text NOT NULL,
  side_two_set_one text NOT NULL,
  side_one_set_two text NOT NULL,
  side_two_set_two text NOT NULL,
  side_one_set_three text NOT NULL,
  side_two_set_three text NOT NULL,
  side_one_points text NOT NULL,
  side_two_points text NOT NULL,
  court_revision bigint NOT NULL CHECK (court_revision > 0),
  source_instance text NOT NULL,
  source_sequence bigint,
  source_key text,
  source_sha256 bytea CHECK (source_sha256 IS NULL OR octet_length(source_sha256) = 32),
  FOREIGN KEY (assignment_id, court_id) REFERENCES venue.court_assignments(id, court_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_id, court_id) REFERENCES venue.score_sources(id, court_id) ON DELETE RESTRICT,
  UNIQUE (court_id, court_sequence)
);
CREATE INDEX score_events_assignment_sequence ON venue.score_events (assignment_id, court_sequence DESC);

CREATE TABLE venue.court_state_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  court_id uuid NOT NULL REFERENCES venue.courts(id) ON DELETE RESTRICT,
  assignment_id uuid,
  actor_person_id uuid REFERENCES identity.people(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('reset', 'activated', 'deactivated', 'assignment_started', 'assignment_ended')),
  resulting_revision bigint NOT NULL CHECK (resulting_revision > 0),
  occurred_at timestamptz(3) NOT NULL,
  FOREIGN KEY (assignment_id, court_id) REFERENCES venue.court_assignments(id, court_id) ON DELETE RESTRICT
);
CREATE INDEX court_state_events_court_time ON venue.court_state_events (court_id, occurred_at, id);

CREATE TABLE venue.monitor_devices (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  contract_id text NOT NULL CHECK (contract_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
  label text NOT NULL CHECK (label = btrim(label) AND label <> ''),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  target_type text NOT NULL DEFAULT 'page' CHECK (target_type IN ('page', 'competition', 'ranking', 'entry_list', 'competition_history', 'hall_time_grid')),
  page_key text,
  competition_id uuid REFERENCES play.competitions(id) ON DELETE RESTRICT,
  hall_time_grid_id uuid,
  target_path text NOT NULL DEFAULT '/index.html' CHECK (length(target_path) BETWEEN 2 AND 500 AND target_path ~ '^/[A-Za-z0-9_./?&=:%+-]+$'),
  target_command_id uuid,
  target_issued_at timestamptz(3),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  last_seen_at timestamptz,
  UNIQUE (tenant_id, contract_id),
  CHECK ((target_command_id IS NULL) = (target_issued_at IS NULL)),
  CHECK ((target_type = 'page' AND page_key IS NOT NULL AND competition_id IS NULL AND hall_time_grid_id IS NULL)
      OR (target_type IN ('competition', 'ranking', 'entry_list', 'competition_history') AND page_key IS NULL AND competition_id IS NOT NULL AND hall_time_grid_id IS NULL)
      OR (target_type = 'hall_time_grid' AND page_key IS NULL AND competition_id IS NULL AND hall_time_grid_id IS NOT NULL))
);

CREATE TABLE venue.monitor_commands (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  monitor_id uuid NOT NULL REFERENCES venue.monitor_devices(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  command_type text NOT NULL CHECK (command_type IN ('navigate', 'scroll', 'reload')),
  operation_id uuid,
  target_revision bigint CHECK (target_revision > 0),
  target_path text CHECK (target_path IS NULL OR (length(target_path) BETWEEN 2 AND 500 AND target_path ~ '^/[A-Za-z0-9_./?&=:%+-]+$')),
  stream_id uuid,
  stream_sequence bigint CHECK (stream_sequence IS NULL OR stream_sequence > 0),
  delta_y integer CHECK (delta_y IS NULL OR delta_y IN (-300,300)),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','received','loading','loaded','applied','failed','offline')),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  created_at timestamptz(3) NOT NULL,
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  acknowledged_at timestamptz(3),
  expires_at timestamptz(3) NOT NULL,
  UNIQUE (monitor_id, command_id),
  UNIQUE (monitor_id, operation_id),
  CHECK (expires_at > created_at),
  CHECK (acknowledged_at IS NULL OR acknowledged_at >= created_at),
  CHECK ((command_type='navigate' AND target_revision IS NOT NULL AND target_path IS NOT NULL AND stream_id IS NULL AND stream_sequence IS NULL AND delta_y IS NULL)
      OR (command_type='scroll' AND target_revision IS NULL AND target_path IS NULL AND stream_id IS NOT NULL AND stream_sequence IS NOT NULL AND delta_y IS NOT NULL)
      OR (command_type='reload' AND target_revision IS NOT NULL AND target_path IS NULL AND stream_id IS NULL AND stream_sequence IS NULL AND delta_y IS NULL))
);
CREATE INDEX monitor_commands_pending ON venue.monitor_commands (monitor_id, created_at) WHERE acknowledged_at IS NULL;

CREATE TABLE venue.navigation_presets (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  contract_id text,
  profile_code text NOT NULL DEFAULT '1' CHECK (profile_code = btrim(profile_code) AND profile_code <> ''),
  label text NOT NULL CHECK (label = btrim(label) AND label <> ''),
  target_type text CHECK (target_type IN ('page', 'competition', 'ranking', 'entry_list', 'competition_history', 'hall_time_grid')),
  page_key text,
  competition_id uuid REFERENCES play.competitions(id) ON DELETE RESTRICT,
  hall_time_grid_id uuid,
  enabled boolean NOT NULL DEFAULT true,
  problem_code text,
  legacy_target text,
  sort_order integer,
  UNIQUE (tenant_id, profile_code, label),
  CHECK (enabled OR problem_code IS NOT NULL),
  CHECK (legacy_target IS NULL OR length(legacy_target) <= 500)
);

CREATE TABLE venue.hall_time_grids (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  section_id uuid NOT NULL REFERENCES core.sections(id) ON DELETE RESTRICT,
  contract_id text NOT NULL CHECK (contract_id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  name text NOT NULL CHECK (name = btrim(name) AND name <> ''),
  description text,
  mode text NOT NULL CHECK (mode IN ('reservation', 'allocation')),
  active boolean NOT NULL DEFAULT true,
  public_join_enabled boolean NOT NULL DEFAULT false,
  capacity smallint NOT NULL CHECK (capacity > 0),
  waiting_list_enabled boolean NOT NULL DEFAULT false,
  waiting_limit_per_person smallint CHECK (waiting_limit_per_person > 0),
  fair_use_enabled boolean NOT NULL DEFAULT false,
  fair_use_base integer NOT NULL DEFAULT 0 CHECK (fair_use_base >= 0),
  fair_use_extended_days integer NOT NULL DEFAULT 1 CHECK (fair_use_extended_days > 0),
  fair_use_percent integer NOT NULL DEFAULT 0 CHECK (fair_use_percent >= 0),
  fair_use_open_days integer CHECK (fair_use_open_days >= 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  projection_revision bigint NOT NULL DEFAULT 1 CHECK (projection_revision > 0),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (section_id, contract_id),
  UNIQUE (id, section_id),
  CHECK (waiting_list_enabled OR waiting_limit_per_person IS NULL)
);

ALTER TABLE venue.monitor_devices
  ADD CONSTRAINT monitor_devices_hall_grid_fk FOREIGN KEY (hall_time_grid_id) REFERENCES venue.hall_time_grids(id) ON DELETE RESTRICT;
ALTER TABLE venue.navigation_presets
  ADD CONSTRAINT navigation_presets_hall_grid_fk FOREIGN KEY (hall_time_grid_id) REFERENCES venue.hall_time_grids(id) ON DELETE RESTRICT;

CREATE TABLE venue.hall_time_grid_participants (
  grid_id uuid NOT NULL REFERENCES venue.hall_time_grids(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE RESTRICT,
  joined_at timestamptz(3) NOT NULL,
  left_at timestamptz(3),
  PRIMARY KEY (grid_id, person_id),
  CHECK (left_at IS NULL OR left_at >= joined_at)
);

CREATE TABLE venue.hall_time_slots (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  grid_id uuid NOT NULL REFERENCES venue.hall_time_grids(id) ON DELETE CASCADE,
  starts_at timestamptz(3) NOT NULL,
  ends_at timestamptz(3) NOT NULL,
  capacity smallint NOT NULL CHECK (capacity > 0),
  slot_revision bigint NOT NULL DEFAULT 1 CHECK (slot_revision > 0),
  active boolean NOT NULL DEFAULT true,
  CHECK (ends_at > starts_at),
  UNIQUE (grid_id, starts_at),
  UNIQUE (id, grid_id)
);

CREATE TABLE venue.hall_time_allocations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  slot_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('confirmed', 'waiting')),
  queued_at timestamptz(3) NOT NULL,
  assigned_at timestamptz(3),
  created_by_person_id uuid REFERENCES identity.people(id) ON DELETE RESTRICT,
  UNIQUE (slot_id, person_id),
  CHECK ((status = 'confirmed' AND assigned_at IS NOT NULL) OR (status = 'waiting' AND assigned_at IS NULL))
);
CREATE INDEX hall_time_allocations_queue ON venue.hall_time_allocations (slot_id, queued_at, id) WHERE status = 'waiting';

CREATE TABLE venue.hall_time_constraints (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  grid_id uuid NOT NULL REFERENCES venue.hall_time_grids(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE RESTRICT,
  slot_id uuid NOT NULL REFERENCES venue.hall_time_slots(id) ON DELETE CASCADE,
  constraint_type text NOT NULL CHECK (constraint_type IN ('unavailable', 'avoid')),
  created_at timestamptz(3) NOT NULL,
  FOREIGN KEY (slot_id, grid_id) REFERENCES venue.hall_time_slots(id, grid_id) ON DELETE CASCADE,
  UNIQUE (grid_id, person_id, slot_id, constraint_type)
);

CREATE TABLE venue.hall_time_history (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  grid_id uuid NOT NULL REFERENCES venue.hall_time_grids(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL UNIQUE,
  action_code text NOT NULL,
  actor_person_id uuid REFERENCES identity.people(id) ON DELETE RESTRICT,
  occurred_at timestamptz(3) NOT NULL,
  item_count integer NOT NULL CHECK (item_count >= 0),
  detail text,
  unavailable_count integer CHECK (unavailable_count IS NULL OR unavailable_count >= 0),
  avoid_count integer CHECK (avoid_count IS NULL OR avoid_count >= 0),
  assigned_count integer CHECK (assigned_count IS NULL OR assigned_count >= 0),
  removed_count integer CHECK (removed_count IS NULL OR removed_count >= 0),
  promoted_count integer CHECK (promoted_count IS NULL OR promoted_count >= 0),
  unchanged_count integer CHECK (unchanged_count IS NULL OR unchanged_count >= 0)
);
CREATE INDEX hall_time_history_retention ON venue.hall_time_history (grid_id, occurred_at, id);

CREATE TABLE venue.hall_time_history_items (
  history_id uuid NOT NULL REFERENCES venue.hall_time_history(id) ON DELETE CASCADE,
  item_no integer NOT NULL CHECK (item_no > 0),
  slot_id uuid REFERENCES venue.hall_time_slots(id) ON DELETE SET NULL,
  person_id uuid REFERENCES identity.people(id) ON DELETE RESTRICT,
  before_status text CHECK (before_status IN ('confirmed', 'waiting')),
  after_status text CHECK (after_status IN ('confirmed', 'waiting')),
  slot_starts_at_snapshot timestamptz(3),
  person_contract_id_snapshot text,
  person_name_snapshot text,
  PRIMARY KEY (history_id, item_no)
);

CREATE TABLE identity.user_favorites (
  account_id uuid NOT NULL REFERENCES identity.user_accounts(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 32),
  target_type text NOT NULL CHECK (target_type IN ('page', 'overlay', 'competition', 'ranking', 'entry_list', 'competition_history', 'competition_history_all', 'bracket', 'round_robin', 'hall_time_grid')),
  page_key text,
  overlay_key text,
  competition_id uuid REFERENCES play.competitions(id) ON DELETE CASCADE,
  hall_time_grid_id uuid REFERENCES venue.hall_time_grids(id) ON DELETE CASCADE,
  round_robin_layout smallint CHECK (round_robin_layout BETWEEN 0 AND 5),
  navigator_profile_code text CHECK (navigator_profile_code IS NULL OR (navigator_profile_code=btrim(navigator_profile_code) AND navigator_profile_code<>'')),
  revision bigint NOT NULL CHECK (revision > 0),
  PRIMARY KEY (account_id, position),
  CHECK ((target_type = 'page' AND page_key IS NOT NULL AND overlay_key IS NULL AND competition_id IS NULL AND hall_time_grid_id IS NULL AND round_robin_layout IS NULL
          AND (navigator_profile_code IS NULL OR page_key='navigator'))
      OR (target_type = 'overlay' AND page_key IS NULL AND overlay_key IS NOT NULL AND competition_id IS NULL AND hall_time_grid_id IS NULL AND round_robin_layout IS NULL AND navigator_profile_code IS NULL)
      OR (target_type = 'competition_history_all' AND page_key IS NULL AND overlay_key IS NULL AND competition_id IS NULL AND hall_time_grid_id IS NULL AND round_robin_layout IS NULL AND navigator_profile_code IS NULL)
      OR (target_type IN ('competition', 'ranking', 'entry_list', 'competition_history', 'bracket') AND page_key IS NULL AND overlay_key IS NULL AND competition_id IS NOT NULL AND hall_time_grid_id IS NULL AND round_robin_layout IS NULL AND navigator_profile_code IS NULL)
      OR (target_type = 'round_robin' AND page_key IS NULL AND overlay_key IS NULL AND competition_id IS NOT NULL AND hall_time_grid_id IS NULL AND navigator_profile_code IS NULL)
      OR (target_type = 'hall_time_grid' AND page_key IS NULL AND overlay_key IS NULL AND competition_id IS NULL AND hall_time_grid_id IS NOT NULL AND round_robin_layout IS NULL AND navigator_profile_code IS NULL))
);

CREATE TABLE identity.user_start_pages (
  account_id uuid PRIMARY KEY REFERENCES identity.user_accounts(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('page', 'overlay', 'competition', 'ranking', 'entry_list', 'competition_history', 'competition_history_all', 'bracket', 'round_robin', 'hall_time_grid')),
  page_key text,
  overlay_key text,
  competition_id uuid REFERENCES play.competitions(id) ON DELETE CASCADE,
  hall_time_grid_id uuid REFERENCES venue.hall_time_grids(id) ON DELETE CASCADE,
  round_robin_layout smallint CHECK (round_robin_layout BETWEEN 0 AND 5),
  navigator_profile_code text CHECK (navigator_profile_code IS NULL OR (navigator_profile_code=btrim(navigator_profile_code) AND navigator_profile_code<>'')),
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((target_type = 'page' AND page_key IS NOT NULL AND overlay_key IS NULL AND competition_id IS NULL AND hall_time_grid_id IS NULL AND round_robin_layout IS NULL
          AND (navigator_profile_code IS NULL OR page_key='navigator'))
      OR (target_type = 'overlay' AND page_key IS NULL AND overlay_key IS NOT NULL AND competition_id IS NULL AND hall_time_grid_id IS NULL AND round_robin_layout IS NULL AND navigator_profile_code IS NULL)
      OR (target_type = 'competition_history_all' AND page_key IS NULL AND overlay_key IS NULL AND competition_id IS NULL AND hall_time_grid_id IS NULL AND round_robin_layout IS NULL AND navigator_profile_code IS NULL)
      OR (target_type IN ('competition', 'ranking', 'entry_list', 'competition_history', 'bracket') AND page_key IS NULL AND overlay_key IS NULL AND competition_id IS NOT NULL AND hall_time_grid_id IS NULL AND round_robin_layout IS NULL AND navigator_profile_code IS NULL)
      OR (target_type = 'round_robin' AND page_key IS NULL AND overlay_key IS NULL AND competition_id IS NOT NULL AND hall_time_grid_id IS NULL AND navigator_profile_code IS NULL)
      OR (target_type = 'hall_time_grid' AND page_key IS NULL AND overlay_key IS NULL AND competition_id IS NULL AND hall_time_grid_id IS NOT NULL AND round_robin_layout IS NULL AND navigator_profile_code IS NULL))
);

CREATE TABLE identity.user_preference_states (
  account_id uuid PRIMARY KEY REFERENCES identity.user_accounts(id) ON DELETE CASCADE,
  favorites_revision bigint NOT NULL DEFAULT 0 CHECK (favorites_revision >= 0),
  favorites_updated_at timestamptz,
  start_page_revision bigint NOT NULL DEFAULT 0 CHECK (start_page_revision >= 0),
  start_page_updated_at timestamptz,
  CHECK ((favorites_revision = 0) = (favorites_updated_at IS NULL)),
  CHECK ((start_page_revision = 0) = (start_page_updated_at IS NULL))
);

CREATE TABLE play.competition_types (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  contract_id text NOT NULL CHECK (contract_id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  name text NOT NULL CHECK (name = btrim(name) AND name <> ''),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, contract_id)
);

CREATE TABLE play.competition_type_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  competition_type_id uuid NOT NULL REFERENCES play.competition_types(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  entry_list_available boolean NOT NULL,
  bracket_size integer CHECK (bracket_size IS NULL OR (bracket_size >= 2 AND (bracket_size & (bracket_size - 1)) = 0)),
  round_robin boolean NOT NULL,
  specific_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (competition_type_id, version_no)
);

CREATE TABLE play.match_formats (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES core.tenants(id) ON DELETE RESTRICT,
  contract_id text NOT NULL CHECK (contract_id ~ '^[1-9][0-9]*$'),
  name text NOT NULL CHECK (name = btrim(name) AND name <> ''),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, contract_id)
);

CREATE TABLE play.match_format_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  match_format_id uuid NOT NULL REFERENCES play.match_formats(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  sets_to_win smallint NOT NULL CHECK (sets_to_win IN (2, 3)),
  set_target_games smallint NOT NULL CHECK (set_target_games IN (4, 6)),
  set_tiebreak_at_games smallint NOT NULL CHECK (set_tiebreak_at_games IN (3, 6)),
  deciding_set_type text NOT NULL CHECK (deciding_set_type IN ('full_set', 'match_tiebreak_10', 'match_tiebreak_7')),
  no_ad boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (set_tiebreak_at_games = set_target_games OR set_tiebreak_at_games = set_target_games - 1),
  UNIQUE (match_format_id, version_no)
);

CREATE TABLE play.competitions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  section_id uuid NOT NULL REFERENCES core.sections(id) ON DELETE RESTRICT,
  contract_id text NOT NULL CHECK (contract_id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  competition_type_version_id uuid NOT NULL REFERENCES play.competition_type_versions(id) ON DELETE RESTRICT,
  default_match_format_version_id uuid REFERENCES play.match_format_versions(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (name = btrim(name) AND name <> ''),
  entry_start_date date,
  entry_starts_at timestamptz(3),
  entry_deadline_date date,
  entry_deadline_at timestamptz(3),
  competition_start_date date,
  competition_starts_at timestamptz(3),
  competition_end_date date,
  competition_ends_at timestamptz(3),
  minimum_age smallint CHECK (minimum_age BETWEEN 0 AND 150),
  maximum_age smallint CHECK (maximum_age BETWEEN 0 AND 150),
  sort_order integer,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (entry_start_date IS NULL OR entry_starts_at IS NULL),
  CHECK (entry_deadline_date IS NULL OR entry_deadline_at IS NULL),
  CHECK (competition_start_date IS NULL OR competition_starts_at IS NULL),
  CHECK (competition_end_date IS NULL OR competition_ends_at IS NULL),
  CHECK (minimum_age IS NULL OR maximum_age IS NULL OR minimum_age <= maximum_age),
  UNIQUE (section_id, contract_id),
  UNIQUE (id, section_id)
);

CREATE TABLE play.competition_gender_eligibility (
  competition_id uuid NOT NULL REFERENCES play.competitions(id) ON DELETE CASCADE,
  gender_code smallint NOT NULL CHECK (gender_code IN (1, 2, 3)),
  PRIMARY KEY (competition_id, gender_code)
);

CREATE TABLE play.competition_entries (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  competition_id uuid NOT NULL REFERENCES play.competitions(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE RESTRICT,
  contract_id text NOT NULL CHECK (contract_id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  entered_at timestamptz(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'withdrawn')),
  withdrawn_at timestamptz(3),
  legacy_fee_status text,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK ((status = 'active' AND withdrawn_at IS NULL) OR (status = 'withdrawn' AND withdrawn_at IS NOT NULL)),
  CHECK (withdrawn_at IS NULL OR withdrawn_at >= entered_at),
  UNIQUE (competition_id, contract_id)
);
CREATE UNIQUE INDEX competition_entries_one_active
  ON play.competition_entries (competition_id, person_id) WHERE status = 'active';

CREATE TABLE play.matches (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  competition_id uuid NOT NULL REFERENCES play.competitions(id) ON DELETE RESTRICT,
  contract_id text NOT NULL CHECK (contract_id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  match_format_version_id uuid NOT NULL REFERENCES play.match_format_versions(id) ON DELETE RESTRICT,
  format_binding_source text NOT NULL CHECK (format_binding_source IN ('competition_default', 'match_override')),
  round_code text,
  challenged_at timestamptz(3),
  scheduled_at timestamptz(3),
  reserved_duration_minutes integer CHECK (reserved_duration_minutes >= 0),
  is_ignored boolean NOT NULL DEFAULT false,
  legacy_ptn_rating text,
  note text,
  current_result_id uuid,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (competition_id, contract_id),
  UNIQUE (id, competition_id)
);
CREATE INDEX matches_competition_schedule ON play.matches (competition_id, scheduled_at);

CREATE TABLE play.match_sides (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  match_id uuid NOT NULL REFERENCES play.matches(id) ON DELETE CASCADE,
  side_no smallint NOT NULL CHECK (side_no IN (1, 2)),
  UNIQUE (match_id, side_no),
  UNIQUE (id, match_id)
);

CREATE TABLE play.match_participants (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  match_id uuid NOT NULL REFERENCES play.matches(id) ON DELETE CASCADE,
  side_id uuid NOT NULL,
  position_no smallint NOT NULL CHECK (position_no IN (1, 2)),
  participant_type text NOT NULL CHECK (participant_type IN ('person', 'bye', 'open_bracket')),
  person_id uuid REFERENCES identity.people(id) ON DELETE RESTRICT,
  FOREIGN KEY (side_id, match_id) REFERENCES play.match_sides(id, match_id) ON DELETE CASCADE,
  CHECK ((participant_type = 'person') = (person_id IS NOT NULL)),
  CHECK (participant_type <> 'open_bracket' OR position_no = 1),
  UNIQUE (side_id, position_no)
);
CREATE UNIQUE INDEX match_participants_person_once
  ON play.match_participants (match_id, person_id) WHERE person_id IS NOT NULL;

CREATE TABLE play.match_results (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  match_id uuid NOT NULL REFERENCES play.matches(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  completion_type text NOT NULL CHECK (completion_type IN ('regular', 'walkover', 'retirement')),
  winner_side_no smallint NOT NULL CHECK (winner_side_no IN (1, 2)),
  play_started_at timestamptz(3),
  play_ended_at timestamptz(3),
  first_captured_at timestamptz(3),
  walkover_at timestamptz(3),
  side_one_rank_snapshot integer CHECK (side_one_rank_snapshot >= 0),
  side_two_rank_snapshot integer CHECK (side_two_rank_snapshot >= 0),
  provenance text NOT NULL CHECK (provenance IN ('legacy_snapshot', 'postgresql')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (play_ended_at IS NULL OR play_started_at IS NULL OR play_ended_at > play_started_at),
  CHECK ((completion_type = 'walkover') = (walkover_at IS NOT NULL)),
  UNIQUE (match_id, version_no),
  UNIQUE (id, match_id)
);

ALTER TABLE play.matches
  ADD CONSTRAINT matches_current_result_fk
  FOREIGN KEY (current_result_id, id) REFERENCES play.match_results(id, match_id)
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE TABLE play.match_result_sets (
  result_id uuid NOT NULL REFERENCES play.match_results(id) ON DELETE CASCADE,
  set_no smallint NOT NULL CHECK (set_no BETWEEN 1 AND 5),
  side_one_games smallint NOT NULL CHECK (side_one_games BETWEEN 0 AND 99),
  side_two_games smallint NOT NULL CHECK (side_two_games BETWEEN 0 AND 99),
  loser_tiebreak_points smallint CHECK (loser_tiebreak_points BETWEEN 0 AND 99),
  incomplete boolean NOT NULL DEFAULT false,
  PRIMARY KEY (result_id, set_no)
);

CREATE TABLE play.match_result_history (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  match_id uuid NOT NULL REFERENCES play.matches(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL UNIQUE,
  change_type text NOT NULL CHECK (change_type IN ('created', 'corrected', 'cleared', 'end_corrected', 'legacy_snapshot')),
  before_result_id uuid,
  after_result_id uuid,
  actor_person_id uuid REFERENCES identity.people(id) ON DELETE RESTRICT,
  administrative_reason text,
  changed_at timestamptz(3) NOT NULL,
  FOREIGN KEY (before_result_id, match_id) REFERENCES play.match_results(id, match_id) ON DELETE RESTRICT,
  FOREIGN KEY (after_result_id, match_id) REFERENCES play.match_results(id, match_id) ON DELETE RESTRICT,
  CHECK (before_result_id IS NOT NULL OR after_result_id IS NOT NULL),
  CHECK (change_type <> 'cleared' OR (before_result_id IS NOT NULL AND after_result_id IS NULL)),
  CHECK (administrative_reason IS NULL OR length(btrim(administrative_reason)) BETWEEN 3 AND 500)
);

CREATE TABLE play.match_progressions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  competition_id uuid NOT NULL REFERENCES play.competitions(id) ON DELETE RESTRICT,
  source_match_id uuid NOT NULL,
  source_outcome text NOT NULL CHECK (source_outcome = 'winner'),
  target_match_id uuid NOT NULL,
  target_side_no smallint NOT NULL CHECK (target_side_no IN (1, 2)),
  FOREIGN KEY (source_match_id, competition_id) REFERENCES play.matches(id, competition_id) ON DELETE CASCADE,
  FOREIGN KEY (target_match_id, competition_id) REFERENCES play.matches(id, competition_id) ON DELETE CASCADE,
  CHECK (source_match_id <> target_match_id),
  UNIQUE (source_match_id, source_outcome),
  UNIQUE (target_match_id, target_side_no)
);

CREATE TABLE play.ranking_entries (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  competition_id uuid NOT NULL REFERENCES play.competitions(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active', 'withdrawn')),
  rank integer CHECK (rank > 0),
  previous_rank integer CHECK (previous_rank > 0),
  withdrawn_at timestamptz(3),
  withdrawal_reason text,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'active' AND rank IS NOT NULL AND withdrawn_at IS NULL AND withdrawal_reason IS NULL)
      OR (status = 'withdrawn' AND rank IS NULL AND previous_rank IS NOT NULL AND withdrawn_at IS NOT NULL
          AND length(btrim(withdrawal_reason)) BETWEEN 3 AND 500)),
  UNIQUE (competition_id, person_id),
  UNIQUE (id, competition_id)
);
CREATE UNIQUE INDEX ranking_entries_active_rank
  ON play.ranking_entries (competition_id, rank) WHERE status = 'active';

CREATE TABLE play.ranking_changes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  competition_id uuid NOT NULL REFERENCES play.competitions(id) ON DELETE RESTRICT,
  match_result_history_id uuid NOT NULL UNIQUE REFERENCES play.match_result_history(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL
);

CREATE TABLE play.ranking_change_items (
  ranking_change_id uuid NOT NULL REFERENCES play.ranking_changes(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES identity.people(id) ON DELETE RESTRICT,
  before_rank integer CHECK (before_rank IS NULL OR before_rank >= 0),
  after_rank integer CHECK (after_rank IS NULL OR after_rank >= 0),
  PRIMARY KEY (ranking_change_id, person_id),
  CHECK (before_rank IS DISTINCT FROM after_rank)
);

CREATE TABLE play.match_ranking_effects (
  match_result_history_id uuid PRIMARY KEY REFERENCES play.match_result_history(id) ON DELETE RESTRICT,
  ranking_change_id uuid NOT NULL UNIQUE REFERENCES play.ranking_changes(id) ON DELETE RESTRICT,
  challenger_rank_snapshot integer CHECK (challenger_rank_snapshot >= 0),
  challenged_rank_snapshot integer CHECK (challenged_rank_snapshot >= 0)
);

CREATE VIEW play.match_status AS
SELECT m.id AS match_id,
       CASE
         WHEN m.current_result_id IS NOT NULL THEN 'completed'
         WHEN EXISTS (SELECT 1 FROM play.match_participants p WHERE p.match_id = m.id AND p.participant_type = 'open_bracket') THEN 'open_bracket'
         WHEN EXISTS (SELECT 1 FROM play.match_participants p WHERE p.match_id = m.id AND p.participant_type = 'bye') THEN 'bye'
         ELSE 'open'
       END AS status
  FROM play.matches m;

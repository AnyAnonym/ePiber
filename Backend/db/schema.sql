--
-- PostgreSQL database dump
--

\restrict 6570696265725f736368656d615f736e617073686f745f76310000000000000000

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: core; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA core;

--
-- Name: finance; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA finance;

--
-- Name: identity; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA identity;

--
-- Name: messaging; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA messaging;

--
-- Name: ops; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA ops;

--
-- Name: play; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA play;

--
-- Name: venue; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA venue;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: configuration_entries; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.configuration_entries (
    tenant_id uuid NOT NULL,
    configuration_key text NOT NULL,
    value jsonb NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT configuration_entries_configuration_key_check CHECK ((configuration_key ~ '^[a-z][a-z0-9_.-]{1,126}$'::text)),
    CONSTRAINT configuration_entries_revision_check CHECK ((revision > 0))
);

--
-- Name: projection_revisions; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.projection_revisions (
    tenant_id uuid NOT NULL,
    projection_key text NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT projection_revisions_projection_key_check CHECK ((projection_key ~ '^[a-z][a-z0-9_.-]{1,126}$'::text)),
    CONSTRAINT projection_revisions_revision_check CHECK ((revision >= 0))
);

--
-- Name: sections; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.sections (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    section_code text NOT NULL,
    display_name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT sections_display_name_check CHECK (((display_name = btrim(display_name)) AND (display_name <> ''::text))),
    CONSTRAINT sections_revision_check CHECK ((revision > 0)),
    CONSTRAINT sections_section_code_check CHECK ((section_code ~ '^[a-z][a-z0-9-]{1,62}$'::text))
);

--
-- Name: tenants; Type: TABLE; Schema: core; Owner: -
--

CREATE TABLE core.tenants (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_code text NOT NULL,
    display_name text NOT NULL,
    time_zone text NOT NULL,
    locale text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    singleton boolean DEFAULT true NOT NULL,
    CONSTRAINT tenants_display_name_check CHECK (((display_name = btrim(display_name)) AND (display_name <> ''::text))),
    CONSTRAINT tenants_locale_check CHECK ((locale = 'de-AT'::text)),
    CONSTRAINT tenants_singleton_check CHECK (singleton),
    CONSTRAINT tenants_tenant_code_check CHECK ((tenant_code ~ '^[a-z][a-z0-9-]{2,62}$'::text)),
    CONSTRAINT tenants_time_zone_check CHECK ((time_zone = 'Europe/Vienna'::text))
);

--
-- Name: credentials; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.credentials (
    id uuid DEFAULT uuidv7() NOT NULL,
    account_id uuid NOT NULL,
    credential_type text NOT NULL,
    credential_schema text NOT NULL,
    secret_hash text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_reason text,
    CONSTRAINT credentials_check CHECK (((active AND (revoked_at IS NULL) AND (revoked_reason IS NULL) AND (secret_hash IS NOT NULL) AND (secret_hash <> ''::text)) OR ((NOT active) AND (revoked_at IS NOT NULL) AND (secret_hash IS NULL)))),
    CONSTRAINT credentials_check1 CHECK (((credential_schema <> 'legacy_sha256'::text) OR (NOT active) OR (secret_hash ~ '^[0-9a-fA-F]{64}$'::text))),
    CONSTRAINT credentials_credential_schema_check CHECK ((credential_schema = ANY (ARRAY['scrypt_v1'::text, 'legacy_sha256'::text]))),
    CONSTRAINT credentials_credential_type_check CHECK ((credential_type = 'password'::text))
);

--
-- Name: frontend_logging_settings; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.frontend_logging_settings (
    tenant_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    minimum_level text NOT NULL,
    include_anonymous boolean DEFAULT false NOT NULL,
    info_sample_rate numeric(5,4) NOT NULL,
    debug_sample_rate numeric(5,4) NOT NULL,
    batch_size smallint DEFAULT 10 NOT NULL,
    flush_interval_ms integer DEFAULT 5000 NOT NULL,
    default_target_level text DEFAULT 'debug'::text NOT NULL,
    default_target_duration_minutes smallint DEFAULT 120 CONSTRAINT frontend_logging_settings_default_target_duration_minu_not_null NOT NULL,
    info_retention_days smallint DEFAULT 14 NOT NULL,
    debug_retention_days smallint DEFAULT 7 NOT NULL,
    targets_revision bigint DEFAULT 0 NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT frontend_logging_settings_batch_size_check CHECK (((batch_size >= 1) AND (batch_size <= 20))),
    CONSTRAINT frontend_logging_settings_debug_retention_days_check CHECK ((debug_retention_days = 7)),
    CONSTRAINT frontend_logging_settings_debug_sample_rate_check CHECK (((debug_sample_rate >= (0)::numeric) AND (debug_sample_rate <= (1)::numeric))),
    CONSTRAINT frontend_logging_settings_default_target_duration_minutes_check CHECK (((default_target_duration_minutes >= 15) AND (default_target_duration_minutes <= 1440))),
    CONSTRAINT frontend_logging_settings_default_target_level_check CHECK ((default_target_level = ANY (ARRAY['error'::text, 'warn'::text, 'info'::text, 'debug'::text]))),
    CONSTRAINT frontend_logging_settings_flush_interval_ms_check CHECK (((flush_interval_ms >= 1000) AND (flush_interval_ms <= 30000))),
    CONSTRAINT frontend_logging_settings_info_retention_days_check CHECK ((info_retention_days = 14)),
    CONSTRAINT frontend_logging_settings_info_sample_rate_check CHECK (((info_sample_rate >= (0)::numeric) AND (info_sample_rate <= (1)::numeric))),
    CONSTRAINT frontend_logging_settings_minimum_level_check CHECK ((minimum_level = ANY (ARRAY['error'::text, 'warn'::text, 'info'::text, 'debug'::text]))),
    CONSTRAINT frontend_logging_settings_revision_check CHECK ((revision > 0)),
    CONSTRAINT frontend_logging_settings_targets_revision_check CHECK ((targets_revision >= 0))
);

--
-- Name: frontend_logging_targets; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.frontend_logging_targets (
    tenant_id uuid NOT NULL,
    person_id uuid NOT NULL,
    minimum_level text NOT NULL,
    expires_at timestamp(3) with time zone NOT NULL,
    created_by_person_id uuid NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT frontend_logging_targets_minimum_level_check CHECK ((minimum_level = ANY (ARRAY['error'::text, 'warn'::text, 'info'::text, 'debug'::text]))),
    CONSTRAINT frontend_logging_targets_revision_check CHECK ((revision > 0))
);

--
-- Name: login_rate_limits; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.login_rate_limits (
    key_hash bytea NOT NULL,
    key_type text NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    attempt_count integer NOT NULL,
    blocked_until timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT login_rate_limits_attempt_count_check CHECK ((attempt_count > 0)),
    CONSTRAINT login_rate_limits_check CHECK ((expires_at > window_started_at)),
    CONSTRAINT login_rate_limits_check1 CHECK (((blocked_until IS NULL) OR (blocked_until >= window_started_at))),
    CONSTRAINT login_rate_limits_key_hash_check CHECK ((octet_length(key_hash) = 32)),
    CONSTRAINT login_rate_limits_key_type_check CHECK ((key_type = ANY (ARRAY['ip'::text, 'ip_login'::text])))
);

--
-- Name: memberships; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.memberships (
    id uuid DEFAULT uuidv7() NOT NULL,
    section_id uuid NOT NULL,
    person_id uuid NOT NULL,
    classification text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    valid_from timestamp with time zone,
    valid_until timestamp with time zone,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT memberships_check CHECK (((valid_until IS NULL) OR (valid_from IS NULL) OR (valid_until >= valid_from))),
    CONSTRAINT memberships_check1 CHECK ((active = (valid_until IS NULL))),
    CONSTRAINT memberships_classification_check CHECK ((classification = ANY (ARRAY['player'::text, 'player A'::text, 'player B'::text]))),
    CONSTRAINT memberships_revision_check CHECK ((revision > 0))
);

--
-- Name: password_authorizations; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.password_authorizations (
    id uuid DEFAULT uuidv7() NOT NULL,
    account_id uuid NOT NULL,
    issued_by_person_id uuid NOT NULL,
    issued_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT password_authorizations_check CHECK ((expires_at = (issued_at + '24:00:00'::interval))),
    CONSTRAINT password_authorizations_check1 CHECK (((consumed_at IS NULL) OR (revoked_at IS NULL))),
    CONSTRAINT password_authorizations_check2 CHECK (((consumed_at IS NULL) OR (consumed_at >= issued_at))),
    CONSTRAINT password_authorizations_check3 CHECK (((revoked_at IS NULL) OR (revoked_at >= issued_at)))
);

--
-- Name: people; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.people (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    contract_id text NOT NULL,
    first_name text,
    last_name text NOT NULL,
    birth_date date,
    gender_code smallint,
    active boolean DEFAULT true NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT people_contract_id_check CHECK ((contract_id ~ '^[1-9][0-9]*$'::text)),
    CONSTRAINT people_first_name_check CHECK (((first_name = btrim(first_name)) AND ((length(first_name) >= 1) AND (length(first_name) <= 100)))),
    CONSTRAINT people_gender_code_check CHECK ((gender_code = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT people_last_name_check CHECK (((last_name = btrim(last_name)) AND ((length(last_name) >= 1) AND (length(last_name) <= 100)))),
    CONSTRAINT people_revision_check CHECK ((revision > 0))
);

--
-- Name: person_addresses; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.person_addresses (
    id uuid DEFAULT uuidv7() NOT NULL,
    person_id uuid NOT NULL,
    country_label text,
    postal_code text,
    city text,
    address_line text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT person_addresses_address_line_check CHECK (((address_line IS NULL) OR (address_line = btrim(address_line)))),
    CONSTRAINT person_addresses_check CHECK (((active AND (revoked_at IS NULL)) OR ((NOT active) AND (revoked_at IS NOT NULL)))),
    CONSTRAINT person_addresses_city_check CHECK (((city IS NULL) OR (city = btrim(city)))),
    CONSTRAINT person_addresses_country_label_check CHECK (((country_label IS NULL) OR (country_label = btrim(country_label)))),
    CONSTRAINT person_addresses_postal_code_check CHECK (((postal_code IS NULL) OR (postal_code ~ '^[0-9]{4}$'::text)))
);

--
-- Name: person_contacts; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.person_contacts (
    id uuid DEFAULT uuidv7() NOT NULL,
    person_id uuid NOT NULL,
    contact_type text NOT NULL,
    contact_value text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT person_contacts_check CHECK (((active AND (revoked_at IS NULL)) OR ((NOT active) AND (revoked_at IS NOT NULL)))),
    CONSTRAINT person_contacts_contact_type_check CHECK ((contact_type = ANY (ARRAY['email'::text, 'mobile'::text]))),
    CONSTRAINT person_contacts_contact_value_check CHECK (((contact_value = btrim(contact_value)) AND (contact_value <> ''::text)))
);

--
-- Name: person_contract_id_seq; Type: SEQUENCE; Schema: identity; Owner: -
--

CREATE SEQUENCE identity.person_contract_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: person_external_identifiers; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.person_external_identifiers (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    person_id uuid NOT NULL,
    provider text NOT NULL,
    external_value text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT person_external_identifiers_check CHECK (((active AND (revoked_at IS NULL)) OR ((NOT active) AND (revoked_at IS NOT NULL)))),
    CONSTRAINT person_external_identifiers_external_value_check CHECK ((external_value ~ '^[1-9][0-9]{0,63}$'::text)),
    CONSTRAINT person_external_identifiers_provider_check CHECK ((provider = 'clubdesk'::text))
);

--
-- Name: sessions; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.sessions (
    id uuid DEFAULT uuidv7() NOT NULL,
    account_id uuid NOT NULL,
    token_hash bytea NOT NULL,
    auth_revision bigint NOT NULL,
    login_snapshot text,
    issued_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT sessions_auth_revision_check CHECK ((auth_revision > 0)),
    CONSTRAINT sessions_check CHECK ((last_seen_at >= issued_at)),
    CONSTRAINT sessions_check1 CHECK ((expires_at > issued_at)),
    CONSTRAINT sessions_login_snapshot_check CHECK (((login_snapshot IS NULL) OR (login_snapshot = lower(login_snapshot)))),
    CONSTRAINT sessions_token_hash_check CHECK ((octet_length(token_hash) = 32))
);

--
-- Name: tenant_role_assignments; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.tenant_role_assignments (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    person_id uuid NOT NULL,
    role_code text NOT NULL,
    granted_at timestamp with time zone,
    granted_by_person_id uuid,
    revoked_at timestamp with time zone,
    revoked_by_person_id uuid,
    CONSTRAINT tenant_role_assignments_check CHECK (((revoked_at IS NULL) OR (granted_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT tenant_role_assignments_role_code_check CHECK ((role_code = ANY (ARRAY['admin'::text, 'operator'::text])))
);

--
-- Name: user_accounts; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.user_accounts (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    person_id uuid NOT NULL,
    login text,
    active boolean DEFAULT true NOT NULL,
    auth_revision bigint DEFAULT 1 NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT user_accounts_auth_revision_check CHECK ((auth_revision > 0)),
    CONSTRAINT user_accounts_login_check CHECK (((login IS NULL) OR ((login = lower(login)) AND (login = btrim(login)) AND ((length(login) >= 3) AND (length(login) <= 254)) AND (login ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~@-]+$'::text)))),
    CONSTRAINT user_accounts_revision_check CHECK ((revision > 0))
);

--
-- Name: user_favorites; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.user_favorites (
    account_id uuid NOT NULL,
    "position" smallint NOT NULL,
    target_type text NOT NULL,
    page_key text,
    overlay_key text,
    competition_id uuid,
    hall_time_grid_id uuid,
    round_robin_layout smallint,
    navigator_profile_code text,
    revision bigint NOT NULL,
    CONSTRAINT user_favorites_check CHECK ((((target_type = 'page'::text) AND (page_key IS NOT NULL) AND (overlay_key IS NULL) AND (competition_id IS NULL) AND (hall_time_grid_id IS NULL) AND (round_robin_layout IS NULL) AND ((navigator_profile_code IS NULL) OR (page_key = 'navigator'::text))) OR ((target_type = 'overlay'::text) AND (page_key IS NULL) AND (overlay_key IS NOT NULL) AND (competition_id IS NULL) AND (hall_time_grid_id IS NULL) AND (round_robin_layout IS NULL) AND (navigator_profile_code IS NULL)) OR ((target_type = 'competition_history_all'::text) AND (page_key IS NULL) AND (overlay_key IS NULL) AND (competition_id IS NULL) AND (hall_time_grid_id IS NULL) AND (round_robin_layout IS NULL) AND (navigator_profile_code IS NULL)) OR ((target_type = ANY (ARRAY['competition'::text, 'ranking'::text, 'entry_list'::text, 'competition_history'::text, 'bracket'::text])) AND (page_key IS NULL) AND (overlay_key IS NULL) AND (competition_id IS NOT NULL) AND (hall_time_grid_id IS NULL) AND (round_robin_layout IS NULL) AND (navigator_profile_code IS NULL)) OR ((target_type = 'round_robin'::text) AND (page_key IS NULL) AND (overlay_key IS NULL) AND (competition_id IS NOT NULL) AND (hall_time_grid_id IS NULL) AND (navigator_profile_code IS NULL)) OR ((target_type = 'hall_time_grid'::text) AND (page_key IS NULL) AND (overlay_key IS NULL) AND (competition_id IS NULL) AND (hall_time_grid_id IS NOT NULL) AND (round_robin_layout IS NULL) AND (navigator_profile_code IS NULL)))),
    CONSTRAINT user_favorites_navigator_profile_code_check CHECK (((navigator_profile_code IS NULL) OR ((navigator_profile_code = btrim(navigator_profile_code)) AND (navigator_profile_code <> ''::text)))),
    CONSTRAINT user_favorites_position_check CHECK ((("position" >= 1) AND ("position" <= 32))),
    CONSTRAINT user_favorites_revision_check CHECK ((revision > 0)),
    CONSTRAINT user_favorites_round_robin_layout_check CHECK (((round_robin_layout >= 0) AND (round_robin_layout <= 5))),
    CONSTRAINT user_favorites_target_type_check CHECK ((target_type = ANY (ARRAY['page'::text, 'overlay'::text, 'competition'::text, 'ranking'::text, 'entry_list'::text, 'competition_history'::text, 'competition_history_all'::text, 'bracket'::text, 'round_robin'::text, 'hall_time_grid'::text])))
);

--
-- Name: user_preference_states; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.user_preference_states (
    account_id uuid NOT NULL,
    favorites_revision bigint DEFAULT 0 NOT NULL,
    favorites_updated_at timestamp with time zone,
    start_page_revision bigint DEFAULT 0 NOT NULL,
    start_page_updated_at timestamp with time zone,
    CONSTRAINT user_preference_states_check CHECK (((favorites_revision = 0) = (favorites_updated_at IS NULL))),
    CONSTRAINT user_preference_states_check1 CHECK (((start_page_revision = 0) = (start_page_updated_at IS NULL))),
    CONSTRAINT user_preference_states_favorites_revision_check CHECK ((favorites_revision >= 0)),
    CONSTRAINT user_preference_states_start_page_revision_check CHECK ((start_page_revision >= 0))
);

--
-- Name: user_start_pages; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.user_start_pages (
    account_id uuid NOT NULL,
    target_type text NOT NULL,
    page_key text,
    overlay_key text,
    competition_id uuid,
    hall_time_grid_id uuid,
    round_robin_layout smallint,
    navigator_profile_code text,
    revision bigint NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT user_start_pages_check CHECK ((((target_type = 'page'::text) AND (page_key IS NOT NULL) AND (overlay_key IS NULL) AND (competition_id IS NULL) AND (hall_time_grid_id IS NULL) AND (round_robin_layout IS NULL) AND ((navigator_profile_code IS NULL) OR (page_key = 'navigator'::text))) OR ((target_type = 'overlay'::text) AND (page_key IS NULL) AND (overlay_key IS NOT NULL) AND (competition_id IS NULL) AND (hall_time_grid_id IS NULL) AND (round_robin_layout IS NULL) AND (navigator_profile_code IS NULL)) OR ((target_type = 'competition_history_all'::text) AND (page_key IS NULL) AND (overlay_key IS NULL) AND (competition_id IS NULL) AND (hall_time_grid_id IS NULL) AND (round_robin_layout IS NULL) AND (navigator_profile_code IS NULL)) OR ((target_type = ANY (ARRAY['competition'::text, 'ranking'::text, 'entry_list'::text, 'competition_history'::text, 'bracket'::text])) AND (page_key IS NULL) AND (overlay_key IS NULL) AND (competition_id IS NOT NULL) AND (hall_time_grid_id IS NULL) AND (round_robin_layout IS NULL) AND (navigator_profile_code IS NULL)) OR ((target_type = 'round_robin'::text) AND (page_key IS NULL) AND (overlay_key IS NULL) AND (competition_id IS NOT NULL) AND (hall_time_grid_id IS NULL) AND (navigator_profile_code IS NULL)) OR ((target_type = 'hall_time_grid'::text) AND (page_key IS NULL) AND (overlay_key IS NULL) AND (competition_id IS NULL) AND (hall_time_grid_id IS NOT NULL) AND (round_robin_layout IS NULL) AND (navigator_profile_code IS NULL)))),
    CONSTRAINT user_start_pages_navigator_profile_code_check CHECK (((navigator_profile_code IS NULL) OR ((navigator_profile_code = btrim(navigator_profile_code)) AND (navigator_profile_code <> ''::text)))),
    CONSTRAINT user_start_pages_revision_check CHECK ((revision > 0)),
    CONSTRAINT user_start_pages_round_robin_layout_check CHECK (((round_robin_layout >= 0) AND (round_robin_layout <= 5))),
    CONSTRAINT user_start_pages_target_type_check CHECK ((target_type = ANY (ARRAY['page'::text, 'overlay'::text, 'competition'::text, 'ranking'::text, 'entry_list'::text, 'competition_history'::text, 'competition_history_all'::text, 'bracket'::text, 'round_robin'::text, 'hall_time_grid'::text])))
);

--
-- Name: comments; Type: TABLE; Schema: messaging; Owner: -
--

CREATE TABLE messaging.comments (
    id uuid DEFAULT uuidv7() NOT NULL,
    event_id uuid NOT NULL,
    author_person_id uuid,
    author_contract_id_snapshot text,
    author_first_name_snapshot text,
    author_last_name_snapshot text,
    body text,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone,
    moderation_status text DEFAULT 'visible'::text NOT NULL,
    moderated_at timestamp(3) with time zone,
    moderated_by_person_id uuid,
    deleted_at timestamp(3) with time zone,
    deletion_status text,
    revision bigint DEFAULT 1 NOT NULL,
    CONSTRAINT comments_check CHECK ((((deleted_at IS NULL) AND (deletion_status IS NULL) AND (body IS NOT NULL)) OR ((deleted_at IS NOT NULL) AND (deletion_status IS NOT NULL) AND (body IS NULL) AND (author_contract_id_snapshot IS NULL) AND (author_first_name_snapshot IS NULL) AND (author_last_name_snapshot IS NULL)))),
    CONSTRAINT comments_check1 CHECK (((updated_at IS NULL) OR (updated_at >= created_at))),
    CONSTRAINT comments_check2 CHECK (((moderated_at IS NULL) OR (moderated_at >= created_at))),
    CONSTRAINT comments_deletion_status_check CHECK ((deletion_status = ANY (ARRAY['deleted_by_author'::text, 'deleted_by_admin'::text]))),
    CONSTRAINT comments_moderation_status_check CHECK ((moderation_status = ANY (ARRAY['visible'::text, 'under_review'::text]))),
    CONSTRAINT comments_revision_check CHECK ((revision > 0))
);

--
-- Name: deliveries; Type: TABLE; Schema: messaging; Owner: -
--

CREATE TABLE messaging.deliveries (
    id uuid DEFAULT uuidv7() NOT NULL,
    recipient_id uuid NOT NULL,
    channel text NOT NULL,
    status text NOT NULL,
    idempotency_key text NOT NULL,
    provider_reference text,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error_code text,
    updated_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT deliveries_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT deliveries_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'whatsapp'::text]))),
    CONSTRAINT deliveries_status_check CHECK ((status = ANY (ARRAY['not_configured'::text, 'pending'::text, 'sent'::text, 'failed'::text, 'unknown'::text])))
);

--
-- Name: event_participants; Type: TABLE; Schema: messaging; Owner: -
--

CREATE TABLE messaging.event_participants (
    event_id uuid NOT NULL,
    person_id uuid,
    participant_role text NOT NULL,
    contract_id_snapshot text NOT NULL,
    first_name_snapshot text,
    last_name_snapshot text NOT NULL,
    CONSTRAINT event_participants_participant_role_check CHECK ((participant_role ~ '^[a-z][a-z0-9_.-]{1,62}$'::text))
);

--
-- Name: event_recipients; Type: TABLE; Schema: messaging; Owner: -
--

CREATE TABLE messaging.event_recipients (
    id uuid DEFAULT uuidv7() NOT NULL,
    event_id uuid NOT NULL,
    person_id uuid NOT NULL,
    template_key text NOT NULL,
    template_version integer NOT NULL,
    template_parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    legacy_subject text,
    legacy_body text,
    created_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT event_recipients_template_parameters_check CHECK ((jsonb_typeof(template_parameters) = 'object'::text)),
    CONSTRAINT event_recipients_template_version_check CHECK ((template_version > 0))
);

--
-- Name: events; Type: TABLE; Schema: messaging; Owner: -
--

CREATE TABLE messaging.events (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    contract_id text NOT NULL,
    event_type text NOT NULL,
    template_key text NOT NULL,
    template_version integer NOT NULL,
    template_parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    competition_id uuid,
    match_id uuid,
    match_result_history_id uuid,
    source_type text,
    source_contract_id text,
    actor_person_id uuid,
    actor_contract_id_snapshot text,
    actor_name_snapshot text,
    summary_snapshot text,
    detail_snapshot text,
    result_snapshot text,
    source_operation_id uuid NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT events_contract_id_check CHECK ((contract_id ~ '^[A-Za-z0-9_.:-]{1,64}$'::text)),
    CONSTRAINT events_event_type_check CHECK ((event_type ~ '^[a-z][a-z0-9_.-]{1,126}$'::text)),
    CONSTRAINT events_source_contract_id_check CHECK (((source_contract_id IS NULL) OR ((length(source_contract_id) >= 1) AND (length(source_contract_id) <= 160)))),
    CONSTRAINT events_source_type_check CHECK (((source_type IS NULL) OR (source_type ~ '^[a-z][a-z0-9_.-]{0,62}$'::text))),
    CONSTRAINT events_template_key_check CHECK ((template_key ~ '^[a-z][a-z0-9_.-]{1,126}$'::text)),
    CONSTRAINT events_template_parameters_check CHECK ((jsonb_typeof(template_parameters) = 'object'::text)),
    CONSTRAINT events_template_version_check CHECK ((template_version > 0))
);

--
-- Name: history_revision; Type: TABLE; Schema: messaging; Owner: -
--

CREATE TABLE messaging.history_revision (
    singleton boolean DEFAULT true NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT history_revision_revision_check CHECK ((revision >= 0)),
    CONSTRAINT history_revision_singleton_check CHECK (singleton)
);

--
-- Name: notification_preferences; Type: TABLE; Schema: messaging; Owner: -
--

CREATE TABLE messaging.notification_preferences (
    person_id uuid NOT NULL,
    channel text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT notification_preferences_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'whatsapp'::text]))),
    CONSTRAINT notification_preferences_revision_check CHECK ((revision > 0))
);

--
-- Name: reactions; Type: TABLE; Schema: messaging; Owner: -
--

CREATE TABLE messaging.reactions (
    id uuid DEFAULT uuidv7() NOT NULL,
    event_id uuid,
    comment_id uuid,
    person_id uuid NOT NULL,
    reaction_key text NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT reactions_check CHECK (((event_id IS NULL) <> (comment_id IS NULL))),
    CONSTRAINT reactions_reaction_key_check CHECK ((reaction_key ~ '^[a-z0-9_+-]{1,32}$'::text))
);

--
-- Name: receipts; Type: TABLE; Schema: messaging; Owner: -
--

CREATE TABLE messaging.receipts (
    recipient_id uuid NOT NULL,
    read_at timestamp(3) with time zone,
    acknowledged_at timestamp(3) with time zone,
    revision bigint DEFAULT 1 NOT NULL,
    CONSTRAINT receipts_check CHECK (((acknowledged_at IS NULL) OR (read_at IS NOT NULL))),
    CONSTRAINT receipts_revision_check CHECK ((revision > 0))
);

--
-- Name: user_revisions; Type: TABLE; Schema: messaging; Owner: -
--

CREATE TABLE messaging.user_revisions (
    person_id uuid NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT user_revisions_revision_check CHECK ((revision >= 0))
);

--
-- Name: audit_operations; Type: TABLE; Schema: ops; Owner: -
--

CREATE TABLE ops.audit_operations (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    actor_person_id uuid,
    actor_type text DEFAULT 'user'::text NOT NULL,
    actor_name_snapshot text,
    role_snapshot text,
    action text NOT NULL,
    subject_type text,
    subject_id text,
    subject_name_snapshot text,
    request_id text,
    status text NOT NULL,
    source_instance text NOT NULL,
    before_projection jsonb,
    after_projection jsonb,
    started_at timestamp(3) with time zone NOT NULL,
    completed_at timestamp(3) with time zone,
    expires_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT audit_operations_action_check CHECK ((action ~ '^[a-z][a-z0-9_.-]{1,126}$'::text)),
    CONSTRAINT audit_operations_actor_type_check CHECK ((actor_type = ANY (ARRAY['anonymous'::text, 'user'::text, 'monitor'::text, 'system'::text]))),
    CONSTRAINT audit_operations_after_projection_check CHECK (((after_projection IS NULL) OR (jsonb_typeof(after_projection) = 'object'::text))),
    CONSTRAINT audit_operations_before_projection_check CHECK (((before_projection IS NULL) OR (jsonb_typeof(before_projection) = 'object'::text))),
    CONSTRAINT audit_operations_check CHECK (((status = 'started'::text) = (completed_at IS NULL))),
    CONSTRAINT audit_operations_status_check CHECK ((status = ANY (ARRAY['started'::text, 'success'::text, 'failed'::text, 'unknown'::text])))
);

--
-- Name: audit_security_context; Type: TABLE; Schema: ops; Owner: -
--

CREATE TABLE ops.audit_security_context (
    audit_operation_id uuid NOT NULL,
    source_ip inet,
    attempted_login text,
    attempted_email text,
    CONSTRAINT audit_security_context_attempted_email_check CHECK (((attempted_email IS NULL) OR (length(attempted_email) <= 254))),
    CONSTRAINT audit_security_context_attempted_login_check CHECK (((attempted_login IS NULL) OR (length(attempted_login) <= 254)))
);

--
-- Name: audit_transitions; Type: TABLE; Schema: ops; Owner: -
--

CREATE TABLE ops.audit_transitions (
    id uuid DEFAULT uuidv7() NOT NULL,
    audit_operation_id uuid NOT NULL,
    transition text NOT NULL,
    occurred_at timestamp(3) with time zone NOT NULL,
    error_code text,
    duration_ms bigint,
    CONSTRAINT audit_transitions_duration_ms_check CHECK (((duration_ms IS NULL) OR (duration_ms >= 0))),
    CONSTRAINT audit_transitions_transition_check CHECK ((transition = ANY (ARRAY['started'::text, 'success'::text, 'failed'::text, 'unknown'::text])))
);

--
-- Name: idempotency_operations; Type: TABLE; Schema: ops; Owner: -
--

CREATE TABLE ops.idempotency_operations (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    actor_person_id uuid,
    command text NOT NULL,
    request_hash bytea NOT NULL,
    status text NOT NULL,
    response_projection jsonb,
    response_expires_at timestamp(3) with time zone,
    started_at timestamp(3) with time zone NOT NULL,
    completed_at timestamp(3) with time zone,
    expires_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT idempotency_operations_check CHECK (((status = 'started'::text) = (completed_at IS NULL))),
    CONSTRAINT idempotency_operations_command_check CHECK ((command ~ '^[A-Za-z][A-Za-z0-9_.:-]{1,126}$'::text)),
    CONSTRAINT idempotency_operations_request_hash_check CHECK ((octet_length(request_hash) = 32)),
    CONSTRAINT idempotency_operations_response_projection_check CHECK (((response_projection IS NULL) OR (jsonb_typeof(response_projection) = 'object'::text))),
    CONSTRAINT idempotency_operations_status_check CHECK ((status = ANY (ARRAY['started'::text, 'success'::text, 'failed'::text, 'unknown'::text])))
);

--
-- Name: import_findings; Type: TABLE; Schema: ops; Owner: -
--

CREATE TABLE ops.import_findings (
    id uuid DEFAULT uuidv7() NOT NULL,
    import_run_id uuid NOT NULL,
    finding_code text NOT NULL,
    source_projection text NOT NULL,
    source_reference text,
    severity text NOT NULL,
    count bigint DEFAULT 1 NOT NULL,
    CONSTRAINT import_findings_count_check CHECK ((count > 0)),
    CONSTRAINT import_findings_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'blocker'::text])))
);

--
-- Name: import_runs; Type: TABLE; Schema: ops; Owner: -
--

CREATE TABLE ops.import_runs (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    source_instance text NOT NULL,
    export_run_id text NOT NULL,
    source_manifest_sha256 bytea NOT NULL,
    format_version integer NOT NULL,
    rule_version integer NOT NULL,
    transformed_sha256 bytea NOT NULL,
    exception_manifest_sha256 bytea,
    target_sha256 bytea,
    source_counts jsonb NOT NULL,
    target_counts jsonb,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    validated_at timestamp with time zone,
    result text NOT NULL,
    CONSTRAINT import_runs_check CHECK (((result = 'success'::text) = ((target_sha256 IS NOT NULL) AND (target_counts IS NOT NULL) AND (validated_at IS NOT NULL)))),
    CONSTRAINT import_runs_exception_manifest_sha256_check CHECK (((exception_manifest_sha256 IS NULL) OR (octet_length(exception_manifest_sha256) = 32))),
    CONSTRAINT import_runs_format_version_check CHECK ((format_version > 0)),
    CONSTRAINT import_runs_result_check CHECK ((result = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text, 'blocked'::text]))),
    CONSTRAINT import_runs_rule_version_check CHECK ((rule_version > 0)),
    CONSTRAINT import_runs_source_counts_check CHECK ((jsonb_typeof(source_counts) = 'object'::text)),
    CONSTRAINT import_runs_source_manifest_sha256_check CHECK ((octet_length(source_manifest_sha256) = 32)),
    CONSTRAINT import_runs_target_counts_check CHECK (((target_counts IS NULL) OR (jsonb_typeof(target_counts) = 'object'::text))),
    CONSTRAINT import_runs_target_sha256_check CHECK (((target_sha256 IS NULL) OR (octet_length(target_sha256) = 32))),
    CONSTRAINT import_runs_transformed_sha256_check CHECK ((octet_length(transformed_sha256) = 32))
);

--
-- Name: jobs; Type: TABLE; Schema: ops; Owner: -
--

CREATE TABLE ops.jobs (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    job_type text NOT NULL,
    payload_version integer NOT NULL,
    payload jsonb NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    available_at timestamp(3) with time zone NOT NULL,
    lease_owner text,
    lease_until timestamp(3) with time zone,
    last_error_code text,
    created_at timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    completed_at timestamp(3) with time zone,
    clarified_at timestamp(3) with time zone,
    CONSTRAINT jobs_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT jobs_check CHECK (((status = 'leased'::text) = ((lease_owner IS NOT NULL) AND (lease_until IS NOT NULL)))),
    CONSTRAINT jobs_job_type_check CHECK ((job_type ~ '^[a-z][a-z0-9_.-]{1,126}$'::text)),
    CONSTRAINT jobs_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT jobs_payload_version_check CHECK ((payload_version > 0)),
    CONSTRAINT jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'leased'::text, 'retrying'::text, 'success'::text, 'aborted'::text, 'dead'::text, 'unknown'::text])))
);

--
-- Name: outbox; Type: TABLE; Schema: ops; Owner: -
--

CREATE TABLE ops.outbox (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    event_type text NOT NULL,
    payload_version integer NOT NULL,
    payload jsonb NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    available_at timestamp(3) with time zone NOT NULL,
    lease_owner text,
    lease_until timestamp(3) with time zone,
    completed_at timestamp(3) with time zone,
    last_error_code text,
    created_at timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT outbox_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT outbox_check CHECK (((status = 'leased'::text) = ((lease_owner IS NOT NULL) AND (lease_until IS NOT NULL)))),
    CONSTRAINT outbox_event_type_check CHECK ((event_type ~ '^[a-z][a-z0-9_.-]{1,126}$'::text)),
    CONSTRAINT outbox_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT outbox_payload_version_check CHECK ((payload_version > 0)),
    CONSTRAINT outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'leased'::text, 'sent'::text, 'failed'::text, 'unknown'::text])))
);

--
-- Name: schema_migrations; Type: TABLE; Schema: ops; Owner: -
--

CREATE TABLE ops.schema_migrations (
    migration_id integer NOT NULL,
    name text NOT NULL,
    checksum text NOT NULL,
    git_commit text NOT NULL,
    app_version text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    duration_ms bigint,
    result text NOT NULL,
    CONSTRAINT schema_migrations_check CHECK (((result = 'running'::text) = (completed_at IS NULL))),
    CONSTRAINT schema_migrations_check1 CHECK (((result = 'running'::text) = (duration_ms IS NULL))),
    CONSTRAINT schema_migrations_checksum_check CHECK ((checksum ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT schema_migrations_duration_ms_check CHECK (((duration_ms IS NULL) OR (duration_ms >= 0))),
    CONSTRAINT schema_migrations_migration_id_check CHECK ((migration_id > 0)),
    CONSTRAINT schema_migrations_name_check CHECK ((name ~ '^[a-z0-9][a-z0-9_-]*$'::text)),
    CONSTRAINT schema_migrations_result_check CHECK ((result = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text])))
);

--
-- Name: seed_runs; Type: TABLE; Schema: ops; Owner: -
--

CREATE TABLE ops.seed_runs (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid,
    seed_name text NOT NULL,
    seed_version text NOT NULL,
    as_of timestamp with time zone NOT NULL,
    checksum text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    result text NOT NULL,
    CONSTRAINT seed_runs_checksum_check CHECK ((checksum ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT seed_runs_result_check CHECK ((result = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text])))
);

--
-- Name: competition_entries; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.competition_entries (
    id uuid DEFAULT uuidv7() NOT NULL,
    competition_id uuid NOT NULL,
    person_id uuid NOT NULL,
    contract_id text NOT NULL,
    entered_at timestamp(3) with time zone NOT NULL,
    status text NOT NULL,
    withdrawn_at timestamp(3) with time zone,
    legacy_fee_status text,
    revision bigint DEFAULT 1 NOT NULL,
    CONSTRAINT competition_entries_check CHECK ((((status = 'active'::text) AND (withdrawn_at IS NULL)) OR ((status = 'withdrawn'::text) AND (withdrawn_at IS NOT NULL)))),
    CONSTRAINT competition_entries_check1 CHECK (((withdrawn_at IS NULL) OR (withdrawn_at >= entered_at))),
    CONSTRAINT competition_entries_contract_id_check CHECK ((contract_id ~ '^[A-Za-z0-9_.:-]{1,64}$'::text)),
    CONSTRAINT competition_entries_revision_check CHECK ((revision > 0)),
    CONSTRAINT competition_entries_status_check CHECK ((status = ANY (ARRAY['active'::text, 'withdrawn'::text])))
);

--
-- Name: competition_gender_eligibility; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.competition_gender_eligibility (
    competition_id uuid NOT NULL,
    gender_code smallint NOT NULL,
    CONSTRAINT competition_gender_eligibility_gender_code_check CHECK ((gender_code = ANY (ARRAY[1, 2, 3])))
);

--
-- Name: competition_type_versions; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.competition_type_versions (
    id uuid DEFAULT uuidv7() NOT NULL,
    competition_type_id uuid NOT NULL,
    version_no integer NOT NULL,
    entry_list_available boolean NOT NULL,
    bracket_size integer,
    round_robin boolean NOT NULL,
    specific_code text,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT competition_type_versions_bracket_size_check CHECK (((bracket_size IS NULL) OR ((bracket_size >= 2) AND ((bracket_size & (bracket_size - 1)) = 0)))),
    CONSTRAINT competition_type_versions_version_no_check CHECK ((version_no > 0))
);

--
-- Name: competition_types; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.competition_types (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    contract_id text NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT competition_types_contract_id_check CHECK ((contract_id ~ '^[A-Za-z0-9_.:-]{1,64}$'::text)),
    CONSTRAINT competition_types_name_check CHECK (((name = btrim(name)) AND (name <> ''::text)))
);

--
-- Name: competitions; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.competitions (
    id uuid DEFAULT uuidv7() NOT NULL,
    section_id uuid NOT NULL,
    contract_id text NOT NULL,
    competition_type_version_id uuid NOT NULL,
    default_match_format_version_id uuid,
    name text NOT NULL,
    entry_start_date date,
    entry_starts_at timestamp(3) with time zone,
    entry_deadline_date date,
    entry_deadline_at timestamp(3) with time zone,
    competition_start_date date,
    competition_starts_at timestamp(3) with time zone,
    competition_end_date date,
    competition_ends_at timestamp(3) with time zone,
    minimum_age smallint,
    maximum_age smallint,
    sort_order integer,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT competitions_check CHECK (((entry_start_date IS NULL) OR (entry_starts_at IS NULL))),
    CONSTRAINT competitions_check1 CHECK (((entry_deadline_date IS NULL) OR (entry_deadline_at IS NULL))),
    CONSTRAINT competitions_check2 CHECK (((competition_start_date IS NULL) OR (competition_starts_at IS NULL))),
    CONSTRAINT competitions_check3 CHECK (((competition_end_date IS NULL) OR (competition_ends_at IS NULL))),
    CONSTRAINT competitions_check4 CHECK (((minimum_age IS NULL) OR (maximum_age IS NULL) OR (minimum_age <= maximum_age))),
    CONSTRAINT competitions_contract_id_check CHECK ((contract_id ~ '^[A-Za-z0-9_.:-]{1,64}$'::text)),
    CONSTRAINT competitions_maximum_age_check CHECK (((maximum_age >= 0) AND (maximum_age <= 150))),
    CONSTRAINT competitions_minimum_age_check CHECK (((minimum_age >= 0) AND (minimum_age <= 150))),
    CONSTRAINT competitions_name_check CHECK (((name = btrim(name)) AND (name <> ''::text))),
    CONSTRAINT competitions_revision_check CHECK ((revision > 0))
);

--
-- Name: match_format_versions; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.match_format_versions (
    id uuid DEFAULT uuidv7() NOT NULL,
    match_format_id uuid NOT NULL,
    version_no integer NOT NULL,
    sets_to_win smallint NOT NULL,
    set_target_games smallint NOT NULL,
    set_tiebreak_at_games smallint NOT NULL,
    deciding_set_type text NOT NULL,
    no_ad boolean NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT match_format_versions_check CHECK (((set_tiebreak_at_games = set_target_games) OR (set_tiebreak_at_games = (set_target_games - 1)))),
    CONSTRAINT match_format_versions_deciding_set_type_check CHECK ((deciding_set_type = ANY (ARRAY['full_set'::text, 'match_tiebreak_10'::text, 'match_tiebreak_7'::text]))),
    CONSTRAINT match_format_versions_set_target_games_check CHECK ((set_target_games = ANY (ARRAY[4, 6]))),
    CONSTRAINT match_format_versions_set_tiebreak_at_games_check CHECK ((set_tiebreak_at_games = ANY (ARRAY[3, 6]))),
    CONSTRAINT match_format_versions_sets_to_win_check CHECK ((sets_to_win = ANY (ARRAY[2, 3]))),
    CONSTRAINT match_format_versions_version_no_check CHECK ((version_no > 0))
);

--
-- Name: match_formats; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.match_formats (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    contract_id text NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT match_formats_contract_id_check CHECK ((contract_id ~ '^[1-9][0-9]*$'::text)),
    CONSTRAINT match_formats_name_check CHECK (((name = btrim(name)) AND (name <> ''::text)))
);

--
-- Name: match_participants; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.match_participants (
    id uuid DEFAULT uuidv7() NOT NULL,
    match_id uuid NOT NULL,
    side_id uuid NOT NULL,
    position_no smallint NOT NULL,
    participant_type text NOT NULL,
    person_id uuid,
    CONSTRAINT match_participants_check CHECK (((participant_type = 'person'::text) = (person_id IS NOT NULL))),
    CONSTRAINT match_participants_check1 CHECK (((participant_type <> 'open_bracket'::text) OR (position_no = 1))),
    CONSTRAINT match_participants_participant_type_check CHECK ((participant_type = ANY (ARRAY['person'::text, 'bye'::text, 'open_bracket'::text]))),
    CONSTRAINT match_participants_position_no_check CHECK ((position_no = ANY (ARRAY[1, 2])))
);

--
-- Name: match_progressions; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.match_progressions (
    id uuid DEFAULT uuidv7() NOT NULL,
    competition_id uuid NOT NULL,
    source_match_id uuid NOT NULL,
    source_outcome text NOT NULL,
    target_match_id uuid NOT NULL,
    target_side_no smallint NOT NULL,
    CONSTRAINT match_progressions_check CHECK ((source_match_id <> target_match_id)),
    CONSTRAINT match_progressions_source_outcome_check CHECK ((source_outcome = 'winner'::text)),
    CONSTRAINT match_progressions_target_side_no_check CHECK ((target_side_no = ANY (ARRAY[1, 2])))
);

--
-- Name: match_ranking_effects; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.match_ranking_effects (
    match_result_history_id uuid NOT NULL,
    ranking_change_id uuid NOT NULL,
    challenger_rank_snapshot integer,
    challenged_rank_snapshot integer,
    CONSTRAINT match_ranking_effects_challenged_rank_snapshot_check CHECK ((challenged_rank_snapshot >= 0)),
    CONSTRAINT match_ranking_effects_challenger_rank_snapshot_check CHECK ((challenger_rank_snapshot >= 0))
);

--
-- Name: match_result_history; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.match_result_history (
    id uuid DEFAULT uuidv7() NOT NULL,
    match_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    change_type text NOT NULL,
    before_result_id uuid,
    after_result_id uuid,
    actor_person_id uuid,
    administrative_reason text,
    changed_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT match_result_history_administrative_reason_check CHECK (((administrative_reason IS NULL) OR ((length(btrim(administrative_reason)) >= 3) AND (length(btrim(administrative_reason)) <= 500)))),
    CONSTRAINT match_result_history_change_type_check CHECK ((change_type = ANY (ARRAY['created'::text, 'corrected'::text, 'cleared'::text, 'end_corrected'::text, 'legacy_snapshot'::text]))),
    CONSTRAINT match_result_history_check CHECK (((before_result_id IS NOT NULL) OR (after_result_id IS NOT NULL))),
    CONSTRAINT match_result_history_check1 CHECK (((change_type <> 'cleared'::text) OR ((before_result_id IS NOT NULL) AND (after_result_id IS NULL))))
);

--
-- Name: match_result_sets; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.match_result_sets (
    result_id uuid NOT NULL,
    set_no smallint NOT NULL,
    side_one_games smallint NOT NULL,
    side_two_games smallint NOT NULL,
    loser_tiebreak_points smallint,
    incomplete boolean DEFAULT false NOT NULL,
    CONSTRAINT match_result_sets_loser_tiebreak_points_check CHECK (((loser_tiebreak_points >= 0) AND (loser_tiebreak_points <= 99))),
    CONSTRAINT match_result_sets_set_no_check CHECK (((set_no >= 1) AND (set_no <= 5))),
    CONSTRAINT match_result_sets_side_one_games_check CHECK (((side_one_games >= 0) AND (side_one_games <= 99))),
    CONSTRAINT match_result_sets_side_two_games_check CHECK (((side_two_games >= 0) AND (side_two_games <= 99)))
);

--
-- Name: match_results; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.match_results (
    id uuid DEFAULT uuidv7() NOT NULL,
    match_id uuid NOT NULL,
    version_no integer NOT NULL,
    completion_type text NOT NULL,
    winner_side_no smallint NOT NULL,
    play_started_at timestamp(3) with time zone,
    play_ended_at timestamp(3) with time zone,
    first_captured_at timestamp(3) with time zone,
    walkover_at timestamp(3) with time zone,
    side_one_rank_snapshot integer,
    side_two_rank_snapshot integer,
    provenance text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT match_results_check CHECK (((play_ended_at IS NULL) OR (play_started_at IS NULL) OR (play_ended_at > play_started_at))),
    CONSTRAINT match_results_check1 CHECK (((completion_type = 'walkover'::text) = (walkover_at IS NOT NULL))),
    CONSTRAINT match_results_completion_type_check CHECK ((completion_type = ANY (ARRAY['regular'::text, 'walkover'::text, 'retirement'::text]))),
    CONSTRAINT match_results_provenance_check CHECK ((provenance = ANY (ARRAY['legacy_snapshot'::text, 'postgresql'::text]))),
    CONSTRAINT match_results_side_one_rank_snapshot_check CHECK ((side_one_rank_snapshot >= 0)),
    CONSTRAINT match_results_side_two_rank_snapshot_check CHECK ((side_two_rank_snapshot >= 0)),
    CONSTRAINT match_results_version_no_check CHECK ((version_no > 0)),
    CONSTRAINT match_results_winner_side_no_check CHECK ((winner_side_no = ANY (ARRAY[1, 2])))
);

--
-- Name: match_sides; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.match_sides (
    id uuid DEFAULT uuidv7() NOT NULL,
    match_id uuid NOT NULL,
    side_no smallint NOT NULL,
    CONSTRAINT match_sides_side_no_check CHECK ((side_no = ANY (ARRAY[1, 2])))
);

--
-- Name: matches; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.matches (
    id uuid DEFAULT uuidv7() NOT NULL,
    competition_id uuid NOT NULL,
    contract_id text NOT NULL,
    match_format_version_id uuid NOT NULL,
    format_binding_source text NOT NULL,
    round_code text,
    challenged_at timestamp(3) with time zone,
    scheduled_at timestamp(3) with time zone,
    reserved_duration_minutes integer,
    is_ignored boolean DEFAULT false NOT NULL,
    legacy_ptn_rating text,
    note text,
    current_result_id uuid,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT matches_contract_id_check CHECK ((contract_id ~ '^[A-Za-z0-9_.:-]{1,64}$'::text)),
    CONSTRAINT matches_format_binding_source_check CHECK ((format_binding_source = ANY (ARRAY['competition_default'::text, 'match_override'::text]))),
    CONSTRAINT matches_reserved_duration_minutes_check CHECK ((reserved_duration_minutes >= 0)),
    CONSTRAINT matches_revision_check CHECK ((revision > 0))
);

--
-- Name: match_status; Type: VIEW; Schema: play; Owner: -
--

CREATE VIEW play.match_status AS
 SELECT id AS match_id,
        CASE
            WHEN (current_result_id IS NOT NULL) THEN 'completed'::text
            WHEN (EXISTS ( SELECT 1
               FROM play.match_participants p
              WHERE ((p.match_id = m.id) AND (p.participant_type = 'open_bracket'::text)))) THEN 'open_bracket'::text
            WHEN (EXISTS ( SELECT 1
               FROM play.match_participants p
              WHERE ((p.match_id = m.id) AND (p.participant_type = 'bye'::text)))) THEN 'bye'::text
            ELSE 'open'::text
        END AS status
   FROM play.matches m;

--
-- Name: ranking_change_items; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.ranking_change_items (
    ranking_change_id uuid NOT NULL,
    person_id uuid NOT NULL,
    before_rank integer,
    after_rank integer,
    CONSTRAINT ranking_change_items_after_rank_check CHECK (((after_rank IS NULL) OR (after_rank >= 0))),
    CONSTRAINT ranking_change_items_before_rank_check CHECK (((before_rank IS NULL) OR (before_rank >= 0))),
    CONSTRAINT ranking_change_items_check CHECK ((before_rank IS DISTINCT FROM after_rank))
);

--
-- Name: ranking_changes; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.ranking_changes (
    id uuid DEFAULT uuidv7() NOT NULL,
    competition_id uuid NOT NULL,
    match_result_history_id uuid NOT NULL,
    created_at timestamp(3) with time zone NOT NULL
);

--
-- Name: ranking_entries; Type: TABLE; Schema: play; Owner: -
--

CREATE TABLE play.ranking_entries (
    id uuid DEFAULT uuidv7() NOT NULL,
    competition_id uuid NOT NULL,
    person_id uuid NOT NULL,
    contract_id text,
    status text NOT NULL,
    rank integer,
    last_active_rank integer,
    withdrawn_at timestamp(3) with time zone,
    withdrawal_reason text,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT ranking_entries_check CHECK ((((status = 'active'::text) AND (rank IS NOT NULL)) OR ((status = 'withdrawn'::text) AND (rank IS NULL) AND (last_active_rank IS NOT NULL) AND (withdrawn_at IS NOT NULL) AND ((length(btrim(withdrawal_reason)) >= 3) AND (length(btrim(withdrawal_reason)) <= 500))))),
    CONSTRAINT ranking_entries_last_active_rank_check CHECK ((last_active_rank > 0)),
    CONSTRAINT ranking_entries_rank_check CHECK ((rank > 0)),
    CONSTRAINT ranking_entries_revision_check CHECK ((revision > 0)),
    CONSTRAINT ranking_entries_status_check CHECK ((status = ANY (ARRAY['active'::text, 'withdrawn'::text])))
);

--
-- Name: court_assignment_participants; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.court_assignment_participants (
    assignment_id uuid NOT NULL,
    side_no smallint NOT NULL,
    position_no smallint NOT NULL,
    person_id uuid NOT NULL,
    first_name_snapshot text,
    last_name_snapshot text NOT NULL,
    CONSTRAINT court_assignment_participants_position_no_check CHECK ((position_no = ANY (ARRAY[1, 2]))),
    CONSTRAINT court_assignment_participants_side_no_check CHECK ((side_no = ANY (ARRAY[1, 2])))
);

--
-- Name: court_assignments; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.court_assignments (
    id uuid DEFAULT uuidv7() NOT NULL,
    court_id uuid NOT NULL,
    assignment_type text DEFAULT 'match'::text NOT NULL,
    match_id uuid,
    competition_id uuid,
    match_format_version_id uuid,
    competition_name_snapshot text,
    round_code_snapshot text,
    scheduled_at_snapshot timestamp(3) with time zone,
    automation_status text,
    assigned_at timestamp(3) with time zone NOT NULL,
    assigned_by_person_id uuid,
    released_at timestamp(3) with time zone,
    released_by_person_id uuid,
    CONSTRAINT court_assignments_assignment_type_check CHECK ((assignment_type = ANY (ARRAY['match'::text, 'manual'::text]))),
    CONSTRAINT court_assignments_automation_status_check CHECK ((automation_status = ANY (ARRAY['pending'::text, 'activated'::text, 'finished'::text, 'expired'::text, 'unscheduled'::text]))),
    CONSTRAINT court_assignments_check CHECK (((released_at IS NULL) OR (released_at >= assigned_at))),
    CONSTRAINT court_assignments_check1 CHECK ((((assignment_type = 'match'::text) AND (match_id IS NOT NULL) AND (competition_id IS NOT NULL) AND (match_format_version_id IS NOT NULL)) OR ((assignment_type = 'manual'::text) AND (match_id IS NULL))))
);

--
-- Name: court_live_state; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.court_live_state (
    court_id uuid NOT NULL,
    assignment_id uuid,
    source_id uuid,
    active boolean DEFAULT false NOT NULL,
    awaiting_baseline boolean DEFAULT false NOT NULL,
    side_one_set_one text DEFAULT '0'::text NOT NULL,
    side_two_set_one text DEFAULT '0'::text NOT NULL,
    side_one_set_two text DEFAULT '0'::text NOT NULL,
    side_two_set_two text DEFAULT '0'::text NOT NULL,
    side_one_set_three text DEFAULT '0'::text NOT NULL,
    side_two_set_three text DEFAULT '0'::text NOT NULL,
    side_one_points text DEFAULT '0'::text NOT NULL,
    side_two_points text DEFAULT '0'::text NOT NULL,
    baseline_sha256 bytea,
    source_state text DEFAULT 'unknown'::text NOT NULL,
    last_source_at timestamp(3) with time zone,
    epoch bigint DEFAULT 0 NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT court_live_state_baseline_sha256_check CHECK (((baseline_sha256 IS NULL) OR (octet_length(baseline_sha256) = 32))),
    CONSTRAINT court_live_state_check CHECK (((NOT active) OR (source_id IS NOT NULL))),
    CONSTRAINT court_live_state_epoch_check CHECK ((epoch >= 0)),
    CONSTRAINT court_live_state_revision_check CHECK ((revision > 0)),
    CONSTRAINT court_live_state_source_state_check CHECK ((source_state = ANY (ARRAY['unknown'::text, 'ready'::text, 'stale'::text, 'failed'::text])))
);

--
-- Name: court_state_events; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.court_state_events (
    id uuid DEFAULT uuidv7() NOT NULL,
    court_id uuid NOT NULL,
    assignment_id uuid,
    actor_person_id uuid,
    event_type text NOT NULL,
    resulting_revision bigint NOT NULL,
    occurred_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT court_state_events_event_type_check CHECK ((event_type = ANY (ARRAY['reset'::text, 'activated'::text, 'deactivated'::text, 'assignment_started'::text, 'assignment_ended'::text]))),
    CONSTRAINT court_state_events_resulting_revision_check CHECK ((resulting_revision > 0))
);

--
-- Name: courts; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.courts (
    id uuid DEFAULT uuidv7() NOT NULL,
    site_id uuid NOT NULL,
    court_code text NOT NULL,
    display_name text NOT NULL,
    active boolean DEFAULT false NOT NULL,
    epoch bigint DEFAULT 0 NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    CONSTRAINT courts_court_code_check CHECK ((court_code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'::text)),
    CONSTRAINT courts_display_name_check CHECK (((display_name = btrim(display_name)) AND (display_name <> ''::text))),
    CONSTRAINT courts_epoch_check CHECK ((epoch >= 0)),
    CONSTRAINT courts_revision_check CHECK ((revision > 0))
);

--
-- Name: hall_time_allocations; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.hall_time_allocations (
    id uuid DEFAULT uuidv7() NOT NULL,
    slot_id uuid NOT NULL,
    person_id uuid NOT NULL,
    status text NOT NULL,
    queued_at timestamp(3) with time zone NOT NULL,
    assigned_at timestamp(3) with time zone,
    created_by_person_id uuid,
    CONSTRAINT hall_time_allocations_check CHECK ((((status = 'confirmed'::text) AND (assigned_at IS NOT NULL)) OR ((status = 'waiting'::text) AND (assigned_at IS NULL)))),
    CONSTRAINT hall_time_allocations_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'waiting'::text])))
);

--
-- Name: hall_time_constraints; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.hall_time_constraints (
    id uuid DEFAULT uuidv7() NOT NULL,
    grid_id uuid NOT NULL,
    person_id uuid NOT NULL,
    slot_id uuid NOT NULL,
    constraint_type text NOT NULL,
    created_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT hall_time_constraints_constraint_type_check CHECK ((constraint_type = ANY (ARRAY['unavailable'::text, 'avoid'::text])))
);

--
-- Name: hall_time_grid_participants; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.hall_time_grid_participants (
    grid_id uuid NOT NULL,
    person_id uuid NOT NULL,
    joined_at timestamp(3) with time zone NOT NULL,
    left_at timestamp(3) with time zone,
    CONSTRAINT hall_time_grid_participants_check CHECK (((left_at IS NULL) OR (left_at >= joined_at)))
);

--
-- Name: hall_time_grids; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.hall_time_grids (
    id uuid DEFAULT uuidv7() NOT NULL,
    section_id uuid NOT NULL,
    contract_id text NOT NULL,
    name text NOT NULL,
    description text,
    mode text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    public_join_enabled boolean DEFAULT false NOT NULL,
    capacity smallint NOT NULL,
    waiting_list_enabled boolean DEFAULT false NOT NULL,
    waiting_limit_per_person smallint,
    fair_use_enabled boolean DEFAULT false NOT NULL,
    fair_use_open_days integer,
    revision bigint DEFAULT 1 NOT NULL,
    projection_revision bigint DEFAULT 1 NOT NULL,
    CONSTRAINT hall_time_grids_capacity_check CHECK ((capacity > 0)),
    CONSTRAINT hall_time_grids_check CHECK ((waiting_list_enabled OR (waiting_limit_per_person IS NULL))),
    CONSTRAINT hall_time_grids_contract_id_check CHECK ((contract_id ~ '^[A-Za-z0-9_.:-]{1,64}$'::text)),
    CONSTRAINT hall_time_grids_fair_use_open_days_check CHECK ((fair_use_open_days >= 0)),
    CONSTRAINT hall_time_grids_mode_check CHECK ((mode = ANY (ARRAY['reservation'::text, 'allocation'::text]))),
    CONSTRAINT hall_time_grids_name_check CHECK (((name = btrim(name)) AND (name <> ''::text))),
    CONSTRAINT hall_time_grids_projection_revision_check CHECK ((projection_revision > 0)),
    CONSTRAINT hall_time_grids_revision_check CHECK ((revision > 0)),
    CONSTRAINT hall_time_grids_waiting_limit_per_person_check CHECK ((waiting_limit_per_person > 0))
);

--
-- Name: hall_time_history; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.hall_time_history (
    id uuid DEFAULT uuidv7() NOT NULL,
    grid_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    action_code text NOT NULL,
    actor_person_id uuid,
    occurred_at timestamp(3) with time zone NOT NULL,
    item_count integer NOT NULL,
    CONSTRAINT hall_time_history_item_count_check CHECK ((item_count > 0))
);

--
-- Name: hall_time_history_items; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.hall_time_history_items (
    history_id uuid NOT NULL,
    item_no integer NOT NULL,
    slot_id uuid,
    person_id uuid,
    before_status text,
    after_status text,
    slot_starts_at_snapshot timestamp(3) with time zone NOT NULL,
    person_contract_id_snapshot text,
    person_name_snapshot text,
    CONSTRAINT hall_time_history_items_after_status_check CHECK ((after_status = ANY (ARRAY['confirmed'::text, 'waiting'::text]))),
    CONSTRAINT hall_time_history_items_before_status_check CHECK ((before_status = ANY (ARRAY['confirmed'::text, 'waiting'::text]))),
    CONSTRAINT hall_time_history_items_check CHECK (((before_status IS NOT NULL) OR (after_status IS NOT NULL))),
    CONSTRAINT hall_time_history_items_item_no_check CHECK ((item_no > 0))
);

--
-- Name: hall_time_slots; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.hall_time_slots (
    id uuid DEFAULT uuidv7() NOT NULL,
    grid_id uuid NOT NULL,
    starts_at timestamp(3) with time zone NOT NULL,
    ends_at timestamp(3) with time zone NOT NULL,
    capacity smallint NOT NULL,
    slot_revision bigint DEFAULT 1 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT hall_time_slots_capacity_check CHECK ((capacity > 0)),
    CONSTRAINT hall_time_slots_check CHECK ((ends_at > starts_at)),
    CONSTRAINT hall_time_slots_slot_revision_check CHECK ((slot_revision > 0))
);

--
-- Name: monitor_commands; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.monitor_commands (
    id uuid DEFAULT uuidv7() NOT NULL,
    monitor_id uuid NOT NULL,
    command_id uuid NOT NULL,
    command_type text NOT NULL,
    operation_id uuid,
    target_revision bigint,
    target_path text,
    stream_id uuid,
    stream_sequence bigint,
    delta_y integer,
    status text DEFAULT 'queued'::text NOT NULL,
    error_code text,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    acknowledged_at timestamp(3) with time zone,
    expires_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT monitor_commands_check CHECK ((expires_at > created_at)),
    CONSTRAINT monitor_commands_check1 CHECK (((acknowledged_at IS NULL) OR (acknowledged_at >= created_at))),
    CONSTRAINT monitor_commands_check2 CHECK ((((command_type = 'navigate'::text) AND (target_revision IS NOT NULL) AND (target_path IS NOT NULL) AND (stream_id IS NULL) AND (stream_sequence IS NULL) AND (delta_y IS NULL)) OR ((command_type = 'scroll'::text) AND (target_revision IS NULL) AND (target_path IS NULL) AND (stream_id IS NOT NULL) AND (stream_sequence IS NOT NULL) AND (delta_y IS NOT NULL)) OR ((command_type = 'reload'::text) AND (target_revision IS NOT NULL) AND (target_path IS NULL) AND (stream_id IS NULL) AND (stream_sequence IS NULL) AND (delta_y IS NULL)))),
    CONSTRAINT monitor_commands_command_type_check CHECK ((command_type = ANY (ARRAY['navigate'::text, 'scroll'::text, 'reload'::text]))),
    CONSTRAINT monitor_commands_delta_y_check CHECK (((delta_y IS NULL) OR (delta_y = ANY (ARRAY['-300'::integer, 300])))),
    CONSTRAINT monitor_commands_error_code_check CHECK (((error_code IS NULL) OR (error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'::text))),
    CONSTRAINT monitor_commands_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'received'::text, 'loading'::text, 'loaded'::text, 'applied'::text, 'failed'::text, 'offline'::text]))),
    CONSTRAINT monitor_commands_stream_sequence_check CHECK (((stream_sequence IS NULL) OR (stream_sequence > 0))),
    CONSTRAINT monitor_commands_target_path_check CHECK (((target_path IS NULL) OR (((length(target_path) >= 2) AND (length(target_path) <= 500)) AND (target_path ~ '^/[A-Za-z0-9_./?&=:%+-]+$'::text)))),
    CONSTRAINT monitor_commands_target_revision_check CHECK ((target_revision > 0))
);

--
-- Name: monitor_devices; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.monitor_devices (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    contract_id text NOT NULL,
    label text NOT NULL,
    token_hash bytea NOT NULL,
    target_type text DEFAULT 'page'::text NOT NULL,
    page_key text,
    competition_id uuid,
    hall_time_grid_id uuid,
    target_path text DEFAULT '/index.html'::text NOT NULL,
    target_command_id uuid,
    target_issued_at timestamp(3) with time zone,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
    revoked_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    CONSTRAINT monitor_devices_check CHECK (((target_command_id IS NULL) = (target_issued_at IS NULL))),
    CONSTRAINT monitor_devices_check1 CHECK ((((target_type = 'page'::text) AND (page_key IS NOT NULL) AND (competition_id IS NULL) AND (hall_time_grid_id IS NULL)) OR ((target_type = ANY (ARRAY['competition'::text, 'ranking'::text, 'entry_list'::text, 'competition_history'::text])) AND (page_key IS NULL) AND (competition_id IS NOT NULL) AND (hall_time_grid_id IS NULL)) OR ((target_type = 'hall_time_grid'::text) AND (page_key IS NULL) AND (competition_id IS NULL) AND (hall_time_grid_id IS NOT NULL)))),
    CONSTRAINT monitor_devices_contract_id_check CHECK ((contract_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'::text)),
    CONSTRAINT monitor_devices_label_check CHECK (((label = btrim(label)) AND (label <> ''::text))),
    CONSTRAINT monitor_devices_revision_check CHECK ((revision > 0)),
    CONSTRAINT monitor_devices_target_path_check CHECK ((((length(target_path) >= 2) AND (length(target_path) <= 500)) AND (target_path ~ '^/[A-Za-z0-9_./?&=:%+-]+$'::text))),
    CONSTRAINT monitor_devices_target_type_check CHECK ((target_type = ANY (ARRAY['page'::text, 'competition'::text, 'ranking'::text, 'entry_list'::text, 'competition_history'::text, 'hall_time_grid'::text]))),
    CONSTRAINT monitor_devices_token_hash_check CHECK ((octet_length(token_hash) = 32))
);

--
-- Name: navigation_presets; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.navigation_presets (
    id uuid DEFAULT uuidv7() NOT NULL,
    tenant_id uuid NOT NULL,
    contract_id text,
    profile_code text DEFAULT '1'::text NOT NULL,
    label text NOT NULL,
    target_type text,
    page_key text,
    competition_id uuid,
    hall_time_grid_id uuid,
    enabled boolean DEFAULT true NOT NULL,
    problem_code text,
    legacy_target text,
    sort_order integer,
    CONSTRAINT navigation_presets_check CHECK ((enabled OR (problem_code IS NOT NULL))),
    CONSTRAINT navigation_presets_label_check CHECK (((label = btrim(label)) AND (label <> ''::text))),
    CONSTRAINT navigation_presets_legacy_target_check CHECK (((legacy_target IS NULL) OR (length(legacy_target) <= 500))),
    CONSTRAINT navigation_presets_profile_code_check CHECK (((profile_code = btrim(profile_code)) AND (profile_code <> ''::text))),
    CONSTRAINT navigation_presets_target_type_check CHECK ((target_type = ANY (ARRAY['page'::text, 'competition'::text, 'ranking'::text, 'entry_list'::text, 'competition_history'::text, 'hall_time_grid'::text])))
);

--
-- Name: score_events; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.score_events (
    id uuid DEFAULT uuidv7() NOT NULL,
    event_id uuid NOT NULL,
    court_id uuid NOT NULL,
    assignment_id uuid,
    source_id uuid NOT NULL,
    court_sequence bigint NOT NULL,
    source_occurred_at timestamp(3) with time zone,
    accepted_at timestamp(3) with time zone NOT NULL,
    side_one_set_one text NOT NULL,
    side_two_set_one text NOT NULL,
    side_one_set_two text NOT NULL,
    side_two_set_two text NOT NULL,
    side_one_set_three text NOT NULL,
    side_two_set_three text NOT NULL,
    side_one_points text NOT NULL,
    side_two_points text NOT NULL,
    court_revision bigint NOT NULL,
    source_instance text NOT NULL,
    source_sequence bigint,
    source_key text,
    source_sha256 bytea,
    CONSTRAINT score_events_court_revision_check CHECK ((court_revision > 0)),
    CONSTRAINT score_events_court_sequence_check CHECK ((court_sequence > 0)),
    CONSTRAINT score_events_source_sha256_check CHECK (((source_sha256 IS NULL) OR (octet_length(source_sha256) = 32)))
);

--
-- Name: score_sources; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.score_sources (
    id uuid DEFAULT uuidv7() NOT NULL,
    court_id uuid NOT NULL,
    source_type text NOT NULL,
    source_key text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT score_sources_source_key_check CHECK (((source_key = btrim(source_key)) AND (source_key <> ''::text))),
    CONSTRAINT score_sources_source_type_check CHECK ((source_type = 'legacy_court_receiver'::text))
);

--
-- Name: sites; Type: TABLE; Schema: venue; Owner: -
--

CREATE TABLE venue.sites (
    id uuid DEFAULT uuidv7() NOT NULL,
    section_id uuid NOT NULL,
    site_code text NOT NULL,
    display_name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT sites_display_name_check CHECK (((display_name = btrim(display_name)) AND (display_name <> ''::text))),
    CONSTRAINT sites_site_code_check CHECK ((site_code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'::text))
);

--
-- Name: configuration_entries configuration_entries_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.configuration_entries
    ADD CONSTRAINT configuration_entries_pkey PRIMARY KEY (tenant_id, configuration_key);

--
-- Name: projection_revisions projection_revisions_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.projection_revisions
    ADD CONSTRAINT projection_revisions_pkey PRIMARY KEY (tenant_id, projection_key);

--
-- Name: sections sections_id_tenant_id_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sections
    ADD CONSTRAINT sections_id_tenant_id_key UNIQUE (id, tenant_id);

--
-- Name: sections sections_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sections
    ADD CONSTRAINT sections_pkey PRIMARY KEY (id);

--
-- Name: sections sections_tenant_id_section_code_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sections
    ADD CONSTRAINT sections_tenant_id_section_code_key UNIQUE (tenant_id, section_code);

--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);

--
-- Name: tenants tenants_singleton_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.tenants
    ADD CONSTRAINT tenants_singleton_key UNIQUE (singleton);

--
-- Name: tenants tenants_tenant_code_key; Type: CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.tenants
    ADD CONSTRAINT tenants_tenant_code_key UNIQUE (tenant_code);

--
-- Name: credentials credentials_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.credentials
    ADD CONSTRAINT credentials_pkey PRIMARY KEY (id);

--
-- Name: frontend_logging_settings frontend_logging_settings_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.frontend_logging_settings
    ADD CONSTRAINT frontend_logging_settings_pkey PRIMARY KEY (tenant_id);

--
-- Name: frontend_logging_targets frontend_logging_targets_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.frontend_logging_targets
    ADD CONSTRAINT frontend_logging_targets_pkey PRIMARY KEY (tenant_id, person_id);

--
-- Name: login_rate_limits login_rate_limits_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.login_rate_limits
    ADD CONSTRAINT login_rate_limits_pkey PRIMARY KEY (key_type, key_hash);

--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);

--
-- Name: password_authorizations password_authorizations_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.password_authorizations
    ADD CONSTRAINT password_authorizations_pkey PRIMARY KEY (id);

--
-- Name: people people_id_tenant_id_key; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.people
    ADD CONSTRAINT people_id_tenant_id_key UNIQUE (id, tenant_id);

--
-- Name: people people_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.people
    ADD CONSTRAINT people_pkey PRIMARY KEY (id);

--
-- Name: people people_tenant_id_contract_id_key; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.people
    ADD CONSTRAINT people_tenant_id_contract_id_key UNIQUE (tenant_id, contract_id);

--
-- Name: person_addresses person_addresses_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.person_addresses
    ADD CONSTRAINT person_addresses_pkey PRIMARY KEY (id);

--
-- Name: person_contacts person_contacts_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.person_contacts
    ADD CONSTRAINT person_contacts_pkey PRIMARY KEY (id);

--
-- Name: person_external_identifiers person_external_identifiers_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.person_external_identifiers
    ADD CONSTRAINT person_external_identifiers_pkey PRIMARY KEY (id);

--
-- Name: person_external_identifiers person_external_identifiers_tenant_id_provider_external_val_key; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.person_external_identifiers
    ADD CONSTRAINT person_external_identifiers_tenant_id_provider_external_val_key UNIQUE (tenant_id, provider, external_value);

--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

--
-- Name: sessions sessions_token_hash_key; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.sessions
    ADD CONSTRAINT sessions_token_hash_key UNIQUE (token_hash);

--
-- Name: tenant_role_assignments tenant_role_assignments_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_role_assignments
    ADD CONSTRAINT tenant_role_assignments_pkey PRIMARY KEY (id);

--
-- Name: user_accounts user_accounts_id_tenant_id_key; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_accounts
    ADD CONSTRAINT user_accounts_id_tenant_id_key UNIQUE (id, tenant_id);

--
-- Name: user_accounts user_accounts_person_id_key; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_accounts
    ADD CONSTRAINT user_accounts_person_id_key UNIQUE (person_id);

--
-- Name: user_accounts user_accounts_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_accounts
    ADD CONSTRAINT user_accounts_pkey PRIMARY KEY (id);

--
-- Name: user_accounts user_accounts_tenant_id_login_key; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_accounts
    ADD CONSTRAINT user_accounts_tenant_id_login_key UNIQUE (tenant_id, login);

--
-- Name: user_favorites user_favorites_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_favorites
    ADD CONSTRAINT user_favorites_pkey PRIMARY KEY (account_id, "position");

--
-- Name: user_preference_states user_preference_states_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_preference_states
    ADD CONSTRAINT user_preference_states_pkey PRIMARY KEY (account_id);

--
-- Name: user_start_pages user_start_pages_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_start_pages
    ADD CONSTRAINT user_start_pages_pkey PRIMARY KEY (account_id);

--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);

--
-- Name: deliveries deliveries_channel_idempotency_key_key; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.deliveries
    ADD CONSTRAINT deliveries_channel_idempotency_key_key UNIQUE (channel, idempotency_key);

--
-- Name: deliveries deliveries_pkey; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.deliveries
    ADD CONSTRAINT deliveries_pkey PRIMARY KEY (id);

--
-- Name: deliveries deliveries_recipient_id_channel_key; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.deliveries
    ADD CONSTRAINT deliveries_recipient_id_channel_key UNIQUE (recipient_id, channel);

--
-- Name: event_participants event_participants_pkey; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.event_participants
    ADD CONSTRAINT event_participants_pkey PRIMARY KEY (event_id, participant_role, contract_id_snapshot);

--
-- Name: event_recipients event_recipients_event_id_person_id_key; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.event_recipients
    ADD CONSTRAINT event_recipients_event_id_person_id_key UNIQUE (event_id, person_id);

--
-- Name: event_recipients event_recipients_pkey; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.event_recipients
    ADD CONSTRAINT event_recipients_pkey PRIMARY KEY (id);

--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);

--
-- Name: events events_tenant_id_contract_id_key; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.events
    ADD CONSTRAINT events_tenant_id_contract_id_key UNIQUE (tenant_id, contract_id);

--
-- Name: events events_tenant_id_source_operation_id_event_type_key; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.events
    ADD CONSTRAINT events_tenant_id_source_operation_id_event_type_key UNIQUE (tenant_id, source_operation_id, event_type);

--
-- Name: history_revision history_revision_pkey; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.history_revision
    ADD CONSTRAINT history_revision_pkey PRIMARY KEY (singleton);

--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (person_id, channel);

--
-- Name: reactions reactions_pkey; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.reactions
    ADD CONSTRAINT reactions_pkey PRIMARY KEY (id);

--
-- Name: receipts receipts_pkey; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.receipts
    ADD CONSTRAINT receipts_pkey PRIMARY KEY (recipient_id);

--
-- Name: user_revisions user_revisions_pkey; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.user_revisions
    ADD CONSTRAINT user_revisions_pkey PRIMARY KEY (person_id);

--
-- Name: audit_operations audit_operations_pkey; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.audit_operations
    ADD CONSTRAINT audit_operations_pkey PRIMARY KEY (id);

--
-- Name: audit_operations audit_operations_tenant_id_operation_id_key; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.audit_operations
    ADD CONSTRAINT audit_operations_tenant_id_operation_id_key UNIQUE (tenant_id, operation_id);

--
-- Name: audit_security_context audit_security_context_pkey; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.audit_security_context
    ADD CONSTRAINT audit_security_context_pkey PRIMARY KEY (audit_operation_id);

--
-- Name: audit_transitions audit_transitions_audit_operation_id_transition_key; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.audit_transitions
    ADD CONSTRAINT audit_transitions_audit_operation_id_transition_key UNIQUE (audit_operation_id, transition);

--
-- Name: audit_transitions audit_transitions_pkey; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.audit_transitions
    ADD CONSTRAINT audit_transitions_pkey PRIMARY KEY (id);

--
-- Name: idempotency_operations idempotency_operations_pkey; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.idempotency_operations
    ADD CONSTRAINT idempotency_operations_pkey PRIMARY KEY (id);

--
-- Name: idempotency_operations idempotency_operations_tenant_id_operation_id_key; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.idempotency_operations
    ADD CONSTRAINT idempotency_operations_tenant_id_operation_id_key UNIQUE (tenant_id, operation_id);

--
-- Name: import_findings import_findings_import_run_id_finding_code_source_projectio_key; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.import_findings
    ADD CONSTRAINT import_findings_import_run_id_finding_code_source_projectio_key UNIQUE (import_run_id, finding_code, source_projection, source_reference);

--
-- Name: import_findings import_findings_pkey; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.import_findings
    ADD CONSTRAINT import_findings_pkey PRIMARY KEY (id);

--
-- Name: import_runs import_runs_pkey; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.import_runs
    ADD CONSTRAINT import_runs_pkey PRIMARY KEY (id);

--
-- Name: import_runs import_runs_tenant_id_export_run_id_key; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.import_runs
    ADD CONSTRAINT import_runs_tenant_id_export_run_id_key UNIQUE (tenant_id, export_run_id);

--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);

--
-- Name: jobs jobs_tenant_id_job_type_idempotency_key_key; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.jobs
    ADD CONSTRAINT jobs_tenant_id_job_type_idempotency_key_key UNIQUE (tenant_id, job_type, idempotency_key);

--
-- Name: outbox outbox_pkey; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.outbox
    ADD CONSTRAINT outbox_pkey PRIMARY KEY (id);

--
-- Name: outbox outbox_tenant_id_event_type_idempotency_key_key; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.outbox
    ADD CONSTRAINT outbox_tenant_id_event_type_idempotency_key_key UNIQUE (tenant_id, event_type, idempotency_key);

--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (migration_id);

--
-- Name: seed_runs seed_runs_pkey; Type: CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.seed_runs
    ADD CONSTRAINT seed_runs_pkey PRIMARY KEY (id);

--
-- Name: competition_entries competition_entries_competition_id_contract_id_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competition_entries
    ADD CONSTRAINT competition_entries_competition_id_contract_id_key UNIQUE (competition_id, contract_id);

--
-- Name: competition_entries competition_entries_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competition_entries
    ADD CONSTRAINT competition_entries_pkey PRIMARY KEY (id);

--
-- Name: competition_gender_eligibility competition_gender_eligibility_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competition_gender_eligibility
    ADD CONSTRAINT competition_gender_eligibility_pkey PRIMARY KEY (competition_id, gender_code);

--
-- Name: competition_type_versions competition_type_versions_competition_type_id_version_no_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competition_type_versions
    ADD CONSTRAINT competition_type_versions_competition_type_id_version_no_key UNIQUE (competition_type_id, version_no);

--
-- Name: competition_type_versions competition_type_versions_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competition_type_versions
    ADD CONSTRAINT competition_type_versions_pkey PRIMARY KEY (id);

--
-- Name: competition_types competition_types_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competition_types
    ADD CONSTRAINT competition_types_pkey PRIMARY KEY (id);

--
-- Name: competition_types competition_types_tenant_id_contract_id_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competition_types
    ADD CONSTRAINT competition_types_tenant_id_contract_id_key UNIQUE (tenant_id, contract_id);

--
-- Name: competitions competitions_id_section_id_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competitions
    ADD CONSTRAINT competitions_id_section_id_key UNIQUE (id, section_id);

--
-- Name: competitions competitions_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competitions
    ADD CONSTRAINT competitions_pkey PRIMARY KEY (id);

--
-- Name: competitions competitions_section_id_contract_id_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competitions
    ADD CONSTRAINT competitions_section_id_contract_id_key UNIQUE (section_id, contract_id);

--
-- Name: match_format_versions match_format_versions_match_format_id_version_no_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_format_versions
    ADD CONSTRAINT match_format_versions_match_format_id_version_no_key UNIQUE (match_format_id, version_no);

--
-- Name: match_format_versions match_format_versions_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_format_versions
    ADD CONSTRAINT match_format_versions_pkey PRIMARY KEY (id);

--
-- Name: match_formats match_formats_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_formats
    ADD CONSTRAINT match_formats_pkey PRIMARY KEY (id);

--
-- Name: match_formats match_formats_tenant_id_contract_id_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_formats
    ADD CONSTRAINT match_formats_tenant_id_contract_id_key UNIQUE (tenant_id, contract_id);

--
-- Name: match_participants match_participants_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_participants
    ADD CONSTRAINT match_participants_pkey PRIMARY KEY (id);

--
-- Name: match_participants match_participants_side_id_position_no_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_participants
    ADD CONSTRAINT match_participants_side_id_position_no_key UNIQUE (side_id, position_no);

--
-- Name: match_progressions match_progressions_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_progressions
    ADD CONSTRAINT match_progressions_pkey PRIMARY KEY (id);

--
-- Name: match_progressions match_progressions_source_match_id_source_outcome_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_progressions
    ADD CONSTRAINT match_progressions_source_match_id_source_outcome_key UNIQUE (source_match_id, source_outcome);

--
-- Name: match_progressions match_progressions_target_match_id_target_side_no_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_progressions
    ADD CONSTRAINT match_progressions_target_match_id_target_side_no_key UNIQUE (target_match_id, target_side_no);

--
-- Name: match_ranking_effects match_ranking_effects_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_ranking_effects
    ADD CONSTRAINT match_ranking_effects_pkey PRIMARY KEY (match_result_history_id);

--
-- Name: match_ranking_effects match_ranking_effects_ranking_change_id_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_ranking_effects
    ADD CONSTRAINT match_ranking_effects_ranking_change_id_key UNIQUE (ranking_change_id);

--
-- Name: match_result_history match_result_history_operation_id_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_result_history
    ADD CONSTRAINT match_result_history_operation_id_key UNIQUE (operation_id);

--
-- Name: match_result_history match_result_history_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_result_history
    ADD CONSTRAINT match_result_history_pkey PRIMARY KEY (id);

--
-- Name: match_result_sets match_result_sets_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_result_sets
    ADD CONSTRAINT match_result_sets_pkey PRIMARY KEY (result_id, set_no);

--
-- Name: match_results match_results_id_match_id_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_results
    ADD CONSTRAINT match_results_id_match_id_key UNIQUE (id, match_id);

--
-- Name: match_results match_results_match_id_version_no_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_results
    ADD CONSTRAINT match_results_match_id_version_no_key UNIQUE (match_id, version_no);

--
-- Name: match_results match_results_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_results
    ADD CONSTRAINT match_results_pkey PRIMARY KEY (id);

--
-- Name: match_sides match_sides_id_match_id_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_sides
    ADD CONSTRAINT match_sides_id_match_id_key UNIQUE (id, match_id);

--
-- Name: match_sides match_sides_match_id_side_no_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_sides
    ADD CONSTRAINT match_sides_match_id_side_no_key UNIQUE (match_id, side_no);

--
-- Name: match_sides match_sides_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_sides
    ADD CONSTRAINT match_sides_pkey PRIMARY KEY (id);

--
-- Name: matches matches_competition_id_contract_id_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.matches
    ADD CONSTRAINT matches_competition_id_contract_id_key UNIQUE (competition_id, contract_id);

--
-- Name: matches matches_id_competition_id_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.matches
    ADD CONSTRAINT matches_id_competition_id_key UNIQUE (id, competition_id);

--
-- Name: matches matches_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);

--
-- Name: ranking_change_items ranking_change_items_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.ranking_change_items
    ADD CONSTRAINT ranking_change_items_pkey PRIMARY KEY (ranking_change_id, person_id);

--
-- Name: ranking_changes ranking_changes_match_result_history_id_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.ranking_changes
    ADD CONSTRAINT ranking_changes_match_result_history_id_key UNIQUE (match_result_history_id);

--
-- Name: ranking_changes ranking_changes_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.ranking_changes
    ADD CONSTRAINT ranking_changes_pkey PRIMARY KEY (id);

--
-- Name: ranking_entries ranking_entries_competition_id_person_id_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.ranking_entries
    ADD CONSTRAINT ranking_entries_competition_id_person_id_key UNIQUE (competition_id, person_id);

--
-- Name: ranking_entries ranking_entries_id_competition_id_key; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.ranking_entries
    ADD CONSTRAINT ranking_entries_id_competition_id_key UNIQUE (id, competition_id);

--
-- Name: ranking_entries ranking_entries_pkey; Type: CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.ranking_entries
    ADD CONSTRAINT ranking_entries_pkey PRIMARY KEY (id);

--
-- Name: court_assignment_participants court_assignment_participants_assignment_id_person_id_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_assignment_participants
    ADD CONSTRAINT court_assignment_participants_assignment_id_person_id_key UNIQUE (assignment_id, person_id);

--
-- Name: court_assignment_participants court_assignment_participants_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_assignment_participants
    ADD CONSTRAINT court_assignment_participants_pkey PRIMARY KEY (assignment_id, side_no, position_no);

--
-- Name: court_assignments court_assignments_id_court_id_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_assignments
    ADD CONSTRAINT court_assignments_id_court_id_key UNIQUE (id, court_id);

--
-- Name: court_assignments court_assignments_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_assignments
    ADD CONSTRAINT court_assignments_pkey PRIMARY KEY (id);

--
-- Name: court_live_state court_live_state_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_live_state
    ADD CONSTRAINT court_live_state_pkey PRIMARY KEY (court_id);

--
-- Name: court_state_events court_state_events_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_state_events
    ADD CONSTRAINT court_state_events_pkey PRIMARY KEY (id);

--
-- Name: courts courts_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.courts
    ADD CONSTRAINT courts_pkey PRIMARY KEY (id);

--
-- Name: courts courts_site_id_court_code_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.courts
    ADD CONSTRAINT courts_site_id_court_code_key UNIQUE (site_id, court_code);

--
-- Name: hall_time_allocations hall_time_allocations_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_allocations
    ADD CONSTRAINT hall_time_allocations_pkey PRIMARY KEY (id);

--
-- Name: hall_time_allocations hall_time_allocations_slot_id_person_id_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_allocations
    ADD CONSTRAINT hall_time_allocations_slot_id_person_id_key UNIQUE (slot_id, person_id);

--
-- Name: hall_time_constraints hall_time_constraints_grid_id_person_id_slot_id_constraint__key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_constraints
    ADD CONSTRAINT hall_time_constraints_grid_id_person_id_slot_id_constraint__key UNIQUE (grid_id, person_id, slot_id, constraint_type);

--
-- Name: hall_time_constraints hall_time_constraints_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_constraints
    ADD CONSTRAINT hall_time_constraints_pkey PRIMARY KEY (id);

--
-- Name: hall_time_grid_participants hall_time_grid_participants_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_grid_participants
    ADD CONSTRAINT hall_time_grid_participants_pkey PRIMARY KEY (grid_id, person_id);

--
-- Name: hall_time_grids hall_time_grids_id_section_id_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_grids
    ADD CONSTRAINT hall_time_grids_id_section_id_key UNIQUE (id, section_id);

--
-- Name: hall_time_grids hall_time_grids_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_grids
    ADD CONSTRAINT hall_time_grids_pkey PRIMARY KEY (id);

--
-- Name: hall_time_grids hall_time_grids_section_id_contract_id_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_grids
    ADD CONSTRAINT hall_time_grids_section_id_contract_id_key UNIQUE (section_id, contract_id);

--
-- Name: hall_time_history_items hall_time_history_items_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_history_items
    ADD CONSTRAINT hall_time_history_items_pkey PRIMARY KEY (history_id, item_no);

--
-- Name: hall_time_history hall_time_history_operation_id_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_history
    ADD CONSTRAINT hall_time_history_operation_id_key UNIQUE (operation_id);

--
-- Name: hall_time_history hall_time_history_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_history
    ADD CONSTRAINT hall_time_history_pkey PRIMARY KEY (id);

--
-- Name: hall_time_slots hall_time_slots_grid_id_starts_at_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_slots
    ADD CONSTRAINT hall_time_slots_grid_id_starts_at_key UNIQUE (grid_id, starts_at);

--
-- Name: hall_time_slots hall_time_slots_id_grid_id_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_slots
    ADD CONSTRAINT hall_time_slots_id_grid_id_key UNIQUE (id, grid_id);

--
-- Name: hall_time_slots hall_time_slots_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_slots
    ADD CONSTRAINT hall_time_slots_pkey PRIMARY KEY (id);

--
-- Name: monitor_commands monitor_commands_monitor_id_command_id_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.monitor_commands
    ADD CONSTRAINT monitor_commands_monitor_id_command_id_key UNIQUE (monitor_id, command_id);

--
-- Name: monitor_commands monitor_commands_monitor_id_operation_id_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.monitor_commands
    ADD CONSTRAINT monitor_commands_monitor_id_operation_id_key UNIQUE (monitor_id, operation_id);

--
-- Name: monitor_commands monitor_commands_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.monitor_commands
    ADD CONSTRAINT monitor_commands_pkey PRIMARY KEY (id);

--
-- Name: monitor_devices monitor_devices_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.monitor_devices
    ADD CONSTRAINT monitor_devices_pkey PRIMARY KEY (id);

--
-- Name: monitor_devices monitor_devices_tenant_id_contract_id_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.monitor_devices
    ADD CONSTRAINT monitor_devices_tenant_id_contract_id_key UNIQUE (tenant_id, contract_id);

--
-- Name: monitor_devices monitor_devices_token_hash_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.monitor_devices
    ADD CONSTRAINT monitor_devices_token_hash_key UNIQUE (token_hash);

--
-- Name: navigation_presets navigation_presets_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.navigation_presets
    ADD CONSTRAINT navigation_presets_pkey PRIMARY KEY (id);

--
-- Name: navigation_presets navigation_presets_tenant_id_profile_code_label_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.navigation_presets
    ADD CONSTRAINT navigation_presets_tenant_id_profile_code_label_key UNIQUE (tenant_id, profile_code, label);

--
-- Name: score_events score_events_court_id_court_sequence_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.score_events
    ADD CONSTRAINT score_events_court_id_court_sequence_key UNIQUE (court_id, court_sequence);

--
-- Name: score_events score_events_event_id_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.score_events
    ADD CONSTRAINT score_events_event_id_key UNIQUE (event_id);

--
-- Name: score_events score_events_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.score_events
    ADD CONSTRAINT score_events_pkey PRIMARY KEY (id);

--
-- Name: score_sources score_sources_court_id_source_type_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.score_sources
    ADD CONSTRAINT score_sources_court_id_source_type_key UNIQUE (court_id, source_type);

--
-- Name: score_sources score_sources_id_court_id_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.score_sources
    ADD CONSTRAINT score_sources_id_court_id_key UNIQUE (id, court_id);

--
-- Name: score_sources score_sources_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.score_sources
    ADD CONSTRAINT score_sources_pkey PRIMARY KEY (id);

--
-- Name: score_sources score_sources_source_type_source_key_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.score_sources
    ADD CONSTRAINT score_sources_source_type_source_key_key UNIQUE (source_type, source_key);

--
-- Name: sites sites_pkey; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.sites
    ADD CONSTRAINT sites_pkey PRIMARY KEY (id);

--
-- Name: sites sites_section_id_site_code_key; Type: CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.sites
    ADD CONSTRAINT sites_section_id_site_code_key UNIQUE (section_id, site_code);

--
-- Name: credentials_one_active_password; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX credentials_one_active_password ON identity.credentials USING btree (account_id, credential_type) WHERE active;

--
-- Name: frontend_logging_targets_expiry; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX frontend_logging_targets_expiry ON identity.frontend_logging_targets USING btree (expires_at);

--
-- Name: login_rate_limits_expiry; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX login_rate_limits_expiry ON identity.login_rate_limits USING btree (expires_at);

--
-- Name: memberships_one_current; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX memberships_one_current ON identity.memberships USING btree (section_id, person_id) WHERE (valid_until IS NULL);

--
-- Name: password_authorizations_one_open; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX password_authorizations_one_open ON identity.password_authorizations USING btree (account_id) WHERE ((consumed_at IS NULL) AND (revoked_at IS NULL));

--
-- Name: person_addresses_one_active; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX person_addresses_one_active ON identity.person_addresses USING btree (person_id) WHERE active;

--
-- Name: person_contacts_one_active_type; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX person_contacts_one_active_type ON identity.person_contacts USING btree (person_id, contact_type) WHERE active;

--
-- Name: person_external_identifiers_one_active; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX person_external_identifiers_one_active ON identity.person_external_identifiers USING btree (person_id, provider) WHERE active;

--
-- Name: sessions_account_active; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX sessions_account_active ON identity.sessions USING btree (account_id, last_seen_at DESC) WHERE (revoked_at IS NULL);

--
-- Name: sessions_expiry; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX sessions_expiry ON identity.sessions USING btree (expires_at);

--
-- Name: tenant_role_assignments_one_active; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX tenant_role_assignments_one_active ON identity.tenant_role_assignments USING btree (tenant_id, person_id, role_code) WHERE (revoked_at IS NULL);

--
-- Name: comments_event_time; Type: INDEX; Schema: messaging; Owner: -
--

CREATE INDEX comments_event_time ON messaging.comments USING btree (event_id, created_at DESC, id DESC);

--
-- Name: event_recipients_person_time; Type: INDEX; Schema: messaging; Owner: -
--

CREATE INDEX event_recipients_person_time ON messaging.event_recipients USING btree (person_id, created_at DESC, id DESC);

--
-- Name: messaging_events_competition_time; Type: INDEX; Schema: messaging; Owner: -
--

CREATE INDEX messaging_events_competition_time ON messaging.events USING btree (competition_id, created_at DESC, id);

--
-- Name: reactions_comment_person; Type: INDEX; Schema: messaging; Owner: -
--

CREATE UNIQUE INDEX reactions_comment_person ON messaging.reactions USING btree (comment_id, person_id) WHERE (comment_id IS NOT NULL);

--
-- Name: reactions_event_person; Type: INDEX; Schema: messaging; Owner: -
--

CREATE UNIQUE INDEX reactions_event_person ON messaging.reactions USING btree (event_id, person_id) WHERE (event_id IS NOT NULL);

--
-- Name: audit_operations_retention; Type: INDEX; Schema: ops; Owner: -
--

CREATE INDEX audit_operations_retention ON ops.audit_operations USING btree (expires_at, id);

--
-- Name: idempotency_operations_recovery; Type: INDEX; Schema: ops; Owner: -
--

CREATE INDEX idempotency_operations_recovery ON ops.idempotency_operations USING btree (started_at) WHERE (status = 'started'::text);

--
-- Name: jobs_due; Type: INDEX; Schema: ops; Owner: -
--

CREATE INDEX jobs_due ON ops.jobs USING btree (available_at, id) WHERE (status = ANY (ARRAY['pending'::text, 'retrying'::text]));

--
-- Name: jobs_expired_lease; Type: INDEX; Schema: ops; Owner: -
--

CREATE INDEX jobs_expired_lease ON ops.jobs USING btree (lease_until, id) WHERE (status = 'leased'::text);

--
-- Name: outbox_due; Type: INDEX; Schema: ops; Owner: -
--

CREATE INDEX outbox_due ON ops.outbox USING btree (available_at, id) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));

--
-- Name: competition_entries_one_active; Type: INDEX; Schema: play; Owner: -
--

CREATE UNIQUE INDEX competition_entries_one_active ON play.competition_entries USING btree (competition_id, person_id) WHERE (status = 'active'::text);

--
-- Name: match_participants_person_once; Type: INDEX; Schema: play; Owner: -
--

CREATE UNIQUE INDEX match_participants_person_once ON play.match_participants USING btree (match_id, person_id) WHERE (person_id IS NOT NULL);

--
-- Name: matches_competition_schedule; Type: INDEX; Schema: play; Owner: -
--

CREATE INDEX matches_competition_schedule ON play.matches USING btree (competition_id, scheduled_at);

--
-- Name: ranking_entries_active_rank; Type: INDEX; Schema: play; Owner: -
--

CREATE UNIQUE INDEX ranking_entries_active_rank ON play.ranking_entries USING btree (competition_id, rank) WHERE (status = 'active'::text);

--
-- Name: ranking_entries_contract_id; Type: INDEX; Schema: play; Owner: -
--

CREATE UNIQUE INDEX ranking_entries_contract_id ON play.ranking_entries USING btree (competition_id, contract_id) WHERE (contract_id IS NOT NULL);

--
-- Name: court_assignments_open_court; Type: INDEX; Schema: venue; Owner: -
--

CREATE UNIQUE INDEX court_assignments_open_court ON venue.court_assignments USING btree (court_id) WHERE (released_at IS NULL);

--
-- Name: court_assignments_open_match; Type: INDEX; Schema: venue; Owner: -
--

CREATE UNIQUE INDEX court_assignments_open_match ON venue.court_assignments USING btree (match_id) WHERE (released_at IS NULL);

--
-- Name: court_state_events_court_time; Type: INDEX; Schema: venue; Owner: -
--

CREATE INDEX court_state_events_court_time ON venue.court_state_events USING btree (court_id, occurred_at, id);

--
-- Name: hall_time_allocations_queue; Type: INDEX; Schema: venue; Owner: -
--

CREATE INDEX hall_time_allocations_queue ON venue.hall_time_allocations USING btree (slot_id, queued_at, id) WHERE (status = 'waiting'::text);

--
-- Name: hall_time_history_retention; Type: INDEX; Schema: venue; Owner: -
--

CREATE INDEX hall_time_history_retention ON venue.hall_time_history USING btree (grid_id, occurred_at, id);

--
-- Name: monitor_commands_pending; Type: INDEX; Schema: venue; Owner: -
--

CREATE INDEX monitor_commands_pending ON venue.monitor_commands USING btree (monitor_id, created_at) WHERE (acknowledged_at IS NULL);

--
-- Name: score_events_assignment_sequence; Type: INDEX; Schema: venue; Owner: -
--

CREATE INDEX score_events_assignment_sequence ON venue.score_events USING btree (assignment_id, court_sequence DESC);

--
-- Name: configuration_entries configuration_entries_tenant_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.configuration_entries
    ADD CONSTRAINT configuration_entries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE CASCADE;

--
-- Name: projection_revisions projection_revisions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.projection_revisions
    ADD CONSTRAINT projection_revisions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE CASCADE;

--
-- Name: sections sections_tenant_id_fkey; Type: FK CONSTRAINT; Schema: core; Owner: -
--

ALTER TABLE ONLY core.sections
    ADD CONSTRAINT sections_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: credentials credentials_account_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.credentials
    ADD CONSTRAINT credentials_account_id_fkey FOREIGN KEY (account_id) REFERENCES identity.user_accounts(id) ON DELETE CASCADE;

--
-- Name: frontend_logging_settings frontend_logging_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.frontend_logging_settings
    ADD CONSTRAINT frontend_logging_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: frontend_logging_targets frontend_logging_targets_created_by_person_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.frontend_logging_targets
    ADD CONSTRAINT frontend_logging_targets_created_by_person_id_fkey FOREIGN KEY (created_by_person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: frontend_logging_targets frontend_logging_targets_person_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.frontend_logging_targets
    ADD CONSTRAINT frontend_logging_targets_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE CASCADE;

--
-- Name: frontend_logging_targets frontend_logging_targets_tenant_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.frontend_logging_targets
    ADD CONSTRAINT frontend_logging_targets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: memberships memberships_person_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.memberships
    ADD CONSTRAINT memberships_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: memberships memberships_section_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.memberships
    ADD CONSTRAINT memberships_section_id_fkey FOREIGN KEY (section_id) REFERENCES core.sections(id) ON DELETE RESTRICT;

--
-- Name: password_authorizations password_authorizations_account_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.password_authorizations
    ADD CONSTRAINT password_authorizations_account_id_fkey FOREIGN KEY (account_id) REFERENCES identity.user_accounts(id) ON DELETE CASCADE;

--
-- Name: password_authorizations password_authorizations_issued_by_person_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.password_authorizations
    ADD CONSTRAINT password_authorizations_issued_by_person_id_fkey FOREIGN KEY (issued_by_person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: people people_tenant_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.people
    ADD CONSTRAINT people_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: person_addresses person_addresses_person_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.person_addresses
    ADD CONSTRAINT person_addresses_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE CASCADE;

--
-- Name: person_contacts person_contacts_person_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.person_contacts
    ADD CONSTRAINT person_contacts_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE CASCADE;

--
-- Name: person_external_identifiers person_external_identifiers_person_id_tenant_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.person_external_identifiers
    ADD CONSTRAINT person_external_identifiers_person_id_tenant_id_fkey FOREIGN KEY (person_id, tenant_id) REFERENCES identity.people(id, tenant_id) ON DELETE RESTRICT;

--
-- Name: person_external_identifiers person_external_identifiers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.person_external_identifiers
    ADD CONSTRAINT person_external_identifiers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: sessions sessions_account_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.sessions
    ADD CONSTRAINT sessions_account_id_fkey FOREIGN KEY (account_id) REFERENCES identity.user_accounts(id) ON DELETE CASCADE;

--
-- Name: tenant_role_assignments tenant_role_assignments_granted_by_person_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_role_assignments
    ADD CONSTRAINT tenant_role_assignments_granted_by_person_id_fkey FOREIGN KEY (granted_by_person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: tenant_role_assignments tenant_role_assignments_person_id_tenant_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_role_assignments
    ADD CONSTRAINT tenant_role_assignments_person_id_tenant_id_fkey FOREIGN KEY (person_id, tenant_id) REFERENCES identity.people(id, tenant_id) ON DELETE RESTRICT;

--
-- Name: tenant_role_assignments tenant_role_assignments_revoked_by_person_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_role_assignments
    ADD CONSTRAINT tenant_role_assignments_revoked_by_person_id_fkey FOREIGN KEY (revoked_by_person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: tenant_role_assignments tenant_role_assignments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_role_assignments
    ADD CONSTRAINT tenant_role_assignments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: user_accounts user_accounts_person_id_tenant_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_accounts
    ADD CONSTRAINT user_accounts_person_id_tenant_id_fkey FOREIGN KEY (person_id, tenant_id) REFERENCES identity.people(id, tenant_id) ON DELETE RESTRICT;

--
-- Name: user_accounts user_accounts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_accounts
    ADD CONSTRAINT user_accounts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: user_favorites user_favorites_account_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_favorites
    ADD CONSTRAINT user_favorites_account_id_fkey FOREIGN KEY (account_id) REFERENCES identity.user_accounts(id) ON DELETE CASCADE;

--
-- Name: user_favorites user_favorites_competition_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_favorites
    ADD CONSTRAINT user_favorites_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES play.competitions(id) ON DELETE CASCADE;

--
-- Name: user_favorites user_favorites_hall_time_grid_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_favorites
    ADD CONSTRAINT user_favorites_hall_time_grid_id_fkey FOREIGN KEY (hall_time_grid_id) REFERENCES venue.hall_time_grids(id) ON DELETE CASCADE;

--
-- Name: user_preference_states user_preference_states_account_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_preference_states
    ADD CONSTRAINT user_preference_states_account_id_fkey FOREIGN KEY (account_id) REFERENCES identity.user_accounts(id) ON DELETE CASCADE;

--
-- Name: user_start_pages user_start_pages_account_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_start_pages
    ADD CONSTRAINT user_start_pages_account_id_fkey FOREIGN KEY (account_id) REFERENCES identity.user_accounts(id) ON DELETE CASCADE;

--
-- Name: user_start_pages user_start_pages_competition_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_start_pages
    ADD CONSTRAINT user_start_pages_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES play.competitions(id) ON DELETE CASCADE;

--
-- Name: user_start_pages user_start_pages_hall_time_grid_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_start_pages
    ADD CONSTRAINT user_start_pages_hall_time_grid_id_fkey FOREIGN KEY (hall_time_grid_id) REFERENCES venue.hall_time_grids(id) ON DELETE CASCADE;

--
-- Name: comments comments_author_person_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.comments
    ADD CONSTRAINT comments_author_person_id_fkey FOREIGN KEY (author_person_id) REFERENCES identity.people(id) ON DELETE SET NULL;

--
-- Name: comments comments_event_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.comments
    ADD CONSTRAINT comments_event_id_fkey FOREIGN KEY (event_id) REFERENCES messaging.events(id) ON DELETE CASCADE;

--
-- Name: comments comments_moderated_by_person_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.comments
    ADD CONSTRAINT comments_moderated_by_person_id_fkey FOREIGN KEY (moderated_by_person_id) REFERENCES identity.people(id) ON DELETE SET NULL;

--
-- Name: deliveries deliveries_recipient_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.deliveries
    ADD CONSTRAINT deliveries_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES messaging.event_recipients(id) ON DELETE CASCADE;

--
-- Name: event_participants event_participants_event_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.event_participants
    ADD CONSTRAINT event_participants_event_id_fkey FOREIGN KEY (event_id) REFERENCES messaging.events(id) ON DELETE CASCADE;

--
-- Name: event_participants event_participants_person_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.event_participants
    ADD CONSTRAINT event_participants_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE SET NULL;

--
-- Name: event_recipients event_recipients_event_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.event_recipients
    ADD CONSTRAINT event_recipients_event_id_fkey FOREIGN KEY (event_id) REFERENCES messaging.events(id) ON DELETE CASCADE;

--
-- Name: event_recipients event_recipients_person_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.event_recipients
    ADD CONSTRAINT event_recipients_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE CASCADE;

--
-- Name: events events_actor_person_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.events
    ADD CONSTRAINT events_actor_person_id_fkey FOREIGN KEY (actor_person_id) REFERENCES identity.people(id) ON DELETE SET NULL;

--
-- Name: events events_competition_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.events
    ADD CONSTRAINT events_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES play.competitions(id) ON DELETE RESTRICT;

--
-- Name: events events_match_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.events
    ADD CONSTRAINT events_match_id_fkey FOREIGN KEY (match_id) REFERENCES play.matches(id) ON DELETE RESTRICT;

--
-- Name: events events_match_result_history_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.events
    ADD CONSTRAINT events_match_result_history_id_fkey FOREIGN KEY (match_result_history_id) REFERENCES play.match_result_history(id) ON DELETE RESTRICT;

--
-- Name: events events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.events
    ADD CONSTRAINT events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: notification_preferences notification_preferences_person_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.notification_preferences
    ADD CONSTRAINT notification_preferences_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE CASCADE;

--
-- Name: reactions reactions_comment_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.reactions
    ADD CONSTRAINT reactions_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES messaging.comments(id) ON DELETE CASCADE;

--
-- Name: reactions reactions_event_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.reactions
    ADD CONSTRAINT reactions_event_id_fkey FOREIGN KEY (event_id) REFERENCES messaging.events(id) ON DELETE CASCADE;

--
-- Name: reactions reactions_person_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.reactions
    ADD CONSTRAINT reactions_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE CASCADE;

--
-- Name: receipts receipts_recipient_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.receipts
    ADD CONSTRAINT receipts_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES messaging.event_recipients(id) ON DELETE CASCADE;

--
-- Name: user_revisions user_revisions_person_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.user_revisions
    ADD CONSTRAINT user_revisions_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE CASCADE;

--
-- Name: audit_operations audit_operations_actor_person_id_fkey; Type: FK CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.audit_operations
    ADD CONSTRAINT audit_operations_actor_person_id_fkey FOREIGN KEY (actor_person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: audit_operations audit_operations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.audit_operations
    ADD CONSTRAINT audit_operations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: audit_security_context audit_security_context_audit_operation_id_fkey; Type: FK CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.audit_security_context
    ADD CONSTRAINT audit_security_context_audit_operation_id_fkey FOREIGN KEY (audit_operation_id) REFERENCES ops.audit_operations(id) ON DELETE CASCADE;

--
-- Name: audit_transitions audit_transitions_audit_operation_id_fkey; Type: FK CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.audit_transitions
    ADD CONSTRAINT audit_transitions_audit_operation_id_fkey FOREIGN KEY (audit_operation_id) REFERENCES ops.audit_operations(id) ON DELETE CASCADE;

--
-- Name: idempotency_operations idempotency_operations_actor_person_id_fkey; Type: FK CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.idempotency_operations
    ADD CONSTRAINT idempotency_operations_actor_person_id_fkey FOREIGN KEY (actor_person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: idempotency_operations idempotency_operations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.idempotency_operations
    ADD CONSTRAINT idempotency_operations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: import_findings import_findings_import_run_id_fkey; Type: FK CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.import_findings
    ADD CONSTRAINT import_findings_import_run_id_fkey FOREIGN KEY (import_run_id) REFERENCES ops.import_runs(id) ON DELETE CASCADE;

--
-- Name: import_runs import_runs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.import_runs
    ADD CONSTRAINT import_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: jobs jobs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.jobs
    ADD CONSTRAINT jobs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: outbox outbox_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.outbox
    ADD CONSTRAINT outbox_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: seed_runs seed_runs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ops; Owner: -
--

ALTER TABLE ONLY ops.seed_runs
    ADD CONSTRAINT seed_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: competition_entries competition_entries_competition_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competition_entries
    ADD CONSTRAINT competition_entries_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES play.competitions(id) ON DELETE RESTRICT;

--
-- Name: competition_entries competition_entries_person_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competition_entries
    ADD CONSTRAINT competition_entries_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: competition_gender_eligibility competition_gender_eligibility_competition_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competition_gender_eligibility
    ADD CONSTRAINT competition_gender_eligibility_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES play.competitions(id) ON DELETE CASCADE;

--
-- Name: competition_type_versions competition_type_versions_competition_type_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competition_type_versions
    ADD CONSTRAINT competition_type_versions_competition_type_id_fkey FOREIGN KEY (competition_type_id) REFERENCES play.competition_types(id) ON DELETE RESTRICT;

--
-- Name: competition_types competition_types_tenant_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competition_types
    ADD CONSTRAINT competition_types_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: competitions competitions_competition_type_version_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competitions
    ADD CONSTRAINT competitions_competition_type_version_id_fkey FOREIGN KEY (competition_type_version_id) REFERENCES play.competition_type_versions(id) ON DELETE RESTRICT;

--
-- Name: competitions competitions_default_match_format_version_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competitions
    ADD CONSTRAINT competitions_default_match_format_version_id_fkey FOREIGN KEY (default_match_format_version_id) REFERENCES play.match_format_versions(id) ON DELETE RESTRICT;

--
-- Name: competitions competitions_section_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.competitions
    ADD CONSTRAINT competitions_section_id_fkey FOREIGN KEY (section_id) REFERENCES core.sections(id) ON DELETE RESTRICT;

--
-- Name: match_format_versions match_format_versions_match_format_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_format_versions
    ADD CONSTRAINT match_format_versions_match_format_id_fkey FOREIGN KEY (match_format_id) REFERENCES play.match_formats(id) ON DELETE RESTRICT;

--
-- Name: match_formats match_formats_tenant_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_formats
    ADD CONSTRAINT match_formats_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: match_participants match_participants_match_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_participants
    ADD CONSTRAINT match_participants_match_id_fkey FOREIGN KEY (match_id) REFERENCES play.matches(id) ON DELETE CASCADE;

--
-- Name: match_participants match_participants_person_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_participants
    ADD CONSTRAINT match_participants_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: match_participants match_participants_side_id_match_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_participants
    ADD CONSTRAINT match_participants_side_id_match_id_fkey FOREIGN KEY (side_id, match_id) REFERENCES play.match_sides(id, match_id) ON DELETE CASCADE;

--
-- Name: match_progressions match_progressions_competition_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_progressions
    ADD CONSTRAINT match_progressions_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES play.competitions(id) ON DELETE RESTRICT;

--
-- Name: match_progressions match_progressions_source_match_id_competition_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_progressions
    ADD CONSTRAINT match_progressions_source_match_id_competition_id_fkey FOREIGN KEY (source_match_id, competition_id) REFERENCES play.matches(id, competition_id) ON DELETE CASCADE;

--
-- Name: match_progressions match_progressions_target_match_id_competition_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_progressions
    ADD CONSTRAINT match_progressions_target_match_id_competition_id_fkey FOREIGN KEY (target_match_id, competition_id) REFERENCES play.matches(id, competition_id) ON DELETE CASCADE;

--
-- Name: match_ranking_effects match_ranking_effects_match_result_history_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_ranking_effects
    ADD CONSTRAINT match_ranking_effects_match_result_history_id_fkey FOREIGN KEY (match_result_history_id) REFERENCES play.match_result_history(id) ON DELETE RESTRICT;

--
-- Name: match_ranking_effects match_ranking_effects_ranking_change_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_ranking_effects
    ADD CONSTRAINT match_ranking_effects_ranking_change_id_fkey FOREIGN KEY (ranking_change_id) REFERENCES play.ranking_changes(id) ON DELETE RESTRICT;

--
-- Name: match_result_history match_result_history_actor_person_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_result_history
    ADD CONSTRAINT match_result_history_actor_person_id_fkey FOREIGN KEY (actor_person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: match_result_history match_result_history_after_result_id_match_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_result_history
    ADD CONSTRAINT match_result_history_after_result_id_match_id_fkey FOREIGN KEY (after_result_id, match_id) REFERENCES play.match_results(id, match_id) ON DELETE RESTRICT;

--
-- Name: match_result_history match_result_history_before_result_id_match_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_result_history
    ADD CONSTRAINT match_result_history_before_result_id_match_id_fkey FOREIGN KEY (before_result_id, match_id) REFERENCES play.match_results(id, match_id) ON DELETE RESTRICT;

--
-- Name: match_result_history match_result_history_match_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_result_history
    ADD CONSTRAINT match_result_history_match_id_fkey FOREIGN KEY (match_id) REFERENCES play.matches(id) ON DELETE RESTRICT;

--
-- Name: match_result_sets match_result_sets_result_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_result_sets
    ADD CONSTRAINT match_result_sets_result_id_fkey FOREIGN KEY (result_id) REFERENCES play.match_results(id) ON DELETE CASCADE;

--
-- Name: match_results match_results_match_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_results
    ADD CONSTRAINT match_results_match_id_fkey FOREIGN KEY (match_id) REFERENCES play.matches(id) ON DELETE RESTRICT;

--
-- Name: match_sides match_sides_match_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.match_sides
    ADD CONSTRAINT match_sides_match_id_fkey FOREIGN KEY (match_id) REFERENCES play.matches(id) ON DELETE CASCADE;

--
-- Name: matches matches_competition_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.matches
    ADD CONSTRAINT matches_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES play.competitions(id) ON DELETE RESTRICT;

--
-- Name: matches matches_current_result_fk; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.matches
    ADD CONSTRAINT matches_current_result_fk FOREIGN KEY (current_result_id, id) REFERENCES play.match_results(id, match_id) DEFERRABLE;

--
-- Name: matches matches_match_format_version_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.matches
    ADD CONSTRAINT matches_match_format_version_id_fkey FOREIGN KEY (match_format_version_id) REFERENCES play.match_format_versions(id) ON DELETE RESTRICT;

--
-- Name: ranking_change_items ranking_change_items_person_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.ranking_change_items
    ADD CONSTRAINT ranking_change_items_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: ranking_change_items ranking_change_items_ranking_change_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.ranking_change_items
    ADD CONSTRAINT ranking_change_items_ranking_change_id_fkey FOREIGN KEY (ranking_change_id) REFERENCES play.ranking_changes(id) ON DELETE CASCADE;

--
-- Name: ranking_changes ranking_changes_competition_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.ranking_changes
    ADD CONSTRAINT ranking_changes_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES play.competitions(id) ON DELETE RESTRICT;

--
-- Name: ranking_changes ranking_changes_match_result_history_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.ranking_changes
    ADD CONSTRAINT ranking_changes_match_result_history_id_fkey FOREIGN KEY (match_result_history_id) REFERENCES play.match_result_history(id) ON DELETE RESTRICT;

--
-- Name: ranking_entries ranking_entries_competition_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.ranking_entries
    ADD CONSTRAINT ranking_entries_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES play.competitions(id) ON DELETE RESTRICT;

--
-- Name: ranking_entries ranking_entries_person_id_fkey; Type: FK CONSTRAINT; Schema: play; Owner: -
--

ALTER TABLE ONLY play.ranking_entries
    ADD CONSTRAINT ranking_entries_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: court_assignment_participants court_assignment_participants_assignment_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_assignment_participants
    ADD CONSTRAINT court_assignment_participants_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES venue.court_assignments(id) ON DELETE CASCADE;

--
-- Name: court_assignment_participants court_assignment_participants_person_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_assignment_participants
    ADD CONSTRAINT court_assignment_participants_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: court_assignments court_assignments_assigned_by_person_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_assignments
    ADD CONSTRAINT court_assignments_assigned_by_person_id_fkey FOREIGN KEY (assigned_by_person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: court_assignments court_assignments_competition_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_assignments
    ADD CONSTRAINT court_assignments_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES play.competitions(id) ON DELETE RESTRICT;

--
-- Name: court_assignments court_assignments_court_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_assignments
    ADD CONSTRAINT court_assignments_court_id_fkey FOREIGN KEY (court_id) REFERENCES venue.courts(id) ON DELETE RESTRICT;

--
-- Name: court_assignments court_assignments_match_format_version_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_assignments
    ADD CONSTRAINT court_assignments_match_format_version_id_fkey FOREIGN KEY (match_format_version_id) REFERENCES play.match_format_versions(id) ON DELETE RESTRICT;

--
-- Name: court_assignments court_assignments_match_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_assignments
    ADD CONSTRAINT court_assignments_match_id_fkey FOREIGN KEY (match_id) REFERENCES play.matches(id) ON DELETE RESTRICT;

--
-- Name: court_assignments court_assignments_released_by_person_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_assignments
    ADD CONSTRAINT court_assignments_released_by_person_id_fkey FOREIGN KEY (released_by_person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: court_live_state court_live_state_assignment_id_court_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_live_state
    ADD CONSTRAINT court_live_state_assignment_id_court_id_fkey FOREIGN KEY (assignment_id, court_id) REFERENCES venue.court_assignments(id, court_id) ON DELETE RESTRICT;

--
-- Name: court_live_state court_live_state_court_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_live_state
    ADD CONSTRAINT court_live_state_court_id_fkey FOREIGN KEY (court_id) REFERENCES venue.courts(id) ON DELETE CASCADE;

--
-- Name: court_live_state court_live_state_source_id_court_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_live_state
    ADD CONSTRAINT court_live_state_source_id_court_id_fkey FOREIGN KEY (source_id, court_id) REFERENCES venue.score_sources(id, court_id) ON DELETE RESTRICT;

--
-- Name: court_state_events court_state_events_actor_person_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_state_events
    ADD CONSTRAINT court_state_events_actor_person_id_fkey FOREIGN KEY (actor_person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: court_state_events court_state_events_assignment_id_court_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_state_events
    ADD CONSTRAINT court_state_events_assignment_id_court_id_fkey FOREIGN KEY (assignment_id, court_id) REFERENCES venue.court_assignments(id, court_id) ON DELETE RESTRICT;

--
-- Name: court_state_events court_state_events_court_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.court_state_events
    ADD CONSTRAINT court_state_events_court_id_fkey FOREIGN KEY (court_id) REFERENCES venue.courts(id) ON DELETE RESTRICT;

--
-- Name: courts courts_site_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.courts
    ADD CONSTRAINT courts_site_id_fkey FOREIGN KEY (site_id) REFERENCES venue.sites(id) ON DELETE RESTRICT;

--
-- Name: hall_time_allocations hall_time_allocations_created_by_person_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_allocations
    ADD CONSTRAINT hall_time_allocations_created_by_person_id_fkey FOREIGN KEY (created_by_person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: hall_time_allocations hall_time_allocations_person_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_allocations
    ADD CONSTRAINT hall_time_allocations_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: hall_time_constraints hall_time_constraints_grid_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_constraints
    ADD CONSTRAINT hall_time_constraints_grid_id_fkey FOREIGN KEY (grid_id) REFERENCES venue.hall_time_grids(id) ON DELETE CASCADE;

--
-- Name: hall_time_constraints hall_time_constraints_person_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_constraints
    ADD CONSTRAINT hall_time_constraints_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: hall_time_constraints hall_time_constraints_slot_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_constraints
    ADD CONSTRAINT hall_time_constraints_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES venue.hall_time_slots(id) ON DELETE CASCADE;

--
-- Name: hall_time_constraints hall_time_constraints_slot_id_grid_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_constraints
    ADD CONSTRAINT hall_time_constraints_slot_id_grid_id_fkey FOREIGN KEY (slot_id, grid_id) REFERENCES venue.hall_time_slots(id, grid_id) ON DELETE CASCADE;

--
-- Name: hall_time_grid_participants hall_time_grid_participants_grid_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_grid_participants
    ADD CONSTRAINT hall_time_grid_participants_grid_id_fkey FOREIGN KEY (grid_id) REFERENCES venue.hall_time_grids(id) ON DELETE CASCADE;

--
-- Name: hall_time_grid_participants hall_time_grid_participants_person_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_grid_participants
    ADD CONSTRAINT hall_time_grid_participants_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: hall_time_grids hall_time_grids_section_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_grids
    ADD CONSTRAINT hall_time_grids_section_id_fkey FOREIGN KEY (section_id) REFERENCES core.sections(id) ON DELETE RESTRICT;

--
-- Name: hall_time_history hall_time_history_actor_person_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_history
    ADD CONSTRAINT hall_time_history_actor_person_id_fkey FOREIGN KEY (actor_person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: hall_time_history hall_time_history_grid_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_history
    ADD CONSTRAINT hall_time_history_grid_id_fkey FOREIGN KEY (grid_id) REFERENCES venue.hall_time_grids(id) ON DELETE CASCADE;

--
-- Name: hall_time_history_items hall_time_history_items_history_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_history_items
    ADD CONSTRAINT hall_time_history_items_history_id_fkey FOREIGN KEY (history_id) REFERENCES venue.hall_time_history(id) ON DELETE CASCADE;

--
-- Name: hall_time_history_items hall_time_history_items_person_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_history_items
    ADD CONSTRAINT hall_time_history_items_person_id_fkey FOREIGN KEY (person_id) REFERENCES identity.people(id) ON DELETE RESTRICT;

--
-- Name: hall_time_history_items hall_time_history_items_slot_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_history_items
    ADD CONSTRAINT hall_time_history_items_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES venue.hall_time_slots(id) ON DELETE SET NULL;

--
-- Name: hall_time_slots hall_time_slots_grid_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.hall_time_slots
    ADD CONSTRAINT hall_time_slots_grid_id_fkey FOREIGN KEY (grid_id) REFERENCES venue.hall_time_grids(id) ON DELETE CASCADE;

--
-- Name: monitor_commands monitor_commands_monitor_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.monitor_commands
    ADD CONSTRAINT monitor_commands_monitor_id_fkey FOREIGN KEY (monitor_id) REFERENCES venue.monitor_devices(id) ON DELETE CASCADE;

--
-- Name: monitor_devices monitor_devices_competition_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.monitor_devices
    ADD CONSTRAINT monitor_devices_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES play.competitions(id) ON DELETE RESTRICT;

--
-- Name: monitor_devices monitor_devices_hall_grid_fk; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.monitor_devices
    ADD CONSTRAINT monitor_devices_hall_grid_fk FOREIGN KEY (hall_time_grid_id) REFERENCES venue.hall_time_grids(id) ON DELETE RESTRICT;

--
-- Name: monitor_devices monitor_devices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.monitor_devices
    ADD CONSTRAINT monitor_devices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: navigation_presets navigation_presets_competition_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.navigation_presets
    ADD CONSTRAINT navigation_presets_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES play.competitions(id) ON DELETE RESTRICT;

--
-- Name: navigation_presets navigation_presets_hall_grid_fk; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.navigation_presets
    ADD CONSTRAINT navigation_presets_hall_grid_fk FOREIGN KEY (hall_time_grid_id) REFERENCES venue.hall_time_grids(id) ON DELETE RESTRICT;

--
-- Name: navigation_presets navigation_presets_tenant_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.navigation_presets
    ADD CONSTRAINT navigation_presets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES core.tenants(id) ON DELETE RESTRICT;

--
-- Name: score_events score_events_assignment_id_court_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.score_events
    ADD CONSTRAINT score_events_assignment_id_court_id_fkey FOREIGN KEY (assignment_id, court_id) REFERENCES venue.court_assignments(id, court_id) ON DELETE RESTRICT;

--
-- Name: score_events score_events_court_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.score_events
    ADD CONSTRAINT score_events_court_id_fkey FOREIGN KEY (court_id) REFERENCES venue.courts(id) ON DELETE RESTRICT;

--
-- Name: score_events score_events_source_id_court_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.score_events
    ADD CONSTRAINT score_events_source_id_court_id_fkey FOREIGN KEY (source_id, court_id) REFERENCES venue.score_sources(id, court_id) ON DELETE RESTRICT;

--
-- Name: score_sources score_sources_court_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.score_sources
    ADD CONSTRAINT score_sources_court_id_fkey FOREIGN KEY (court_id) REFERENCES venue.courts(id) ON DELETE RESTRICT;

--
-- Name: sites sites_section_id_fkey; Type: FK CONSTRAINT; Schema: venue; Owner: -
--

ALTER TABLE ONLY venue.sites
    ADD CONSTRAINT sites_section_id_fkey FOREIGN KEY (section_id) REFERENCES core.sections(id) ON DELETE RESTRICT;

--
-- PostgreSQL database dump complete
--

\unrestrict 6570696265725f736368656d615f736e617073686f745f76310000000000000000

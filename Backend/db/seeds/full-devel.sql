INSERT INTO identity.people(id, tenant_id, contract_id, first_name, last_name, birth_date, gender_code, active)
VALUES
 ('0199c800-0000-7000-8000-000000000101', '0199c800-0000-7000-8000-000000000001', '1', 'Ada', 'Admin', '1980-01-01', 1, true),
 ('0199c800-0000-7000-8000-000000000102', '0199c800-0000-7000-8000-000000000001', '2', 'Olivia', 'Operator', '1985-02-02', 2, true),
 ('0199c800-0000-7000-8000-000000000103', '0199c800-0000-7000-8000-000000000001', '3', 'Peter', 'Player', '1990-03-03', 1, true),
 ('0199c800-0000-7000-8000-000000000104', '0199c800-0000-7000-8000-000000000001', '4', 'Ina', 'Inactive', NULL, 3, false),
 ('0199c800-0000-7000-8000-000000000105', '0199c800-0000-7000-8000-000000000001', '5', 'Dora', 'Dormant', NULL, NULL, true);

INSERT INTO identity.memberships(id, section_id, person_id, classification)
VALUES
 ('0199c800-0000-7000-8000-000000000111', '0199c800-0000-7000-8000-000000000002', '0199c800-0000-7000-8000-000000000101', 'player A'),
 ('0199c800-0000-7000-8000-000000000112', '0199c800-0000-7000-8000-000000000002', '0199c800-0000-7000-8000-000000000102', 'player B'),
 ('0199c800-0000-7000-8000-000000000113', '0199c800-0000-7000-8000-000000000002', '0199c800-0000-7000-8000-000000000103', 'player');

INSERT INTO identity.person_contacts(id, person_id, contact_type, contact_value)
VALUES
 ('0199c800-0000-7000-8000-000000000126', '0199c800-0000-7000-8000-000000000101', 'email', 'shared@example.test'),
 ('0199c800-0000-7000-8000-000000000127', '0199c800-0000-7000-8000-000000000102', 'email', 'shared@example.test'),
 ('0199c800-0000-7000-8000-000000000128', '0199c800-0000-7000-8000-000000000103', 'mobile', '0043 660 1234567');

INSERT INTO identity.user_accounts(id, tenant_id, person_id, login, active)
VALUES
 ('0199c800-0000-7000-8000-000000000121', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000101', 'admin', true),
 ('0199c800-0000-7000-8000-000000000122', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000102', 'operator', true),
 ('0199c800-0000-7000-8000-000000000123', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000103', 'player', true),
 ('0199c800-0000-7000-8000-000000000124', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000104', 'inactive', false),
 ('0199c800-0000-7000-8000-000000000125', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000105', NULL, true);

INSERT INTO identity.credentials(id, account_id, credential_type, credential_schema, secret_hash)
VALUES
 ('0199c800-0000-7000-8000-000000000135', '0199c800-0000-7000-8000-000000000121', 'password', 'scrypt_v1', 'scrypt$v1$16384$8$1$synthetic$admin'),
 ('0199c800-0000-7000-8000-000000000136', '0199c800-0000-7000-8000-000000000122', 'password', 'scrypt_v1', 'scrypt$v1$16384$8$1$synthetic$operator'),
 ('0199c800-0000-7000-8000-000000000137', '0199c800-0000-7000-8000-000000000123', 'password', 'legacy_sha256', repeat('a', 64)),
 ('0199c800-0000-7000-8000-000000000138', '0199c800-0000-7000-8000-000000000125', 'password', 'scrypt_v1', 'scrypt$v1$16384$8$1$synthetic$dormant');

INSERT INTO identity.tenant_role_assignments(id, tenant_id, person_id, role_code, granted_at)
VALUES
 ('0199c800-0000-7000-8000-000000000139', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000101', 'admin', '2026-01-01T00:00:00Z'),
 ('0199c800-0000-7000-8000-000000000140', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000101', 'operator', '2026-01-01T00:00:00Z'),
 ('0199c800-0000-7000-8000-000000000141', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000102', 'operator', '2026-01-01T00:00:00Z');

INSERT INTO play.competition_types(id, tenant_id, contract_id, name)
VALUES ('0199c800-0000-7000-8000-000000000201', '0199c800-0000-7000-8000-000000000001', '2', 'Rangliste');
INSERT INTO play.competition_type_versions(id, competition_type_id, version_no, entry_list_available, round_robin)
VALUES ('0199c800-0000-7000-8000-000000000202', '0199c800-0000-7000-8000-000000000201', 1, true, false);
INSERT INTO play.match_formats(id, tenant_id, contract_id, name)
VALUES ('0199c800-0000-7000-8000-000000000203', '0199c800-0000-7000-8000-000000000001', '1', 'Best of three');
INSERT INTO play.match_format_versions(id, match_format_id, version_no, sets_to_win, set_target_games, set_tiebreak_at_games, deciding_set_type, no_ad)
VALUES ('0199c800-0000-7000-8000-000000000204', '0199c800-0000-7000-8000-000000000203', 1, 2, 6, 6, 'full_set', false);
INSERT INTO play.competitions(id, section_id, contract_id, competition_type_version_id, default_match_format_version_id, name, competition_start_date, competition_end_date)
VALUES ('0199c800-0000-7000-8000-000000000205', '0199c800-0000-7000-8000-000000000002', '2', '0199c800-0000-7000-8000-000000000202', '0199c800-0000-7000-8000-000000000204', 'Synthetische Rangliste', '2026-01-01', '2026-12-31');
INSERT INTO play.competition_entries(id, competition_id, person_id, contract_id, entered_at, status)
VALUES
 ('0199c800-0000-7000-8000-000000000206', '0199c800-0000-7000-8000-000000000205', '0199c800-0000-7000-8000-000000000101', 'e-1', '2026-01-01T10:00:00Z', 'active'),
 ('0199c800-0000-7000-8000-000000000207', '0199c800-0000-7000-8000-000000000205', '0199c800-0000-7000-8000-000000000102', 'e-2', '2026-01-01T10:01:00Z', 'active');
INSERT INTO play.ranking_entries(id, competition_id, person_id, status, rank, last_active_rank, withdrawn_at, withdrawal_reason)
VALUES
 ('0199c800-0000-7000-8000-000000000211', '0199c800-0000-7000-8000-000000000205', '0199c800-0000-7000-8000-000000000101', 'active', 1, NULL, NULL, NULL),
 ('0199c800-0000-7000-8000-000000000212', '0199c800-0000-7000-8000-000000000205', '0199c800-0000-7000-8000-000000000102', 'active', 2, NULL, NULL, NULL),
 ('0199c800-0000-7000-8000-000000000213', '0199c800-0000-7000-8000-000000000205', '0199c800-0000-7000-8000-000000000103', 'withdrawn', NULL, 3, '2026-02-01T10:00:00Z', 'Synthetischer Rueckzug');

INSERT INTO play.matches(id, competition_id, contract_id, match_format_version_id, format_binding_source, challenged_at)
VALUES ('0199c800-0000-7000-8000-000000000220', '0199c800-0000-7000-8000-000000000205', 'm-seed', '0199c800-0000-7000-8000-000000000204', 'competition_default', '2026-03-01T10:00:00Z');
INSERT INTO play.match_sides(id, match_id, side_no)
VALUES
 ('0199c800-0000-7000-8000-000000000221', '0199c800-0000-7000-8000-000000000220', 1),
 ('0199c800-0000-7000-8000-000000000222', '0199c800-0000-7000-8000-000000000220', 2);
INSERT INTO play.match_participants(id, match_id, side_id, position_no, participant_type, person_id)
VALUES
 ('0199c800-0000-7000-8000-000000000224', '0199c800-0000-7000-8000-000000000220', '0199c800-0000-7000-8000-000000000221', 1, 'person', '0199c800-0000-7000-8000-000000000101'),
 ('0199c800-0000-7000-8000-000000000225', '0199c800-0000-7000-8000-000000000220', '0199c800-0000-7000-8000-000000000222', 1, 'person', '0199c800-0000-7000-8000-000000000102');
INSERT INTO play.match_results(id, match_id, version_no, completion_type, winner_side_no, play_started_at, play_ended_at, first_captured_at, side_one_rank_snapshot, side_two_rank_snapshot, provenance)
VALUES ('0199c800-0000-7000-8000-000000000223', '0199c800-0000-7000-8000-000000000220', 1, 'regular', 1, '2026-03-02T10:00:00Z', '2026-03-02T11:10:00Z', '2026-03-02T11:15:00Z', 1, 2, 'postgresql');
INSERT INTO play.match_result_sets(result_id, set_no, side_one_games, side_two_games)
VALUES ('0199c800-0000-7000-8000-000000000223', 1, 6, 3), ('0199c800-0000-7000-8000-000000000223', 2, 6, 4);
UPDATE play.matches SET current_result_id='0199c800-0000-7000-8000-000000000223', revision=2 WHERE id='0199c800-0000-7000-8000-000000000220';

INSERT INTO venue.sites(id, section_id, site_code, display_name)
VALUES ('0199c800-0000-7000-8000-000000000301', '0199c800-0000-7000-8000-000000000002', 'main', 'Hauptanlage');
INSERT INTO venue.courts(id, site_id, court_code, display_name)
VALUES ('0199c800-0000-7000-8000-000000000302', '0199c800-0000-7000-8000-000000000301', '1', 'Platz 1');
INSERT INTO venue.score_sources(id, court_id, source_type, source_key)
VALUES ('0199c800-0000-7000-8000-000000000303', '0199c800-0000-7000-8000-000000000302', 'legacy_court_receiver', 'synthetic-1');
INSERT INTO venue.court_live_state(court_id, source_id)
VALUES ('0199c800-0000-7000-8000-000000000302', '0199c800-0000-7000-8000-000000000303');
INSERT INTO venue.monitor_devices(id, tenant_id, contract_id, label, token_hash, target_type, page_key)
VALUES ('0199c800-0000-7000-8000-000000000304', '0199c800-0000-7000-8000-000000000001', 'monitor-seed', 'Testmonitor', decode(repeat('01',32),'hex'), 'page', 'index');

INSERT INTO venue.hall_time_grids(id, section_id, contract_id, name, mode, capacity, waiting_list_enabled, waiting_limit_per_person, fair_use_enabled, fair_use_open_days, created_at, updated_at)
VALUES ('0199c800-0000-7000-8000-000000000310', '0199c800-0000-7000-8000-000000000002', 'hall-seed', 'Synthetische Hallenzeit', 'reservation', 1, true, 2, true, 7, '2026-01-01T00:00:00Z', '2026-10-01T00:00:00Z');
INSERT INTO venue.hall_time_grid_participants(grid_id, person_id, joined_at)
VALUES
 ('0199c800-0000-7000-8000-000000000310', '0199c800-0000-7000-8000-000000000101', '2026-01-01T00:00:00Z'),
 ('0199c800-0000-7000-8000-000000000310', '0199c800-0000-7000-8000-000000000102', '2026-01-01T00:00:00Z');
INSERT INTO venue.hall_time_slots(id, grid_id, starts_at, ends_at, capacity)
VALUES ('0199c800-0000-7000-8000-000000000311', '0199c800-0000-7000-8000-000000000310', '2026-11-01T17:00:00Z', '2026-11-01T18:00:00Z', 1);
INSERT INTO venue.hall_time_allocations(id, slot_id, person_id, status, queued_at, assigned_at)
VALUES
 ('0199c800-0000-7000-8000-000000000312', '0199c800-0000-7000-8000-000000000311', '0199c800-0000-7000-8000-000000000101', 'confirmed', '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z'),
 ('0199c800-0000-7000-8000-000000000313', '0199c800-0000-7000-8000-000000000311', '0199c800-0000-7000-8000-000000000102', 'waiting', '2026-10-01T10:01:00Z', NULL);

INSERT INTO messaging.events(
  id, tenant_id, contract_id, event_type, template_key, template_version, source_operation_id,
  competition_id, match_id, source_type, source_contract_id, actor_person_id, actor_contract_id_snapshot,
  actor_name_snapshot, summary_snapshot, detail_snapshot, result_snapshot, created_at
)
VALUES (
  '0199c800-0000-7000-8000-000000000401', '0199c800-0000-7000-8000-000000000001', 'event-seed',
  'match_result', 'match.result', 1, '0199c800-0000-7000-8000-000000000402',
  '0199c800-0000-7000-8000-000000000205', '0199c800-0000-7000-8000-000000000220',
  'match', 'm-seed', '0199c800-0000-7000-8000-000000000101', '1', 'Ada Admin',
  'Ada Admin hat ein Ergebnis eingetragen.', '', '6-3/6-4', '2026-03-02T11:15:00Z'
);
INSERT INTO messaging.event_participants(event_id, person_id, participant_role, contract_id_snapshot, first_name_snapshot, last_name_snapshot)
VALUES ('0199c800-0000-7000-8000-000000000401', '0199c800-0000-7000-8000-000000000101', 'winner', '1', 'Ada', 'Admin');
INSERT INTO messaging.event_recipients(id, event_id, person_id, template_key, template_version, created_at)
VALUES ('0199c800-0000-7000-8000-000000000403', '0199c800-0000-7000-8000-000000000401', '0199c800-0000-7000-8000-000000000102', 'match.result', 1, '2026-03-02T11:15:00Z');
INSERT INTO messaging.receipts(recipient_id, read_at, revision)
VALUES ('0199c800-0000-7000-8000-000000000403', NULL, 1);

INSERT INTO ops.jobs(id, tenant_id, job_type, payload_version, payload, idempotency_key, status, available_at)
VALUES ('0199c800-0000-7000-8000-000000000501', '0199c800-0000-7000-8000-000000000001', 'retention.synthetic', 1, '{}', 'job-seed', 'pending', '2026-10-10T00:00:00Z');
INSERT INTO ops.outbox(id, tenant_id, event_type, payload_version, payload, idempotency_key, status, available_at)
VALUES ('0199c800-0000-7000-8000-000000000502', '0199c800-0000-7000-8000-000000000001', 'websocket.invalidate', 1, '{"projection":"play","revision":1}', 'outbox-seed', 'pending', '2026-10-10T00:00:00Z');

-- Erweiterter synthetischer Referenzbestand fuer alle Persistenzdomaenen.
INSERT INTO core.configuration_entries(tenant_id, configuration_key, value, revision, updated_at)
VALUES ('0199c800-0000-7000-8000-000000000001', 'synthetic.profile', '{"name":"full-devel","version":1}', 1, '2026-10-10T00:00:00Z');
INSERT INTO identity.person_addresses(id, person_id, country_label, postal_code, city, address_line)
VALUES ('0199c800-0000-7000-8000-000000000130', '0199c800-0000-7000-8000-000000000101', 'AT', '4062', 'Piberbach', 'Testweg 1');
INSERT INTO identity.person_external_identifiers(id, tenant_id, person_id, provider, external_value)
VALUES ('0199c800-0000-7000-8000-000000000131', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000101', 'clubdesk', '1001');
INSERT INTO identity.password_authorizations(id, account_id, issued_by_person_id, issued_at, expires_at)
VALUES ('0199c800-0000-7000-8000-000000000132', '0199c800-0000-7000-8000-000000000125', '0199c800-0000-7000-8000-000000000101', '2026-10-10T00:00:00Z', '2026-10-11T00:00:00Z');
INSERT INTO identity.sessions(id, account_id, token_hash, auth_revision, login_snapshot, issued_at, last_seen_at, expires_at)
VALUES
 ('0199c800-0000-7000-8000-000000000133', '0199c800-0000-7000-8000-000000000121', decode(repeat('11',32),'hex'), 1, 'admin', '2026-10-10T00:00:00Z', '2026-10-10T00:05:00Z', '2026-11-09T00:00:00Z'),
 ('0199c800-0000-7000-8000-000000000134', '0199c800-0000-7000-8000-000000000124', decode(repeat('12',32),'hex'), 1, 'inactive', '2026-09-01T00:00:00Z', '2026-09-01T00:05:00Z', '2026-09-02T00:00:00Z');
INSERT INTO identity.login_rate_limits(key_hash, key_type, window_started_at, attempt_count, blocked_until, expires_at)
VALUES
 (decode(repeat('13',32),'hex'), 'ip', '2026-10-10T00:00:00Z', 20, '2026-10-10T00:15:00Z', '2026-10-10T00:30:00Z'),
 (decode(repeat('14',32),'hex'), 'ip_login', '2026-10-10T00:00:00Z', 5, '2026-10-10T00:15:00Z', '2026-10-10T00:30:00Z');
INSERT INTO identity.frontend_logging_settings(tenant_id, minimum_level, info_sample_rate, debug_sample_rate, targets_revision)
VALUES ('0199c800-0000-7000-8000-000000000001', 'warn', 0.1000, 0.1000, 1);
INSERT INTO identity.frontend_logging_targets(tenant_id, person_id, minimum_level, expires_at, created_by_person_id)
VALUES ('0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000103', 'debug', '2026-10-10T01:00:00Z', '0199c800-0000-7000-8000-000000000101');

INSERT INTO play.competition_types(id, tenant_id, contract_id, name)
VALUES
 ('0199c800-0000-7000-8000-000000000230', '0199c800-0000-7000-8000-000000000001', 'ko', 'KO-Bewerb'),
 ('0199c800-0000-7000-8000-000000000231', '0199c800-0000-7000-8000-000000000001', 'rr', 'Gruppenbewerb');
INSERT INTO play.competition_type_versions(id, competition_type_id, version_no, entry_list_available, bracket_size, round_robin, specific_code)
VALUES
 ('0199c800-0000-7000-8000-000000000232', '0199c800-0000-7000-8000-000000000230', 1, true, 4, false, 'knockout'),
 ('0199c800-0000-7000-8000-000000000233', '0199c800-0000-7000-8000-000000000231', 1, true, NULL, true, 'group');
INSERT INTO play.competitions(id, section_id, contract_id, competition_type_version_id, default_match_format_version_id, name, minimum_age, maximum_age, sort_order)
VALUES
 ('0199c800-0000-7000-8000-000000000234', '0199c800-0000-7000-8000-000000000002', 'ko-1', '0199c800-0000-7000-8000-000000000232', '0199c800-0000-7000-8000-000000000204', 'Synthetischer KO-Bewerb', 18, NULL, 2),
 ('0199c800-0000-7000-8000-000000000235', '0199c800-0000-7000-8000-000000000002', 'rr-1', '0199c800-0000-7000-8000-000000000233', '0199c800-0000-7000-8000-000000000204', 'Synthetische Gruppe', NULL, 65, 3);
INSERT INTO play.competition_gender_eligibility(competition_id, gender_code)
VALUES ('0199c800-0000-7000-8000-000000000234', 1), ('0199c800-0000-7000-8000-000000000235', 2);
INSERT INTO play.competition_entries(id, competition_id, person_id, contract_id, entered_at, status, withdrawn_at, legacy_fee_status)
VALUES
 ('0199c800-0000-7000-8000-000000000236', '0199c800-0000-7000-8000-000000000234', '0199c800-0000-7000-8000-000000000103', 'entry-withdrawn', '2026-01-01T10:00:00Z', 'withdrawn', '2026-02-01T10:00:00Z', 'bezahlt'),
 ('0199c800-0000-7000-8000-000000000237', '0199c800-0000-7000-8000-000000000234', '0199c800-0000-7000-8000-000000000103', 'entry-returned', '2026-03-01T10:00:00Z', 'active', NULL, 'offen');

INSERT INTO play.matches(id, competition_id, contract_id, match_format_version_id, format_binding_source, round_code, scheduled_at)
VALUES
 ('0199c800-0000-7000-8000-000000000240', '0199c800-0000-7000-8000-000000000234', 'ko-bye', '0199c800-0000-7000-8000-000000000204', 'competition_default', 'HF-1', NULL),
 ('0199c800-0000-7000-8000-000000000241', '0199c800-0000-7000-8000-000000000234', 'ko-open', '0199c800-0000-7000-8000-000000000204', 'competition_default', 'F', NULL),
 ('0199c800-0000-7000-8000-000000000242', '0199c800-0000-7000-8000-000000000235', 'rr-walkover', '0199c800-0000-7000-8000-000000000204', 'competition_default', 'G1', NULL),
 ('0199c800-0000-7000-8000-000000000243', '0199c800-0000-7000-8000-000000000235', 'rr-retirement', '0199c800-0000-7000-8000-000000000204', 'competition_default', 'G2', '2026-04-01T10:00:00Z');
INSERT INTO play.match_sides(id, match_id, side_no)
VALUES
 ('0199c800-0000-7000-8000-000000000250', '0199c800-0000-7000-8000-000000000240', 1), ('0199c800-0000-7000-8000-000000000251', '0199c800-0000-7000-8000-000000000240', 2),
 ('0199c800-0000-7000-8000-000000000252', '0199c800-0000-7000-8000-000000000241', 1), ('0199c800-0000-7000-8000-000000000253', '0199c800-0000-7000-8000-000000000241', 2),
 ('0199c800-0000-7000-8000-000000000254', '0199c800-0000-7000-8000-000000000242', 1), ('0199c800-0000-7000-8000-000000000255', '0199c800-0000-7000-8000-000000000242', 2),
 ('0199c800-0000-7000-8000-000000000256', '0199c800-0000-7000-8000-000000000243', 1), ('0199c800-0000-7000-8000-000000000257', '0199c800-0000-7000-8000-000000000243', 2);
INSERT INTO play.match_participants(id, match_id, side_id, position_no, participant_type, person_id)
VALUES
 ('0199c800-0000-7000-8000-000000000270', '0199c800-0000-7000-8000-000000000240', '0199c800-0000-7000-8000-000000000250', 1, 'person', '0199c800-0000-7000-8000-000000000101'),
 ('0199c800-0000-7000-8000-000000000271', '0199c800-0000-7000-8000-000000000240', '0199c800-0000-7000-8000-000000000251', 1, 'bye', NULL),
 ('0199c800-0000-7000-8000-000000000272', '0199c800-0000-7000-8000-000000000241', '0199c800-0000-7000-8000-000000000252', 1, 'open_bracket', NULL),
 ('0199c800-0000-7000-8000-000000000273', '0199c800-0000-7000-8000-000000000241', '0199c800-0000-7000-8000-000000000253', 1, 'person', '0199c800-0000-7000-8000-000000000102'),
 ('0199c800-0000-7000-8000-000000000274', '0199c800-0000-7000-8000-000000000242', '0199c800-0000-7000-8000-000000000254', 1, 'person', '0199c800-0000-7000-8000-000000000101'),
 ('0199c800-0000-7000-8000-000000000275', '0199c800-0000-7000-8000-000000000242', '0199c800-0000-7000-8000-000000000255', 1, 'person', '0199c800-0000-7000-8000-000000000102'),
 ('0199c800-0000-7000-8000-000000000276', '0199c800-0000-7000-8000-000000000243', '0199c800-0000-7000-8000-000000000256', 1, 'person', '0199c800-0000-7000-8000-000000000102'),
 ('0199c800-0000-7000-8000-000000000277', '0199c800-0000-7000-8000-000000000243', '0199c800-0000-7000-8000-000000000257', 1, 'person', '0199c800-0000-7000-8000-000000000103');
INSERT INTO play.match_results(id, match_id, version_no, completion_type, winner_side_no, first_captured_at, walkover_at, provenance)
VALUES ('0199c800-0000-7000-8000-000000000260', '0199c800-0000-7000-8000-000000000242', 1, 'walkover', 1, '2026-04-01T09:00:00Z', '2026-04-01T09:00:00Z', 'legacy_snapshot');
INSERT INTO play.match_results(id, match_id, version_no, completion_type, winner_side_no, play_started_at, play_ended_at, first_captured_at, provenance)
VALUES ('0199c800-0000-7000-8000-000000000261', '0199c800-0000-7000-8000-000000000243', 1, 'retirement', 2, '2026-04-01T10:00:00Z', '2026-04-01T10:45:00Z', '2026-04-01T10:50:00Z', 'legacy_snapshot');
INSERT INTO play.match_result_sets(result_id, set_no, side_one_games, side_two_games, incomplete)
VALUES ('0199c800-0000-7000-8000-000000000261', 1, 3, 6, false), ('0199c800-0000-7000-8000-000000000261', 2, 1, 2, true);
UPDATE play.matches SET current_result_id='0199c800-0000-7000-8000-000000000260', revision=2 WHERE id='0199c800-0000-7000-8000-000000000242';
UPDATE play.matches SET current_result_id='0199c800-0000-7000-8000-000000000261', revision=2 WHERE id='0199c800-0000-7000-8000-000000000243';
INSERT INTO play.match_result_history(id, match_id, operation_id, change_type, after_result_id, changed_at)
VALUES
 ('0199c800-0000-7000-8000-000000000262', '0199c800-0000-7000-8000-000000000220', '0199c800-0000-7000-8000-000000000263', 'created', '0199c800-0000-7000-8000-000000000223', '2026-03-02T11:15:00Z'),
 ('0199c800-0000-7000-8000-000000000264', '0199c800-0000-7000-8000-000000000242', '0199c800-0000-7000-8000-000000000265', 'legacy_snapshot', '0199c800-0000-7000-8000-000000000260', '2026-04-01T09:00:00Z'),
 ('0199c800-0000-7000-8000-000000000266', '0199c800-0000-7000-8000-000000000243', '0199c800-0000-7000-8000-000000000267', 'legacy_snapshot', '0199c800-0000-7000-8000-000000000261', '2026-04-01T10:50:00Z');
INSERT INTO play.match_progressions(id, competition_id, source_match_id, source_outcome, target_match_id, target_side_no)
VALUES ('0199c800-0000-7000-8000-000000000268', '0199c800-0000-7000-8000-000000000234', '0199c800-0000-7000-8000-000000000240', 'winner', '0199c800-0000-7000-8000-000000000241', 1);
INSERT INTO play.ranking_changes(id, competition_id, match_result_history_id, created_at)
VALUES ('0199c800-0000-7000-8000-000000000269', '0199c800-0000-7000-8000-000000000205', '0199c800-0000-7000-8000-000000000262', '2026-03-02T11:15:00Z');
INSERT INTO play.ranking_change_items(ranking_change_id, person_id, before_rank, after_rank)
VALUES
 ('0199c800-0000-7000-8000-000000000269', '0199c800-0000-7000-8000-000000000101', 2, 1),
 ('0199c800-0000-7000-8000-000000000269', '0199c800-0000-7000-8000-000000000102', 1, 2);
INSERT INTO play.match_ranking_effects(match_result_history_id, ranking_change_id, challenger_rank_snapshot, challenged_rank_snapshot)
VALUES ('0199c800-0000-7000-8000-000000000262', '0199c800-0000-7000-8000-000000000269', 2, 1);

INSERT INTO venue.court_assignments(id, court_id, match_id, competition_id, match_format_version_id, competition_name_snapshot, assigned_at)
VALUES ('0199c800-0000-7000-8000-000000000320', '0199c800-0000-7000-8000-000000000302', '0199c800-0000-7000-8000-000000000220', '0199c800-0000-7000-8000-000000000205', '0199c800-0000-7000-8000-000000000204', 'Rangliste Herren', '2026-03-02T09:55:00Z');
INSERT INTO venue.court_assignment_participants(assignment_id,side_no,position_no,person_id,first_name_snapshot,last_name_snapshot)
VALUES
 ('0199c800-0000-7000-8000-000000000320',1,1,'0199c800-0000-7000-8000-000000000101','Ada','Admin'),
 ('0199c800-0000-7000-8000-000000000320',2,1,'0199c800-0000-7000-8000-000000000102','Olivia','Operator');
UPDATE venue.courts SET active=true, epoch=1, revision=2 WHERE id='0199c800-0000-7000-8000-000000000302';
UPDATE venue.court_live_state SET assignment_id='0199c800-0000-7000-8000-000000000320', active=true, source_state='ready', epoch=1, revision=2, updated_at='2026-03-02T10:05:00Z' WHERE court_id='0199c800-0000-7000-8000-000000000302';
INSERT INTO venue.score_events(id, event_id, court_id, assignment_id, source_id, court_sequence, source_occurred_at, accepted_at, side_one_set_one, side_two_set_one, side_one_set_two, side_two_set_two, side_one_set_three, side_two_set_three, side_one_points, side_two_points, court_revision, source_instance, source_sequence)
VALUES ('0199c800-0000-7000-8000-000000000321', '0199c800-0000-7000-8000-000000000322', '0199c800-0000-7000-8000-000000000302', '0199c800-0000-7000-8000-000000000320', '0199c800-0000-7000-8000-000000000303', 1, '2026-03-02T10:05:00Z', '2026-03-02T10:05:01Z', '1', '0', '0', '0', '0', '0', '15', '0', 2, 'synthetic', 1);
INSERT INTO venue.court_state_events(id, court_id, assignment_id, actor_person_id, event_type, resulting_revision, occurred_at)
VALUES ('0199c800-0000-7000-8000-000000000323', '0199c800-0000-7000-8000-000000000302', '0199c800-0000-7000-8000-000000000320', '0199c800-0000-7000-8000-000000000101', 'assignment_started', 2, '2026-03-02T09:55:00Z');
INSERT INTO venue.monitor_commands(id, monitor_id, command_id, command_type, target_revision, target_path, status, created_at, updated_at, acknowledged_at, expires_at)
VALUES ('0199c800-0000-7000-8000-000000000324', '0199c800-0000-7000-8000-000000000304', '0199c800-0000-7000-8000-000000000325', 'navigate', 1, '/scoreboard.html', 'loaded', '2026-10-10T00:00:00Z', '2026-10-10T00:00:01Z', '2026-10-10T00:00:01Z', '2026-10-10T00:05:00Z');
INSERT INTO venue.navigation_presets(id, tenant_id, contract_id, profile_code, label, target_type, page_key, enabled, sort_order)
VALUES ('0199c800-0000-7000-8000-000000000326', '0199c800-0000-7000-8000-000000000001', 'nav-seed', '1', 'Scoreboard', 'page', 'scoreboard', true, 1);
INSERT INTO venue.hall_time_constraints(id, grid_id, person_id, slot_id, constraint_type, created_at)
VALUES
 ('0199c800-0000-7000-8000-000000000330', '0199c800-0000-7000-8000-000000000310', '0199c800-0000-7000-8000-000000000101', '0199c800-0000-7000-8000-000000000311', 'unavailable', '2026-10-01T09:00:00Z'),
 ('0199c800-0000-7000-8000-000000000331', '0199c800-0000-7000-8000-000000000310', '0199c800-0000-7000-8000-000000000102', '0199c800-0000-7000-8000-000000000311', 'avoid', '2026-10-01T09:01:00Z');
INSERT INTO venue.hall_time_history(id, grid_id, operation_id, action_code, actor_person_id, occurred_at, item_count)
VALUES ('0199c800-0000-7000-8000-000000000332', '0199c800-0000-7000-8000-000000000310', '0199c800-0000-7000-8000-000000000333', 'distribution_replaced', '0199c800-0000-7000-8000-000000000101', '2026-10-01T10:00:00Z', 1);
INSERT INTO venue.hall_time_history_items(history_id, item_no, slot_id, person_id, before_status, after_status, slot_starts_at_snapshot, person_contract_id_snapshot, person_name_snapshot)
VALUES ('0199c800-0000-7000-8000-000000000332', 1, '0199c800-0000-7000-8000-000000000311', '0199c800-0000-7000-8000-000000000101', 'waiting', 'confirmed', '2026-11-01T17:00:00Z', '1', 'Ada Admin');

INSERT INTO identity.user_favorites(account_id, position, target_type, page_key, competition_id, hall_time_grid_id, revision)
VALUES
 ('0199c800-0000-7000-8000-000000000121', 1, 'page', 'scoreboard', NULL, NULL, 1),
 ('0199c800-0000-7000-8000-000000000121', 2, 'ranking', NULL, '0199c800-0000-7000-8000-000000000205', NULL, 1),
 ('0199c800-0000-7000-8000-000000000121', 3, 'hall_time_grid', NULL, NULL, '0199c800-0000-7000-8000-000000000310', 1);
INSERT INTO identity.user_start_pages(account_id, target_type, competition_id, revision)
VALUES ('0199c800-0000-7000-8000-000000000121', 'ranking', '0199c800-0000-7000-8000-000000000205', 1);
INSERT INTO identity.user_preference_states(account_id, favorites_revision, favorites_updated_at, start_page_revision, start_page_updated_at)
VALUES ('0199c800-0000-7000-8000-000000000121', 1, '2026-10-01T10:00:00Z', 1, '2026-10-01T10:00:00Z');

INSERT INTO messaging.receipts(recipient_id, read_at, acknowledged_at, revision)
VALUES ('0199c800-0000-7000-8000-000000000403', '2026-03-02T11:20:00Z', '2026-03-02T11:21:00Z', 2)
ON CONFLICT (recipient_id) DO UPDATE SET read_at=excluded.read_at, acknowledged_at=excluded.acknowledged_at, revision=excluded.revision;
INSERT INTO messaging.history_revision(singleton, revision)
VALUES (true, 1);
INSERT INTO messaging.deliveries(id, recipient_id, channel, status, idempotency_key, attempt_count, updated_at)
VALUES
 ('0199c800-0000-7000-8000-000000000410', '0199c800-0000-7000-8000-000000000403', 'email', 'sent', 'delivery-email-seed', 1, '2026-03-02T11:16:00Z'),
 ('0199c800-0000-7000-8000-000000000411', '0199c800-0000-7000-8000-000000000403', 'whatsapp', 'not_configured', 'delivery-whatsapp-seed', 0, '2026-03-02T11:16:00Z');
INSERT INTO messaging.comments(id, event_id, author_person_id, author_contract_id_snapshot, author_first_name_snapshot, author_last_name_snapshot, body, created_at)
VALUES ('0199c800-0000-7000-8000-000000000412', '0199c800-0000-7000-8000-000000000401', '0199c800-0000-7000-8000-000000000101', '1', 'Ada', 'Admin', 'Synthetischer Kommentar', '2026-03-02T11:30:00Z');
INSERT INTO messaging.comments(id, event_id, author_person_id, body, created_at, deleted_at, deletion_status)
VALUES ('0199c800-0000-7000-8000-000000000413', '0199c800-0000-7000-8000-000000000401', NULL, NULL, '2026-03-02T11:31:00Z', '2026-03-02T11:32:00Z', 'deleted_by_author');
INSERT INTO messaging.reactions(id, event_id, comment_id, person_id, reaction_key, created_at)
VALUES
 ('0199c800-0000-7000-8000-000000000414', '0199c800-0000-7000-8000-000000000401', NULL, '0199c800-0000-7000-8000-000000000101', 'ok', '2026-03-02T11:33:00Z'),
 ('0199c800-0000-7000-8000-000000000415', NULL, '0199c800-0000-7000-8000-000000000412', '0199c800-0000-7000-8000-000000000102', '+1', '2026-03-02T11:34:00Z');
INSERT INTO messaging.user_revisions(person_id, revision)
VALUES ('0199c800-0000-7000-8000-000000000101', 3), ('0199c800-0000-7000-8000-000000000102', 2);
INSERT INTO messaging.notification_preferences(person_id, channel, enabled)
VALUES
 ('0199c800-0000-7000-8000-000000000101', 'email', true), ('0199c800-0000-7000-8000-000000000101', 'whatsapp', false),
 ('0199c800-0000-7000-8000-000000000102', 'email', false), ('0199c800-0000-7000-8000-000000000102', 'whatsapp', false);

INSERT INTO ops.idempotency_operations(id, tenant_id, operation_id, actor_person_id, command, request_hash, status, response_projection, response_expires_at, started_at, completed_at, expires_at)
VALUES
 ('0199c800-0000-7000-8000-000000000510', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000511', '0199c800-0000-7000-8000-000000000101', 'matchResultSet', decode(repeat('21',32),'hex'), 'success', '{"matchId":"m-seed","revision":2}', '2026-10-11T00:00:00Z', '2026-10-10T00:00:00Z', '2026-10-10T00:00:01Z', '2026-10-11T00:00:00Z'),
 ('0199c800-0000-7000-8000-000000000512', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000513', '0199c800-0000-7000-8000-000000000101', 'courtAssign', decode(repeat('22',32),'hex'), 'unknown', NULL, NULL, '2026-10-10T00:01:00Z', '2026-10-10T00:01:01Z', '2026-10-11T00:01:00Z');
INSERT INTO ops.jobs(id, tenant_id, job_type, payload_version, payload, idempotency_key, status, attempt_count, available_at, lease_owner, lease_until)
VALUES ('0199c800-0000-7000-8000-000000000514', '0199c800-0000-7000-8000-000000000001', 'retention.synthetic', 1, '{}', 'job-leased-seed', 'leased', 1, '2026-10-10T00:00:00Z', 'worker-seed', '2026-10-10T00:05:00Z');
INSERT INTO ops.jobs(id, tenant_id, job_type, payload_version, payload, idempotency_key, status, attempt_count, available_at, last_error_code)
VALUES ('0199c800-0000-7000-8000-000000000515', '0199c800-0000-7000-8000-000000000001', 'outbox.reconcile', 1, '{}', 'job-retry-seed', 'retrying', 2, '2026-10-10T00:10:00Z', 'SYNTHETIC_RETRY');
INSERT INTO ops.outbox(id, tenant_id, event_type, payload_version, payload, idempotency_key, status, attempt_count, available_at, last_error_code)
VALUES ('0199c800-0000-7000-8000-000000000516', '0199c800-0000-7000-8000-000000000001', 'messaging.deliver', 1, '{"recipientId":"0199c800-0000-7000-8000-000000000403"}', 'outbox-unknown-seed', 'unknown', 1, '2026-10-10T00:00:00Z', 'DELIVERY_UNKNOWN');
INSERT INTO ops.audit_operations(id, tenant_id, operation_id, actor_person_id, actor_type, actor_name_snapshot, role_snapshot, action, subject_type, subject_id, status, source_instance, before_projection, after_projection, started_at, completed_at, expires_at)
VALUES
 ('0199c800-0000-7000-8000-000000000520', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000521', '0199c800-0000-7000-8000-000000000101', 'user', 'Ada Admin', 'admin', 'match.result', 'match', 'm-seed', 'success', 'synthetic', '{"revision":1}', '{"revision":2}', '2026-03-02T11:14:00Z', '2026-03-02T11:15:00Z', '2027-03-02T11:15:00Z'),
 ('0199c800-0000-7000-8000-000000000522', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000523', NULL, 'system', 'Worker', 'system', 'job.recovery', 'job', 'job-leased-seed', 'unknown', 'synthetic', NULL, NULL, '2026-10-10T00:05:00Z', '2026-10-10T00:05:01Z', '2027-10-10T00:05:00Z');
INSERT INTO ops.audit_security_context(audit_operation_id, source_ip, attempted_login)
VALUES ('0199c800-0000-7000-8000-000000000520', '127.0.0.1', 'admin');
INSERT INTO ops.audit_transitions(id, audit_operation_id, transition, occurred_at, duration_ms)
VALUES
 ('0199c800-0000-7000-8000-000000000524', '0199c800-0000-7000-8000-000000000520', 'started', '2026-03-02T11:14:00Z', NULL),
 ('0199c800-0000-7000-8000-000000000525', '0199c800-0000-7000-8000-000000000520', 'success', '2026-03-02T11:15:00Z', 60000),
 ('0199c800-0000-7000-8000-000000000526', '0199c800-0000-7000-8000-000000000522', 'unknown', '2026-10-10T00:05:01Z', 1000);

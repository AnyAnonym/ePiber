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

INSERT INTO identity.person_contacts(person_id, contact_type, contact_value)
VALUES
 ('0199c800-0000-7000-8000-000000000101', 'email', 'shared@example.test'),
 ('0199c800-0000-7000-8000-000000000102', 'email', 'shared@example.test'),
 ('0199c800-0000-7000-8000-000000000103', 'mobile', '0043 660 1234567');

INSERT INTO identity.user_accounts(id, tenant_id, person_id, login, active)
VALUES
 ('0199c800-0000-7000-8000-000000000121', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000101', 'admin', true),
 ('0199c800-0000-7000-8000-000000000122', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000102', 'operator', true),
 ('0199c800-0000-7000-8000-000000000123', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000103', 'player', true),
 ('0199c800-0000-7000-8000-000000000124', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000104', 'inactive', false),
 ('0199c800-0000-7000-8000-000000000125', '0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000105', NULL, true);

INSERT INTO identity.credentials(account_id, credential_type, credential_schema, secret_hash)
VALUES
 ('0199c800-0000-7000-8000-000000000121', 'password', 'scrypt_v1', 'scrypt$v1$16384$8$1$synthetic$admin'),
 ('0199c800-0000-7000-8000-000000000122', 'password', 'scrypt_v1', 'scrypt$v1$16384$8$1$synthetic$operator'),
 ('0199c800-0000-7000-8000-000000000123', 'password', 'legacy_sha256', repeat('a', 64)),
 ('0199c800-0000-7000-8000-000000000125', 'password', 'scrypt_v1', 'scrypt$v1$16384$8$1$synthetic$dormant');

INSERT INTO identity.tenant_role_assignments(tenant_id, person_id, role_code, granted_at)
VALUES
 ('0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000101', 'admin', '2026-01-01T00:00:00Z'),
 ('0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000101', 'operator', '2026-01-01T00:00:00Z'),
 ('0199c800-0000-7000-8000-000000000001', '0199c800-0000-7000-8000-000000000102', 'operator', '2026-01-01T00:00:00Z');

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
INSERT INTO play.competition_entries(competition_id, person_id, contract_id, entered_at, status)
VALUES
 ('0199c800-0000-7000-8000-000000000205', '0199c800-0000-7000-8000-000000000101', 'e-1', '2026-01-01T10:00:00Z', 'active'),
 ('0199c800-0000-7000-8000-000000000205', '0199c800-0000-7000-8000-000000000102', 'e-2', '2026-01-01T10:01:00Z', 'active');
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
INSERT INTO play.match_participants(match_id, side_id, position_no, participant_type, person_id)
VALUES
 ('0199c800-0000-7000-8000-000000000220', '0199c800-0000-7000-8000-000000000221', 1, 'person', '0199c800-0000-7000-8000-000000000101'),
 ('0199c800-0000-7000-8000-000000000220', '0199c800-0000-7000-8000-000000000222', 1, 'person', '0199c800-0000-7000-8000-000000000102');
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

INSERT INTO venue.hall_time_grids(id, section_id, contract_id, name, mode, capacity, waiting_list_enabled, waiting_limit_per_person, fair_use_enabled, fair_use_open_days)
VALUES ('0199c800-0000-7000-8000-000000000310', '0199c800-0000-7000-8000-000000000002', 'hall-seed', 'Synthetische Hallenzeit', 'reservation', 1, true, 2, true, 7);
INSERT INTO venue.hall_time_grid_participants(grid_id, person_id, joined_at)
VALUES
 ('0199c800-0000-7000-8000-000000000310', '0199c800-0000-7000-8000-000000000101', '2026-01-01T00:00:00Z'),
 ('0199c800-0000-7000-8000-000000000310', '0199c800-0000-7000-8000-000000000102', '2026-01-01T00:00:00Z');
INSERT INTO venue.hall_time_slots(id, grid_id, starts_at, ends_at, capacity)
VALUES ('0199c800-0000-7000-8000-000000000311', '0199c800-0000-7000-8000-000000000310', '2026-11-01T17:00:00Z', '2026-11-01T18:00:00Z', 1);
INSERT INTO venue.hall_time_allocations(slot_id, person_id, status, queued_at, assigned_at)
VALUES
 ('0199c800-0000-7000-8000-000000000311', '0199c800-0000-7000-8000-000000000101', 'confirmed', '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z'),
 ('0199c800-0000-7000-8000-000000000311', '0199c800-0000-7000-8000-000000000102', 'waiting', '2026-10-01T10:01:00Z', NULL);

INSERT INTO messaging.events(id, tenant_id, contract_id, event_type, template_key, template_version, source_operation_id, competition_id, match_id, created_at)
VALUES ('0199c800-0000-7000-8000-000000000401', '0199c800-0000-7000-8000-000000000001', 'event-seed', 'match_result', 'match.result', 1, '0199c800-0000-7000-8000-000000000402', '0199c800-0000-7000-8000-000000000205', '0199c800-0000-7000-8000-000000000220', '2026-03-02T11:15:00Z');
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

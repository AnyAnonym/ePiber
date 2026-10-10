INSERT INTO core.tenants (id, tenant_code, display_name, time_zone, locale)
VALUES ('0199c800-0000-7000-8000-000000000001', 'devel-epiber', 'ePiber Development', 'Europe/Vienna', 'de-AT');

INSERT INTO core.sections (id, tenant_id, section_code, display_name)
VALUES (
  '0199c800-0000-7000-8000-000000000002',
  '0199c800-0000-7000-8000-000000000001',
  'tennis',
  'Tennis'
);

INSERT INTO core.projection_revisions (tenant_id, projection_key, revision)
VALUES
  ('0199c800-0000-7000-8000-000000000001', 'catalog', 0),
  ('0199c800-0000-7000-8000-000000000001', 'identity', 0),
  ('0199c800-0000-7000-8000-000000000001', 'play', 0),
  ('0199c800-0000-7000-8000-000000000001', 'venue', 0),
  ('0199c800-0000-7000-8000-000000000001', 'messaging', 0);

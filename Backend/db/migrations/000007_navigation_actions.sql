-- Preserve Navigator control actions independently of navigable pages.
ALTER TABLE venue.navigation_presets DROP CONSTRAINT navigation_presets_target_type_check;
ALTER TABLE venue.navigation_presets ADD CONSTRAINT navigation_presets_target_type_check
  CHECK (target_type IN ('page', 'competition', 'ranking', 'entry_list', 'competition_history', 'hall_time_grid', 'court_assignment', 'court_activation'));
ALTER TABLE venue.navigation_presets ADD CONSTRAINT navigation_presets_court_action_check
  CHECK (target_type NOT IN ('court_assignment', 'court_activation') OR (
    competition_id IS NULL AND hall_time_grid_id IS NULL AND
    ((target_type = 'court_assignment' AND page_key IS NOT NULL AND page_key IN ('1', '2')) OR
     (target_type = 'court_activation' AND page_key IS NULL))
  ));

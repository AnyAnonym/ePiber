-- Entry challenges and their versioned results retain the original target rank.
-- No historical ranks are guessed during migration.
ALTER TABLE play.matches ADD COLUMN entry_target_rank integer CHECK (entry_target_rank > 0);
ALTER TABLE play.match_results
  ADD COLUMN entry_minimum_rank integer CHECK (entry_minimum_rank > 10),
  ADD COLUMN entry_expires_at timestamptz,
  ADD CONSTRAINT match_results_entry_restriction_check CHECK (
    (entry_minimum_rank IS NULL) = (entry_expires_at IS NULL)
  );

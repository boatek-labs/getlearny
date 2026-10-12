-- Scores are recorded against each test's own maximum, not an assumed 100-point scale.
-- This allows valid results such as 45/50 or 160/200.
ALTER TABLE test_logs
  DROP CONSTRAINT IF EXISTS test_logs_score_check;

ALTER TABLE test_logs
  DROP CONSTRAINT IF EXISTS test_logs_score_range_check;

ALTER TABLE test_logs
  ADD CONSTRAINT test_logs_score_range_check
  CHECK (score >= 0 AND score <= max_score);

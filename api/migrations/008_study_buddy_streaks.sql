-- Study Buddy and daily study activity foundation
-- Activity is derived from persisted learning logs and completed test records.
CREATE INDEX IF NOT EXISTS learning_logs_user_created_at_idx ON learning_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS test_logs_user_created_at_idx ON test_logs(user_id, created_at DESC);

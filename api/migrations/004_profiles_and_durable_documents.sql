ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data TEXT;
ALTER TABLE uploaded_documents ADD COLUMN IF NOT EXISTS content BYTEA;
CREATE INDEX IF NOT EXISTS uploaded_documents_user_date_idx ON uploaded_documents(user_id, created_at DESC);

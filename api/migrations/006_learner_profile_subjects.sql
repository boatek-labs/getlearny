ALTER TABLE users ADD COLUMN IF NOT EXISTS class_level VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subjects TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE uploaded_documents ADD COLUMN IF NOT EXISTS subject_name VARCHAR(120) NOT NULL DEFAULT 'General';
CREATE INDEX IF NOT EXISTS uploaded_documents_user_subject_idx ON uploaded_documents(user_id, subject_name);

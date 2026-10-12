CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(120) NOT NULL,
 email VARCHAR(254) NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subjects (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(100) NOT NULL UNIQUE,
 code VARCHAR(30) NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS topics (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
 title VARCHAR(200) NOT NULL, description TEXT NOT NULL DEFAULT '', level VARCHAR(30) NOT NULL DEFAULT 'SHS 3',
 prerequisites TEXT[] NOT NULL DEFAULT '{}', sort_order INTEGER NOT NULL DEFAULT 0,
 UNIQUE(subject_id,title)
);
CREATE TABLE IF NOT EXISTS learning_logs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 subject VARCHAR(100) NOT NULL, topic VARCHAR(200) NOT NULL, minutes_spent INTEGER NOT NULL DEFAULT 0 CHECK(minutes_spent BETWEEN 0 AND 1440),
 status VARCHAR(20) NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed','review')), notes TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS test_logs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 subject VARCHAR(100) NOT NULL, title VARCHAR(200) NOT NULL, score NUMERIC(5,2) NOT NULL CHECK(score BETWEEN 0 AND 100),
 max_score NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK(max_score>0), taken_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS journal_entries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 learned TEXT NOT NULL, difficult TEXT NOT NULL DEFAULT '', next_step TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS quiz_attempts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 subject VARCHAR(100) NOT NULL, topic VARCHAR(200) NOT NULL, score INTEGER NOT NULL CHECK(score>=0), total INTEGER NOT NULL CHECK(total>0),
 answers JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS uploaded_documents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 original_name VARCHAR(255) NOT NULL, storage_path TEXT NOT NULL, mime_type VARCHAR(100) NOT NULL,
 size_bytes BIGINT NOT NULL, extracted_text TEXT NOT NULL DEFAULT '', processing_status VARCHAR(20) NOT NULL DEFAULT 'queued',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learning_logs_user_date_idx ON learning_logs(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS test_logs_user_date_idx ON test_logs(user_id,taken_at DESC);
CREATE INDEX IF NOT EXISTS journal_entries_user_date_idx ON journal_entries(user_id,created_at DESC);
INSERT INTO subjects(name,code,description) VALUES
 ('Mathematics','MATH','Core mathematics foundations for WASSCE'),
 ('English Language','ENG','Comprehension, summary, grammar and writing'),
 ('Integrated Science','SCI','Core biology, chemistry and physics concepts'),
 ('Social Studies','SOC','Ghanaian society, governance and environment'),
 ('Elective Mathematics','EMATH','Advanced mathematics concepts'),
 ('ICT','ICT','Information and communication technology')
ON CONFLICT (code) DO NOTHING;

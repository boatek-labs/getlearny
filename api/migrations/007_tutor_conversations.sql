CREATE TABLE IF NOT EXISTS tutor_conversations (
 id UUID PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL DEFAULT 'New chat',
 messages JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(messages)='array'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tutor_conversations_user_updated_idx
 ON tutor_conversations(user_id, updated_at DESC);

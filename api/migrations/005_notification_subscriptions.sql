CREATE TABLE IF NOT EXISTS notification_subscriptions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 endpoint TEXT NOT NULL UNIQUE,
 subscription JSONB NOT NULL,
 timezone VARCHAR(100) NOT NULL DEFAULT 'Africa/Accra',
 reminder_time TIME NOT NULL DEFAULT '19:00',
 daily_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_subscriptions_user_idx ON notification_subscriptions(user_id);

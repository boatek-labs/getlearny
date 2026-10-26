-- Study Buddy, streak activity, and referral attribution.
CREATE INDEX IF NOT EXISTS learning_logs_user_created_at_idx ON learning_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS test_logs_user_created_at_idx ON test_logs(user_id, taken_at DESC);
CREATE TABLE IF NOT EXISTS referral_codes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 code VARCHAR(32) NOT NULL UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS referrals (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 referrer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 referred_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 referral_code VARCHAR(32) NOT NULL REFERENCES referral_codes(code),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 qualified_at TIMESTAMPTZ,
 CONSTRAINT referral_no_self CHECK(referrer_user_id <> referred_user_id)
);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals(referrer_user_id, created_at DESC);

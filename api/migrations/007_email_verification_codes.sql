CREATE TABLE IF NOT EXISTS email_verification_codes (
  email TEXT PRIMARY KEY,
  otp_hash TEXT NOT NULL,
  pending_data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_verification_codes_expiry_idx ON email_verification_codes (expires_at);

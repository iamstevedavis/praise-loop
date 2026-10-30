-- Email one-time codes for passwordless sign-in (#157). Only a keyed hash of the
-- code is stored; a request supersedes the earlier code for the same address.
-- Expired, consumed and superseded rows stay for the audit trail and can be pruned.
CREATE TABLE email_sign_in_codes (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  superseded_at timestamptz
);
CREATE INDEX email_sign_in_codes_active ON email_sign_in_codes(email, created_at DESC)
  WHERE consumed_at IS NULL AND superseded_at IS NULL;

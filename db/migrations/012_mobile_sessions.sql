-- Sessions are either browser cookies (eight hours) or bearer tokens for the
-- native app (30 days, sliding, with a 90-day absolute cap).
ALTER TABLE auth_sessions ADD COLUMN kind text NOT NULL DEFAULT 'web' CHECK (kind IN ('web','mobile'));
ALTER TABLE auth_sessions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE auth_sessions ADD COLUMN last_seen_at timestamptz;
CREATE INDEX auth_sessions_owner_kind ON auth_sessions(owner_id, kind);

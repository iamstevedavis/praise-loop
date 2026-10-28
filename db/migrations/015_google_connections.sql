-- Scaffolding for Google Business Profile review sync (#46). No live connector yet.
CREATE TABLE google_connections (
  id bigserial PRIMARY KEY,
  business_id bigint NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES auth_users(id),
  location_name text NOT NULL CHECK (location_name ~ '^accounts/[^/]+/locations/[^/]+$'),
  encrypted_refresh_token text,          -- AES-256-GCM envelope; NULL after disconnect/revoke
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','disconnected')),
  page_checkpoint text,                  -- nextPageToken of an interrupted scan
  last_sync_at timestamptz,
  last_sync_count integer NOT NULL DEFAULT 0,
  last_error_code text,                  -- sanitized code only, never provider text
  created_at timestamptz NOT NULL DEFAULT now()
);

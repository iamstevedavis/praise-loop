CREATE TABLE owner_plans (
  owner_id text PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('free','pro')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','store')),
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE owner_plan_events (
  id bigserial PRIMARY KEY,
  owner_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  plan text NOT NULL,
  source text NOT NULL,
  expires_at timestamptz,
  actor text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX owner_plan_events_owner ON owner_plan_events(owner_id, created_at);

-- Expo push tokens per owner device, plus a durable per-device/per-period
-- delivery record so a worker restart never sends the same notification twice.
CREATE TABLE device_push_tokens (
 id bigserial PRIMARY KEY,
 owner_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
 token text NOT NULL UNIQUE,
 platform text NOT NULL CHECK (platform IN ('ios','android')),
 created_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_push_tokens_owner ON device_push_tokens(owner_id);
CREATE TABLE push_deliveries (
 id bigserial PRIMARY KEY,
 business_id bigint NOT NULL,
 period_start date NOT NULL,
 token text NOT NULL,
 count integer NOT NULL CHECK (count > 0),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','retry','sent','delivered','failed','invalid_token')),
 attempts integer NOT NULL DEFAULT 0,
 next_at timestamptz NOT NULL DEFAULT now(),
 ticket_id text,
 error_code text,
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (business_id, period_start) REFERENCES generation_periods(business_id, period_start) ON DELETE CASCADE,
 UNIQUE (business_id, period_start, token)
);
CREATE INDEX push_deliveries_work ON push_deliveries(state, next_at);

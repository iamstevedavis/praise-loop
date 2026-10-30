-- The owner's display name can come from Google or be set by the owner (#149).
-- An owner-set name must survive later provider sign-ins; existing rows keep
-- their name and are treated as provider-supplied. Data-preserving and additive.
ALTER TABLE auth_users ADD COLUMN name_source text NOT NULL DEFAULT 'provider'
  CHECK (name_source IN ('provider', 'owner'));

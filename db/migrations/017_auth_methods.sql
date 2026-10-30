-- Record how an owner signed in and when the method was added (#156). Existing
-- rows keep working: their timestamps stay NULL until the method is used again.
ALTER TABLE auth_accounts ADD COLUMN email text;
ALTER TABLE auth_accounts ADD COLUMN created_at timestamptz;
ALTER TABLE auth_accounts ADD COLUMN last_used_at timestamptz;

-- The method's own address is a display snapshot, not the owner's login email.
-- Existing methods came from the owner row, so copying it is lossless.
UPDATE auth_accounts a SET email = u.email FROM auth_users u WHERE a.owner_id = u.id AND a.email IS NULL;

CREATE INDEX auth_accounts_owner ON auth_accounts(owner_id);

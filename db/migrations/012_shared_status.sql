-- Owner-reported sharing from the phone's share sheet. This is not a verified
-- publication; it comes after `approved` and records when the owner said so.
ALTER TABLE draft_posts DROP CONSTRAINT draft_posts_status_check;
ALTER TABLE draft_posts ADD CONSTRAINT draft_posts_status_check CHECK(status IN ('draft','approved','scheduled','published','failed','archived','shared'));
ALTER TABLE draft_posts ADD COLUMN shared_at timestamptz;

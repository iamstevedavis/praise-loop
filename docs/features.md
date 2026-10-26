# Features

How each shipped feature works, how to verify it and how to roll it back. Owner sign-in and access rules are in [auth.md](auth.md); provider integrations are in [integrations.md](integrations.md).

## Onboarding: resumable first drafts (#30)

Run migrations through 011, configure owner login ([auth.md](auth.md)), and start the durable
worker/Redis ([Durable weekly generation](#durable-weekly-generation-43)). Signing in with no business opens `/onboarding`, a
four-step wizard (brand → reviews → making posts → first posts) that resumes where
you left off. “+ Add a business” in the sidebar opens `/onboarding?new=1`, which
starts a fresh setup with its own idempotency key. No Google connection, billing,
automatic approval or publishing is required.

1. Sign in, enter business name (1–120 characters), IANA timezone, colors and tone.
   Optional PNG/JPEG/WebP logo is validated before saving (256 KB / 4 MP); remote
   URLs/SVG/animation are rejected. Synthetic preview reuses the shared template.
2. Import a CSV or download the synthetic sample. Inspect persisted totals/bounded
   row errors. Duplicate imports are safe. Add more reviews if there are fewer than
   three eligible 4–5 star, 30+ character, suitable reviews after curation.
3. Explicitly queue up to three drafts (default weekly target three). Existing jobs
   and onboarding share the same weekly budget. Poll persisted state; auto-retries
   retain successful stages. Exhausted jobs offer bounded owner retry; fix branding
   on the Brand page before retrying rendering failures.
4. Open the actual owner-protected images and captions. “Usable previews” appears
   only after each image loads. Review in approval selects the saved business;
   the owner decides what to edit/approve. Real publishing still depends on #29.

Saved steps resume from owner-scoped database records and the business URL. A
sessionStorage UUID only deduplicates initial business creation; no review text,
logo or form content is stored there. Concurrent retries with the same owner/key
return the existing business. Unsaved initial form fields and file selections must
be entered again after reload. Expired sessions clear the wizard's loaded data.
Public sample CSV ships in the web image; private/generated media is excluded from
Docker build context and still requires owner-authorized image access.

### Actual timed evidence (2026-10-15)

Chromium production-server walkthrough: **5.46–5.70 seconds**, synthetic session and
injected caption provider, real Postgres and Sharp rendering. Included malformed
CSV, an insufficient first review, duplicate setup requests, reload/resume,
provider failure/recovery, adding reviews, and three 1080px previews. This is an
AUTOMATED synthetic timing, not a human/live-provider result or product SLA.
Live OAuth/provider latency and a human manual timing are not verified here.

Reproduce after build with `TEST_BROWSER=1 TEST_DATABASE_URL=... npx ts-node scripts/test-onboarding-browser.ts`.
Requires Chromium (CHROMIUM_PATH). The test invokes the real worker handler with
fixture captions and the real renderer; BullMQ delivery is covered separately.
`TEST_DATABASE_URL=... npm test` also verifies setup idempotency, owner isolation,
logo/timezone validation and database resume. No paid calls occur in ordinary tests.

Owner manual timing: start when business setup opens after sign-in; stop only when
all three image/caption previews visibly load. Record provider mode, failures,
review availability and elapsed time; do not substitute synthetic seconds for this
measurement. Retry/reload must retain the same business/import/job counts. Document
live results separately when owner credentials and a permitted setup are available.
Rollback: stop writes, retain onboarding keys and all existing business/review/job
records. No data is deleted by migration 011.

CI now supplies disposable Postgres/Redis services and installs matching Playwright
Chromium so database and all four browser/HTTP flows run instead of being skipped.

Resume without an explicit business ID prefers the latest saved onboarding business, falling back to the latest owned legacy business. An explicit owned business ID selects another business. Progress shows the newest five drafts, so old archived attempts do not permanently hide newer previews.

## Durable weekly generation (#43)

Run `npm ci`, `npm run db:migrate` (008), configure `REDIS_URL`, and run `npm run worker`.
Compose wires Redis into the worker. BullMQ 6 with ioredis handles durable delivery; Postgres
is the authoritative outbox/claim/quota store, so lost Redis deliveries are rebuilt.
The worker scans every 60s (minimum configurable 5s), not five new drafts per tick.
Only owned businesses participate. The Brand page (Posts per week) exposes weekly target 1–5,
default 3; changes apply to the next Monday-based business-local generation period.

A business-row transaction reserves review/draft jobs and counts all initial drafts
against the same period budget. Up to five pending/running/retrying jobs per business
bound backlog across rollover. Historical duplicates and their relationships remain
intact, but new canonical review→draft mappings are unique. Existing incomplete
current-period drafts are adopted instead of replaced. `generation_periods` persists
allocated/completed counts and quota_met/reviews_exhausted/backlog_full/queued reasons.

Claims have 90s renewable leases, three automatic attempts, 30s/60s backoff and
sanitized error codes. Caption calls time out at <=30s. Persisted caption/image
stages are reused after failures/restarts; a crash after a provider accepted a call
but before local persistence can require another call. Attempts and per-owner daily
counters bound that exposure; exactly-once paid calls are not promised.

`GET /api/generation?businessId=...` exposes only owner-authorized state. Existing
quote selection POST now queues generation (202), never a second synchronous AI
pipeline. `POST /api/generation/retry` takes draftPostId, only retries an exhausted
failed job, and permits at most two owner-triggered retries. Successful drafts stay
in draft status and require human approval. Do not manually reset a job's counters.

Validate with `TEST_DATABASE_URL=... TEST_REDIS_URL=redis://localhost:56379 npm test`.
Tests use isolated Postgres schemas and a uniquely named Redis queue; fake-provider
calls verify quota rollover, concurrent claims, lost Redis delivery, crashed leases,
retained stages, bounded retries and redaction. No provider key is used. Redis/db
access needs to remain internal; the public worker has no authentication bypass.
Rollback: stop the worker before reverting, retain new job/period tables and draft
reference annotations. Do not run the former unbounded timer-loop worker on live data.

Invalid legacy business timezones produce `invalid_timezone` without reserving jobs; correct the IANA timezone in business settings to resume. Compose always uses the Redis service hostname, independently of host `.env` URLs.

## Timezone-aware posting slots (#28)

Run migration 010, configure owner login ([auth.md](auth.md)), and ensure the durable worker/Redis is running ([Durable weekly generation](#durable-weekly-generation-43)). The Schedule page (`/schedule`) shows the PostingSlots component for the business selected in the app shell.

### Flow

1. Owner sets weekly posting slots (weekday + local time) on the Schedule page. Times are stored in business timezone.
2. On confirm, the system proposes the next 5 available UTC slots (skipping occupied) using business timezone with correct DST resolution.
3. Each selected approved draft gets a durable claim on a specific UTC instant before any provider call.
4. Provider submission is attempted; only verified Buffer "scheduled" receipts confirm the claim and set `draft_posts.status=scheduled`.
5. Failed/unknown provider results leave the claim in `unknown` state; draft stays `approved` for retry.

### DST handling

- `localSlotInstant` searches forward up to 24h for the next valid local minute.
- Nonexistent minutes (spring forward) resolve to the next valid minute.
- Repeated minutes (fall back) use the earliest UTC instant.
- Verified by `test-posting-slots.ts` for America/New_York, Australia/Lord_Howe.

### Acceptance

- `proposeSlots` returns future UTC instants matching the configured weekdays/times.
- `assignSlots` enforces ownership, draft completeness (caption + available image), version match, and slot availability.
- Concurrent assignment to the same slot is prevented by unique claim.
- Provider-unavailable returns 503 with no claim persisted.
- Ambiguous provider response marks claim `unknown`; draft remains `approved`.
- Confirmed provider receipt updates claim to `confirmed`, sets `external_id`, and moves draft to `scheduled`.
- Local confirmation failure after provider success leaves claim `pending`; draft stays `approved` (cannot resubmit same slot).

### Tests

- Unit: `scripts/test-posting-slots.ts` - DST/rollover, ownership, concurrency, ambiguous acceptance, provider fixtures
- Browser: `scripts/test-slots-browser.ts` - Chromium flow: schedule edit, confirm, provider failure, browser/business timezone persistence, branding logo upload/remove
- Run with `TEST_DATABASE_URL=... npm test` (unit) and `TEST_BROWSER=1 TEST_DATABASE_URL=... CHROMIUM_PATH=... npx ts-node scripts/test-slots-browser.ts` (browser)

### Boundaries

- No automatic scheduling; owner explicitly confirms each batch.
- Real scheduling requires verified Buffer connection (#29; see [integrations.md](integrations.md)). Without it, assign returns 503.
- Cancel/reschedule not yet supported; requires #29 provider operations.
- Maximum 5 slots per weekly batch (MVP limit).

### Rollback

Stop writes, retain `posting_slot_claims` and `businesses.posting_slots`. Migration 010 is additive.

## Quote-card rendering

Quote-card rendering uses Sharp/Pango measured wrapping with Bricolage Grotesque, loaded
from `assets/fonts` (SIL OFL, licence alongside), on a 1080px canvas with 80px safe margins
and automatic black/white contrast. Layout: rating stars top left, the verbatim quote in
the middle, reviewer and business name bottom left, logo bottom right. Quotes fit at
32–48px (Large: 40–56px); unfit text is rejected verbatim, never truncated. The Polished
(`premium`) tone sets the quote in DejaVu Serif. Supply optional logos as PNG/JPEG/WebP base64 data URLs (256 KB,
4 MP maximum); remote URLs/SVG/animation are rejected without network requests.
Manual and worker generation use the same tone/colors/logo. Regenerate explicitly
after brand changes. `IMAGE_EVIDENCE_DIR=/tmp/evidence npm test` saves synthetic PNGs.

Quote rendering falls back to DejaVu and Noto core/CJK fonts in both runtime images, including for Chinese, Japanese, Korean and other supported Unicode scripts. Host installations must install the same font packages before rendering.
Template settings: Brand (`/brand`) → Quote text size → live preview →
Save changes. `quote-card-v1` is the single supported template. Standard fits quotes at
32–48px; Large uses 40–56px and may reject longer quotes. Settings live in
`businesses.brand_colors` with data-preserving defaults in migration 005; run
`npm run db:migrate`. Color controls choose readable black/white text automatically.
Saving settings never changes existing draft images; explicitly regenerate and
review a new image. `TEST_DATABASE_URL=postgres://... npm test` also verifies real
Postgres migration preservation and settings round-trip in a disposable schema.

## CSV review import

CSV imports are limited to 1 MB / 1000 logical rows; quoted multiline cells are
supported. Optional `source_review_id` and `source_url` preserve manual-source
provenance. Reimports use a database-unique per-business/source ID, or a normalized
(rating/text/author/UTC millisecond date) fingerprint. Fingerprints cannot identify
edited reviews without stable IDs. Original text is retained. Migration 006 keeps
all historical duplicates and draft references, marks extra rows `duplicate_of`,
and prevents those rows entering new quote selection. UI reports imported,
duplicate, empty, invalid and storage-failed rows, with at most 20 redacted errors.
Ownership enforcement is supplied by #42 before any customer exposure.

Before customer access, configure owner login and explicitly claim any legacy data as described in [auth.md](auth.md).

## Approval

Approval supports inline caption edits, per-item bulk approval, archive, and persisted
job retries. Every draft mutation requires its current `version`; refresh on 409.
Approval requires nonempty caption and a decoded, available 1080px PNG. Edits and
regeneration clear approval; scheduled/published items require provider operations.
Migration 009 adds archived status, revisions and append-only actor/time/reason events.
Generated PNGs now use immutable content hashes; historical images remain compatible.
After building, run `TEST_BROWSER=1 TEST_DATABASE_URL=... npx ts-node scripts/test-approval-browser.ts`
with Chromium installed (`CHROMIUM_PATH` defaults to /usr/bin/chromium). Uses synthetic
sessions and fixtures only, with no external AI/social calls. Rollback requires
stopping writes first; retain audit events, revision columns, and immutable media.

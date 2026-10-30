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

Captions are limited to 200 characters. The prompt asks for 180 or less. A caption
that still comes back too long gets one extra provider call asking for a shorter
rewrite of just those captions. If that fails or is still too long, it ends on the
last full sentence (or whole word) that fits, never mid-word or mid-hashtag and
without a trailing "...". At most five hashtags are kept.

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
and automatic black/white contrast. Layout: rating stars top left and the business name
top right as a small brand header, the verbatim quote in the middle, the reviewer's name
as the signature bottom left, logo bottom right. A review with no reviewer name has no
signature: the business name is never used as one. Quotes fit at
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
Migration 013 adds owner-reported `shared` (only from `approved`, with `shared_at`
and an `owner_shared` audit event). It is shown as "Shared by you", never as a
verified publication, and is read-only; undo back to approved is a follow-up.
Generated PNGs now use immutable content hashes; historical images remain compatible.
After building, run `TEST_BROWSER=1 TEST_DATABASE_URL=... npx ts-node scripts/test-approval-browser.ts`
with Chromium installed (`CHROMIUM_PATH` defaults to /usr/bin/chromium). Uses synthetic
sessions and fixtures only, with no external AI/social calls. Rollback requires
stopping writes first; retain audit events, revision columns, and immutable media.

## Plans and entitlements (#94)

An owner has one plan, `free` (the default) or `pro`, stored in `owner_plans`
with its source (`manual` or `store`) and optional expiry. `owner_plan_events`
is an append-only audit trail of every change. Every owned business inherits
the owner's plan, which is what lets the plan limit "more than one business".

| Limit | Free | Pro |
|---|---|---|
| Drafts per business per week | 1 | 5 |
| Templates | 1 | 5 |
| Image watermark | Yes | No |
| Automatic review sync | No | Yes |
| AI review replies | No | Yes |
| Owned businesses | 1 | 3 |

The limits live in `lib/services/entitlements.ts` and are enforced on the server:

- `requestGeneration` caps the business's configured `weekly_target` inside the
  same business lock that reserves the weekly quota, including for a period
  created under an older plan.
- The worker and the manual render route pass the free-plan watermark into the
  deterministic renderer. It is drawn in the bottom safe margin, so it never
  covers the quote, reviewer, business name or logo, and a plan change produces
  a new content-addressed image.
- `POST /api/businesses` serializes creation per owner with an advisory lock and
  refuses a new business past the limit. A repeated `onboardingKey` still returns
  the original business, so a retried onboarding request cannot be blocked or
  duplicated.
- `GET /api/entitlements` is owner-authenticated, read-only and returns the
  effective plan and limits, plus `usage`: one entry per owned business with this
  week's allocated drafts against the effective cap (the owner's weekly target
  limited by the plan), whether the quota is met, and when the week resets
  (`resetsOn` is the next Monday in the business's timezone, `resetsAt` that
  instant). Usage reads `generation_periods` and `generationWeek`, so it never
  disagrees with what the generator enforces. `expired` is true when a stored
  Pro plan has lapsed and is read as Free. No route lets an owner change
  their own plan.

### Plan page and limit messages (#133)

Plans are visible but read-only: no upgrade button and no prices (pricing is
decided after the pilot; see `docs/mobile-plan.md`).

- **Plan page** (`/account`, reached from the profile menu; #150): the plan, where it came from
  (default, manual or store), its expiry, what it includes (posts per week,
  templates, watermark, review sync, AI replies, businesses) and per-business
  usage such as "1 of 1 post this week" with the reset date.
- **Expired Pro** reads as Free with a note saying when Pro expired.
- **This Week** says "You've reached this week's limit" and names the plan
  limit, instead of "All caught up", when the weekly quota is used up. It
  distinguishes a plan-capped target from a quota the owner set themselves.
- **Brand settings** shows the plan's weekly allowance beside "Posts per week",
  and says how many will be made when the target is higher.
- **Phone app**: the queue screen shows the same limit message; the plan details
  themselves moved to the Profile screen (#151) and read the same endpoint.
  Wording lives in `lib/planDisplay.ts` (web) and
  `mobile/src/queue/planSummary.ts` (phone) and both are covered by tests.
- Onboarding does not yet mention the limit; that is a follow-up.

Expired Pro falls back to Free at read time without deleting the stored plan, so
a renewal restores Pro. Operators set plans with:

```sh
npm run plan:set -- owner@example.com pro --reason "Pilot upgrade"
npm run plan:set -- --business 42 pro --expires 2027-01-01
```

The script resolves an email or business to the owner and records the actor,
reason and expiry in `owner_plan_events`. Payment-provider purchases will use
the same module from a verified webhook (#95). Migration 012 is additive;
rollback can leave the plan tables in place while reverting the checks.

### Public plans page (#134)

`/plans` is public: a signed-out visitor sees the Free and Pro cards, what
differs (posts each week per business, templates, watermark, review sync, AI
replies, businesses) and a "Continue with Google" call to action. The landing
page links to it from the header and the call to action, and also offers an
"Email me a sign-in code" option (#157) for owners without Google. `AppShell`
treats `/plans` as a bare route, like `/` and onboarding, so the signed-out
sign-in wall does not hide it.

- The comparison is worded in `lib/plansDisplay.ts` and rendered from
  `PLAN_LIMITS` in `lib/services/entitlements.ts`; the page keeps no copy of the
  numbers. `scripts/test-plans.ts` fails when a limit changes, when a new limit
  has no row, or when a row stops matching the expected wording.
- Prices stay off the page (`PLAN_PRICING = null`) until the owner records the
  Free/Pro prices in `docs/decisions.md`. The test fails if a pricing decision is
  recorded without prices, or if a price appears before one is.
- Wording is honest about what ships: Free's small watermark is stated plainly,
  review sync and AI replies read "Planned — not available yet", and a note says
  only one template design exists today. Nothing implies posting is connected or
  that there is a checkout.
- There is no payment, web checkout, promo code or plan-change control here;
  plans are still changed by operators or a store webhook (#95).
- A 401 while signed out does not redirect off `/plans` (`lib/sessionExpiry.ts`
  treats `/` and `/plans` as public pages), so a visitor can read the plans and
  then choose "Continue with Google".

## Owner profile (#149)

An owner can see who they are signed in as and fix a missing or wrong display name.
One owner-authenticated endpoint serves the web profile menu (#150) and the phone
profile screen (#151), so the two cannot disagree.

- `GET /api/profile` returns `name` (null when Google supplied none and the owner
  has not set one), `email`, `nameSource` (`provider`, `owner`, or null without a
  name), `provider` (the owner's linked sign-in method, Google first, or null
  when none is linked) and `initials` for the
  avatar. It returns no
  provider tokens and no other internal ids; the owner comes from the session, so
  another owner's row is never reachable. The response is `Cache-Control: private,
  no-store`.
- `PATCH /api/profile` accepts `{ "name": "..." }`, trimmed to 1–80 characters and
  rejecting control characters with 400. The email is read-only: it is the
  verified Google identity and changing it would break account linking.
- Migration 016 adds `auth_users.name_source`. A name the owner sets is recorded as
  `owner` and survives the next Google sign-in on the web and the phone, while an
  empty name may still be filled from the provider. The demo seeder's Free owner
  has no name, so the empty state is visible after `npm run dev:seed`.
- Both cookie and mobile bearer sessions use the same guard. Anonymous requests get
  401 (the route inventory in `scripts/test-authorization.ts`), and
  `scripts/test-profile.ts` covers provider, missing and owner-edited names, the
  sign-in-after-edit case and the read-only email.
- Avatars show initials for now; keeping Google's profile picture is a later
  decision (see `docs/decisions.md`).


## Linked sign-in methods (#156)

One owner can have several sign-in methods, but every path uses one rule: the
provider plus its stable subject is the identity, never the email alone. Google
may still link an owner that has the same verified address but no Google row;
a different Google subject on an already-linked address is rejected, as before
(#116/#117). A provider whose email claim is not guaranteed verified (Microsoft
later) creates a new owner instead of linking by email. A signed-in owner can
link another method from `/account` or the phone API even when the emails
differ, and the last method cannot be unlinked.

The shared code is `lib/authLinking.ts`; `docs/auth.md` records the policy and
`docs/decisions.md` records why. Migration 017 records the method's email and
its added/last-used timestamps, and is additive. `GET /api/account/methods`,
`POST /api/account/methods` (verified Google ID token) and
`DELETE /api/account/methods` are owner-wide and work with cookie and bearer
sessions.

Rollback: stop linking writes, retain `auth_accounts.email`, `created_at` and
`last_used_at`; old code ignores the extra columns. No owner or business data is
rewritten by the migration. `scripts/test-auth-linking.ts` covers link, reject,
unlink-last and the one-address/two-subject race.

Recovery has no in-app path until the verified email code (#157) ships. There is
no support override route and merging two owners remains an operator task.

## Profile menu (#150)

The web app keeps who the owner is and what they are on under one profile button
instead of spreading account things through the nav and the business switcher.

- The profile button sits at the bottom of the sidebar and in the phone top bar.
  It shows the owner's initials and their name where there is room. Its menu has
  a name/email header, **Plan and usage** (the full `/account` page), **Edit
  name** (inline) and **Sign out**, which deletes the server session.
- A missing name shows an unobtrusive "Add your name" prompt in the menu and on
  the profile page, never a blank or the raw email. The email is shown read-only.
- `/account` is now the full profile and plan page: name, read-only email, inline
  name editing, then the existing plan, limits and weekly usage sections. Editing
  the name updates the menu and the page through shared state, with no reload.
- "Plan" is no longer a top-level nav item, so the tab bar is back to the four
  work screens and the five-item layout from #141 is gone. Sign out is only in the
  profile menu; it was removed from the sidebar and the phone business dropdown.
- At phone width the profile button is in the top bar and its menu is anchored to
  it, inside the viewport and above the tab bar. It is a real button with an
  accessible name; Escape and an outside click dismiss the menu, and Escape
  returns focus to the button.
- Wording and the menu items live in `lib/profileDisplay.ts` (pure and
  client-safe), covered by `scripts/test-profile-display.ts`. The browser
  walkthrough (open, edit the name, reach the plan page, sign out, phone width) is
  `scripts/test-profile-browser.ts`.
- The demo seeder's Pro owner is named and its Free owner has no name, so both
  states can be walked with `npm run dev:seed`.


## Phone profile screen (#151)

The phone app reaches the profile from an initials avatar button in the queue
header; it is a normal expo-router screen with its own back button, so opening a
draft from the queue and coming back still works.

- The avatar shows initials from the name, or from the email's local part when
  Google gave no name. The queue loads the profile best-effort on focus, so a name
  edited on the profile screen shows up on the way back.
- **Name** and **email**. A missing name shows **Add your name**, a saved one
  shows **Edit name**; the email is read-only. A saved name appears immediately
  and after relaunch. The name rule is checked on the phone before the request
  (`mobile/src/profile/identity.ts`, mirroring `lib/services/profile.ts`) and the
  server's own 400 message is shown if it still rejects it.
- **Your plan**: the plan, its limits, this week's usage per business and the
  expiry note, moved here from the bottom of the queue. The queue keeps only the
  short "weekly limit reached" message that explains an empty week.
- **This app**: the app version and the API server it is talking to, for support
  and for the demo stack.
- **Notifications**: a placeholder row; the toggle arrives with #89.
- **Sign out**: revokes the session on the server, clears the stored token and
  returns to sign-in.
- Profile and plan requests are best-effort. A failure shows a retry on the
  profile screen and never blocks the queue, while a 401 goes through the
  session's `handleError` back to sign-in (see #137).
- Covered by `mobile/__tests__/profile.test.ts` (initials, display name, the name
  rule and the API wrapper's success, 400 and 401 cases) plus the client's
  best-effort test. Manual checks on iOS and Android are recorded in the PR.

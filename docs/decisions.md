# Decisions

Decision log to capture architecture/product calls and why they were made.

## Format

- Date: YYYY-MM-DD
- Decision: short title
- Why: rationale and constraints

---

## Log

- Date: 2026-10-27
  Decision: Send "posts ready" notifications through the Expo push HTTP API with `fetch`, not `expo-server-sdk`, and record each send in `push_deliveries` (#88)
  Why: Only two endpoints (send, getReceipts) are needed, so a plain, timeout-bounded `fetch` avoids a new dependency. A unique `(business_id, period_start, token)` delivery row makes one send per device per weekly period survive worker restarts; attempts are capped at three. Tokens reported as `DeviceNotRegistered` (by ticket or receipt) are deleted. Payloads carry only a count, the business name and a `praiseloop://queue` deep link. The transport is injectable so tests never call Expo.

- Date: 2026-10-26
  Decision: Accept hashed bearer sessions for the native app alongside NextAuth cookies (#80)
  Why: Native apps send neither cookies nor a matching Origin. `auth_sessions` gains a `kind` (`web` or `mobile`) and `created_at` so mobile sessions can slide for 30 days under a 90-day absolute cap without changing the web's eight-hour sessions. Both credentials in one request are rejected, and origin checks stay for cookie writes where CSRF applies. One guard still enforces ownership, upload size and limits for every route.

- Date: 2026-10-15
  Decision: Use a consented manual observation ledger and offline pilot report for #47
  Why: Current draft status/updated_at cannot reconstruct approval edits or session history. Explicit observations preserve unknown values, exclude synthetic businesses and avoid collecting review text or adding an unauthenticated report endpoint. No analytics platform or new dependency; human pilot outcomes remain unverified.

- Date: 2026-02-27
  Decision: Use lightweight markdown docs for alignment
  Why: Fast to edit, easy to review, low process overhead. Keeps intent, architecture, and workflow explicit without heavy tooling.

- Date: 2026-10-14
  Decision: Refresh dependencies, Docker, and build tooling to a supported baseline (issue #48)
  Why: Reproducible installs (npm ci + lockfile), real ESLint, multi-stage Docker builds with healthchecks, Node 22 baseline, CI. Upgrades stayed within current major versions (Next 15, React 19, TypeScript 5); Next 16 / TypeScript 7 major upgrades are deferred. Redis/BullMQ queue remains planned — the worker stays a timer loop until #41.

- Date: 2026-02-27
  Decision: Require explicit decision logging for architectural changes
  Why: Prevent re-litigating the same choices every week and reduce AI-driven drift in architecture over time.

- Date: 2026-02-27
  Decision: Build as a SaaS web application (not a library/framework)
  Why: The product is a revenue-generating automation tool for local businesses. It requires onboarding, dashboards, approval flows, and scheduling — not just reusable code.

- Date: 2026-02-27
  Decision: Use Node.js + TypeScript + Next.js
  Why: Strong ecosystem for API integrations, background jobs, and rapid product iteration. Type safety helps maintain architectural discipline as the codebase grows. Next.js supports both UI and API in one deployable unit.

- Date: 2026-02-27
  Decision: Use Postgres as primary datastore
  Why: Relational model fits businesses, reviews, drafts, and scheduling states well. Strong consistency guarantees and mature tooling. Avoid premature NoSQL complexity.

- Date: 2026-02-27
  Decision: Use Redis + BullMQ for background jobs
  Why: Review ingestion, quote extraction, image rendering, and scheduling are asynchronous tasks. A job queue ensures retries, observability, and reliability.

- Date: 2026-02-27
  Decision: Deploy MVP via Docker on existing VPS
  Why: Lowest cost, full control, fast iteration. Infrastructure simplicity outweighs managed-service benefits at early stage.

- Date: 2026-02-27
  Decision: Scheduler-first publishing strategy
  Why: Direct platform integrations (Instagram, X, Facebook, etc.) are complex and policy-heavy. Integrating with a scheduler (e.g., Buffer) reduces integration surface area and accelerates MVP delivery.

- Date: 2026-02-27
  Decision: Human-in-the-loop approval required for MVP
  Why: Protect brand voice and reduce risk. Auto-posting introduces reputational and legal risk. Manual approval builds trust and reduces AI hallucination exposure.

- Date: 2026-02-27
  Decision: PR-only development workflow (no direct pushes to main)
  Why: Prevent accidental architecture drift or destructive changes from AI agent. Maintain human oversight and review discipline.

- Date: 2026-10-15
  Decision: Render quote cards with Sharp's Pango text backend and DejaVu fonts (#8).
  Why: Actual glyph rasterization and measured wrapping replace unsupported SVG foreignObject layout. Runtime containers install the same font family; bounded embedded raster logos eliminate remote fetching and its SSRF risk. No text is silently shortened.

- Date: 2026-10-15
  Decision: Store quote-card-v1 options alongside existing brand colors (#26).
  Why: One typed template and two text sizes need no template framework. The sample preview uses the production renderer without persisting draft assets; default migration preserves colors and existing generated images.

- Date: 2026-10-15
  Decision: Enforce review identity in Postgres and preserve historical duplicates (#45).
  Why: Concurrent imports need a unique constraint, not check-then-insert. Normalize NFKC/case/whitespace and UTC milliseconds only for identity; retain original wording. Keep duplicate rows and their draft references under legacy keys, excluding them from new selection. Stable source IDs take precedence over imperfect manual fingerprints.

- Date: 2026-10-15
  Decision: NextAuth GitHub login with revocable database sessions and explicit legacy claims (#42). Superseded by the 2026-10-18 Google sign-in decision below; sessions/claims unchanged.
  Why: A maintained OAuth implementation handles sign-in/CSRF cookies. The minimal adapter stores no provider tokens and hashes session tokens. Shared server guards authorize every API family; DB counters persist generation limits. Media moves outside public with legacy URL denial. No password database, team roles or production provider setup.

- Date: 2026-10-15
  Decision: BullMQ delivery with a Postgres generation outbox, weekly reservations and renewable claims (#43).
  Why: Transactional business locks enforce quotas alongside draft uniqueness, while BullMQ provides the documented durable queue. An outbox recovers Redis loss without creating replacement drafts. Persisted stages bound redundant paid calls; retries and daily owner counters cap exposure.

- Date: 2026-10-15
  Decision: Serialize draft edits with revisions, transactional policy and append-only audit events (#44).
  Why: Every mutation shares ownership/lifecycle checks and a transaction context; stale revisions fail instead of overwriting edits. Approval decodes the persisted PNG. Rendering uses content-addressed filenames so approved artifacts cannot change in place. Chromium browser checks use playwright-core with an explicitly installed browser, never paid providers.

- Date: 2026-10-15
  Decision: Keep #29 blocked until owner Buffer access and a permitted live test are available.
  Why: Official GraphQL/OAuth-PKCE, scheduling/media and rate-limit interfaces are documented in integrations.md with dated references. No configured account/channel, encryption key or public media origin is available. Retire false stub success and content logging; no alternative provider, scraping or unverified live success is substituted.

- Date: 2026-10-15
  Decision: Keep Google sync #46 blocked at its access/reuse-policy feasibility gate.
  Why: Dated official prerequisites, OAuth/review contracts and policy references are captured in integrations.md. No approved project or permitted live location is configured, and temporary storage/manipulation rules need clarification for social reuse before adding a connector. Owner approval cannot substitute for provider access or policy resolution; no scraping/mock success.

- Date: 2026-10-18
  Decision: Use Google instead of GitHub as the owner OAuth provider (#76).
  Why: Pilot customers are small-business owners who rarely have GitHub accounts but usually have Google, often the account behind their Business Profile. Only openid/email/profile are requested, so no sensitive-scope verification is needed. Adapter, hashed database sessions, token discarding and ownership guards are unchanged. No GitHub app or real owners existed, so no account migration.

- Date: 2026-10-26
  Decision: Go mobile-first: an Expo app for owners on top of the existing server (#79, docs/mobile-plan.md)
  Why: Owners approve on their phones, not laptops, and a push notification is what brings them back weekly. Keeping the Next.js/Postgres/worker server avoids a rewrite; the app is a thin client over the same API and ownership guard. Expo gives one TypeScript codebase for iOS and Android. The app lives in `mobile/` as a separate package so web dependencies and builds are unaffected.

- Date: 2026-10-26
  Decision: Share sheet first; scheduler integration (#29) becomes a later paid feature (#79)
  Why: #29 is blocked on provider access, credentials and public media. The phone's share sheet lets the owner post the approved image and caption now, with media kept private. A new `shared` status records owner-reported posting and is never presented as verified publication. Approval stays required.

- Date: 2026-10-26
  Decision: Start hosting on the home server behind a Cloudflare Tunnel; move to a small VPS for paying customers (#79)
  Why: The pilot should cost about $0. The same Docker Compose stack runs in both places, and the app uses one HTTPS URL, so moving is a DNS change. Backups off the machine are required in both stages.

- Date: 2026-10-26
  Decision: Monetize through server-enforced plans (free/pro) unlocked by app-store subscriptions (#79)
  Why: AI captions, review sync, AI review replies and more posts per week are worth paying for, while CSV import and one weekly post keep a free tier. Entitlements live on the server so the app can't unlock features itself. The billing provider (for example RevenueCat) is chosen and stubbed in its own issue, as CONTRIBUTING.md requires.

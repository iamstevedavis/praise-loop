# Architecture

## Tech stack

Define and maintain the core stack in this section as the source of truth:

### Runtime(s)

- Node.js (TypeScript)

### Framework(s)

- Next.js (app + API routes) for web UI + API surface
- Worker process for background jobs (separate entrypoint)
- Expo (React Native, TypeScript) for the owner's iOS/Android app in `mobile/`, a separate package that talks only to our API ([mobile-first plan](mobile-plan.md))

### Data store(s)

- Postgres (primary datastore)
- Redis + BullMQ for generation delivery; Postgres outbox, quotas and renewable claims are authoritative
- If we later want fewer moving parts, we can consider a Postgres-backed queue, but start with Redis for maturity.

### Infrastructure / deployment model

- Docker Compose for MVP: the pilot runs on a home server behind a Cloudflare Tunnel, then a small VPS ([hosting](mobile-plan.md#hosting)):
  - web: Next.js
  - worker: background jobs
  - postgres
  - redis
  - Generated images: shared `generated_media` volume between worker and web containers; S3-compatible (MinIO) object storage is a future option

### Testing and CI tooling

- Tests: Node `assert` suites run via ts-node (`scripts/test-*.ts`) with synthetic fixtures (no external services required)
- Lint: ESLint (flat config + typescript-eslint)
- CI: GitHub Actions (lint, typecheck, test, production build)

## Key patterns

### Product boundaries (modules)

- Ingestion: review sources → normalized Review records
- Curation: quote selection + ranking
- Generation: captions + variants + metadata
- Rendering: templates → images
- Scheduling: publish/schedule integration (scheduler-first)
- Approval: human-in-the-loop state machine for drafts

### Data flow rules

- All writes go through the API layer (no direct DB writes from UI)
- Worker consumes jobs and writes results back to Postgres
- Rendering is deterministic from (template + brand + quote + caption)

### API compatibility for the mobile app

- Installed apps cannot be upgraded on demand. API changes the app uses must be
  additive; a breaking change needs a new route and an old one kept until the
  minimum supported version moves past it.
- `GET /api/mobile/config` is public and owner-free. It returns
  `minimumVersion`, `latestVersion` and `features` from `MOBILE_MINIMUM_VERSION`,
  `MOBILE_LATEST_VERSION` and comma-separated `MOBILE_FEATURES` (defaults:
  `1.0.0`, `1.0.0`, none). Below `minimumVersion` the app shows an update screen.
  The response is cacheable for a short time and carries no cookies. It is the
  only unauthenticated route besides NextAuth's handlers.

### State machine (draft lifecycle)

- ImportedReview → CandidateQuote → DraftPost → Approved → Scheduled → Published (best-effort)
- Planned for the share-sheet flow: Approved → Shared (owner-reported; never shown as a verified Published)
- Every transition is stored with timestamps for audit/debugging

### Error handling and observability

- All external API calls must be wrapped with:
  - timeouts
  - retries with backoff (bounded)
  - structured logging including request IDs
- Record "why failed" in job metadata; never silently drop jobs

### Security / privacy

- Never store OAuth refresh tokens unencrypted at rest
- Do not store more customer review data than needed (quote + rating + date + source id)
- No secrets in repo; env vars only

## Directory structure

```text
.
├─ README.md / CONTRIBUTING.md
├─ docs/           # product, architecture, decisions, plans, feature and ops docs
├─ app/            # Next.js app (UI pages + API routes)
├─ lib/            # shared domain logic (db, services, integrations)
├─ worker/         # durable generation worker entrypoint
├─ scripts/        # migrations, db health, scheduling sweep, test suites
├─ db/migrations/  # SQL migrations
├─ mobile/         # Expo app (planned)
└─ Dockerfile.web / Dockerfile.worker / Dockerfile.dev / docker-compose*.yml
```

## Don’t do X

- Don’t add new frameworks without a documented decision (`docs/decisions.md`)
- Don’t let UI talk directly to external APIs (go through our API)
- Don’t embed secrets/tokens in logs
- Don’t auto-post without an explicit approval step (MVP)

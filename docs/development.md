# Development and operations

Setup beyond the [README](../README.md) quickstart: container workflows, configuration, migrations, tests, the worker and deployment.

## Quickstart — all containers (development, hot reload)

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Later runs only need `up`; add `--build` after changing `Dockerfile.dev`.

The dev override runs `next dev` and mounts the repository into the
migrate/web/worker containers as uid/gid 1000 (the image's `node` user), so
files they write stay owned by you. Rendered media goes to `./private-media`
instead of the `generated_media` volume.

Startup order is `deps` → `migrate` → `web`/`worker`. `deps` keeps the shared
`node_modules` volume in sync with `package-lock.json`, running `npm ci` only
when the lockfile changed, so pulling new dependencies needs no rebuild or
volume reset. If the stack is already running when dependencies change, run
`up` again and then `restart web worker`. Migrations run from the mounted
source, so new migration files apply on the next `up`.

### Troubleshooting

- **`password authentication failed for user "postgres"`**: the
  `postgres_data` volume keeps the password it was first initialized with;
  later `POSTGRES_PASSWORD` changes are ignored. Reset it to match `.env`
  (keeps data):
  `docker compose exec postgres psql -U postgres -c "ALTER ROLE postgres PASSWORD '<POSTGRES_PASSWORD>'"`
- **`Module not found` / `Cannot find module` after a pull**: run `up` again so
  `deps` resyncs, then restart web/worker. As a last resort,
  `docker compose -f docker-compose.yml -f docker-compose.dev.yml down` and
  `docker volume rm praise-loop_node_modules`.
- **`Permission denied` on `.next/`, `public/` or `private-media/`**: files left
  root-owned by older containers; `sudo chown -R $USER:$USER .` once.

## Quickstart — all containers (production-style)

```bash
cp .env.example .env
docker compose up --build
```

Runs migrations once, then starts the built web app (`next start`) and the
compiled worker. Generated images are shared between worker and web via the
`generated_media` volume. Put this behind a reverse proxy; only port 3000 is
published.

## Configuration

Copy `.env.example` to `.env`. Never commit `.env`.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes (host exec) | Host execution connects to `...@localhost:5432/...`; Compose services build their own URL from `POSTGRES_*` via the `postgres` service name |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | yes (containers) | Defaults in `.env.example`; do not rename the database/volumes (data lives there) |
| `OPENAI_API_KEY` | no | Enables caption generation; without it the worker marks affected drafts `failed` with an actionable error instead of crashing |
| `OPENAI_TIMEOUT_MS` | no | Caption provider timeout in milliseconds (default `20000`); on timeout the draft is marked `failed` with an actionable error |
| `DRAFT_PIPELINE_INTERVAL_MS` | no | Worker sweep interval (default `60000`) |
| `MEDIA_ROOT` | no | Where rendered draft images are written/served (default `private-media`, the owner-protected `generated_media` volume mount in Compose; host upgrades must move existing images there as described in [auth.md](auth.md)) |
| `REDIS_URL` | no | Reserved for future queue work; unused by the current worker |

Postgres and Redis ports are bound to loopback (`127.0.0.1`) only — reachable
from the host, not exposed to the network.

## Database migrations

- `npm run db:migrate` — applies SQL files from `db/migrations` in filename order; applied files are recorded in `schema_migrations`
- `npm run db:health` — connectivity check

## Tests, lint, typecheck, build

```bash
npm test          # pipeline + branding routes + caption decoding + media smoke + tooling regressions (synthetic, no external services)
npm run lint      # ESLint
npm run typecheck # tsc --noEmit
npm run build     # next build
```

### Opt-in live-provider verification

`npm test` never calls the paid provider. To verify caption decoding against
the real OpenAI Responses API (one paid call):

```bash
LIVE_PROVIDER_VERIFY=1 OPENAI_API_KEY=sk-... npm run test:live
```

Without `LIVE_PROVIDER_VERIFY=1` and `OPENAI_API_KEY` the script reports the
skip honestly and exits 0, so CI stays green without credentials.

## Worker

- `npm run worker` — draft generation loop (quote selection → captions → image render) every `DRAFT_PIPELINE_INTERVAL_MS`
- `npm run worker:schedule` — retired; fails closed pending verified provider setup

## Production deployment notes

- `docker compose up --build` is the production-style path: multi-stage builds, deterministic `npm ci`, healthchecks, bounded shutdown (`stop_grace_period`), shared media volume, loopback-only database/Redis ports.
- Restart safety: database and generated media live in named volumes (`postgres_data`, `generated_media`); container restarts preserve them.
- Image delivery: the worker writes PNGs into the shared `generated_media` volume; the web container serves them via `GET /api/media/<filename>` (see `app/api/media/[name]/route.ts`). Browsers should always use the `/api/media/...` URL stored in `draft_posts.image_path` — never a bare `public/generated/...` path, because runtime-written files under `public/` are not guaranteed to be served by the Next production server.

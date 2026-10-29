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
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | no | Caption generation through [OpenRouter](https://openrouter.ai) when `OPENAI_API_KEY` is unset (OpenAI wins if both are set). `OPENROUTER_MODEL` is required with the key and has no default: pick an id at openrouter.ai/models (ids ending in `:free` cost nothing but are rate limited, roughly 20 requests/minute and 50/day on a free account, and some providers log prompts, which contain reviewer quotes). Weaker models fail the JSON/length checks more often; those drafts are marked `failed` and can be retried |
| `OPENAI_TIMEOUT_MS` | no | Caption provider timeout in milliseconds (default `20000`, applies to either provider); on timeout the draft is marked `failed` with an actionable error |
| `DRAFT_PIPELINE_INTERVAL_MS` | no | Worker sweep interval (default `60000`) |
| `EXPO_ACCESS_TOKEN` | no | Expo push access token; only needed if enhanced push security is enabled on the Expo project |
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
- Prefer the published images for a server: every merge to master and every `v*` tag builds `ghcr.io/iamstevedavis/praise-loop-web` and `ghcr.io/iamstevedavis/praise-loop-worker` after CI passes. See [Published images](#published-images).
- Restart safety: database and generated media live in named volumes (`postgres_data`, `generated_media`); container restarts preserve them.
- Image delivery: the worker writes PNGs into the shared `generated_media` volume; the web container serves them via `GET /api/media/<filename>` (see `app/api/media/[name]/route.ts`). Browsers should always use the `/api/media/...` URL stored in `draft_posts.image_path` — never a bare `public/generated/...` path, because runtime-written files under `public/` are not guaranteed to be served by the Next production server.

## Pilot hosting

Runs the production stack on the home server, reachable over HTTPS through a
Cloudflare Tunnel with no inbound ports ([hosting plan](mobile-plan.md#hosting)).
`docker-compose.pilot.yml` adds `cloudflared` and unpublishes the web port, so
only the tunnel (an outbound connection) reaches `web`. Postgres and Redis stay
on loopback. Commands marked **owner** touch the real server and secrets, so the
owner runs them.

1. **Owner:** in Cloudflare Zero Trust, create a tunnel, add a public hostname
   (for example `praise.example.com`) with service `http://web:3000`, and copy
   the tunnel token.
2. **Owner:** on the server, `cp .env.example .env` and set strong
   `POSTGRES_PASSWORD`, `NEXTAUTH_SECRET`, Google and OpenAI keys,
   `CLOUDFLARE_TUNNEL_TOKEN`, and `NEXTAUTH_URL=https://praise.example.com`. The
   app's production `API_BASE_URL` is that same URL. Add
   `https://praise.example.com/api/auth/callback/google` as an authorized
   redirect URI on the Google OAuth client ([auth.md](auth.md)).
3. **Owner:** start it: `docker compose -f docker-compose.yml -f docker-compose.pilot.yml up -d --build`.
4. Verify from outside the home network (phone on mobile data):
   `curl -I https://praise.example.com/` works, and
   `nc -vz <home public IP> 3000 5432 6379` is refused.

### Backups and restore

`ops/backup.sh` writes a gzipped `pg_dump` and a tarball of the `generated_media`
volume, checks both, copies them off the machine with [rclone](https://rclone.org)
(`BACKUP_REMOTE`, for example Backblaze B2 or Google Drive), and deletes copies
older than `RETENTION_DAYS` (default 14). **Owner:** configure an rclone remote,
then cron it from the repo root:

```cron
30 3 * * * cd /srv/praise-loop && BACKUP_REMOTE=offsite:praise-loop HEALTHCHECK_PING_URL=<backup heartbeat URL> ops/backup.sh >> /var/log/praise-backup.log 2>&1
```

Restore (replaces the database and media) into a fresh or running stack:

```bash
rclone copy offsite:praise-loop/db-<stamp>.sql.gz . && rclone copy offsite:praise-loop/media-<stamp>.tar.gz .
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.pilot.yml" ops/restore.sh db-<stamp>.sql.gz media-<stamp>.tar.gz
```

Drill the restore after setup and after any change to the stack. The script was
drilled on a throwaway local stack: seed a business and a media file, back up,
`docker compose down -v`, restore into a new project, and both came back.

### Uptime alert

`ops/healthcheck.sh` requests `PUBLIC_URL/api/auth/providers` and pings
`HEALTHCHECK_PING_URL` only on success. Create two heartbeat checks in a free
Healthchecks.io account (one for this, one for the backup) that email or push
the owner when a ping is missing. Cron it every 5 minutes:
`*/5 * * * * PUBLIC_URL=https://praise.example.com HEALTHCHECK_PING_URL=... /srv/praise-loop/ops/healthcheck.sh`.
A power or internet outage stops the pings, which raises the alert.

### Published images

The `images` job in `.github/workflows/ci.yml` builds both images on every PR with
`push: false`, so a broken Dockerfile fails review. On master it pushes after
`verify` passes; version tags also get semver tags. Images are `linux/amd64` only
(see [decisions](decisions.md)).

```bash
# First run on a server with the repo checked out (pulls instead of building):
docker compose pull
docker compose up -d

# Pin the exact build that CI produced (short sha tag):
PRAISELOOP_TAG=sha-abc1234 docker compose pull
PRAISELOOP_TAG=sha-abc1234 docker compose up -d

# Roll back: pick an earlier sha- tag and repeat. Migrations are forward-only,
# so restore the matching database backup if the release included a migration.
PRAISELOOP_TAG=sha-def5678 docker compose up -d
```

`docker-compose.yml` keeps `build:` so local and dev builds still work; Compose
uses the `image:` when it is present. `migrate`, `web` and `worker` use the
published web/worker images (migrate runs the worker image).

GHCR packages are private by default. Log the server in once if pulls return
`denied`; use a token with `read:packages` (a classic PAT is simplest):

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
```

Making the packages public avoids that step, but only do it if images can never
contain secrets — configuration is supplied from the environment at runtime.

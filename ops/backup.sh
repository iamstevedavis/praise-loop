#!/usr/bin/env bash
# Nightly backup: pg_dump + generated_media tarball, copied off the machine
# with rclone, with retention. Run from the repo root on the server (cron).
# Config via env (put in the cron line or an env file outside the repo):
#   BACKUP_REMOTE     rclone destination, e.g. "offsite:praise-loop-backups" (required)
#   BACKUP_DIR        local staging dir (default /var/backups/praise-loop)
#   RETENTION_DAYS    days to keep, local and remote (default 14)
#   COMPOSE           compose command (default "docker compose -f docker-compose.yml -f docker-compose.pilot.yml")
#   HEALTHCHECK_PING_URL  optional URL pinged on success (dead-man alert)
set -euo pipefail

: "${BACKUP_REMOTE:?set BACKUP_REMOTE to an rclone destination}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/praise-loop}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE="${COMPOSE:-docker compose -f docker-compose.yml -f docker-compose.pilot.yml}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
repo="$(pwd)"
mkdir -p "$BACKUP_DIR"

db="$BACKUP_DIR/db-$stamp.sql.gz"
media="$BACKUP_DIR/media-$stamp.tar.gz"

# shellcheck disable=SC2016  # expanded inside the container
(cd "$repo" && $COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner') | gzip > "$db.partial"
mv "$db.partial" "$db"
(cd "$repo" && $COMPOSE exec -T web tar -C /app/private-media -czf - .) > "$media.partial"
mv "$media.partial" "$media"

# A truncated dump must fail loudly rather than be uploaded as a good backup.
gzip -t "$db" && tar -tzf "$media" >/dev/null

rclone copy "$db" "$BACKUP_REMOTE"
rclone copy "$media" "$BACKUP_REMOTE"

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*' -o -name 'media-*' \) -mtime "+$RETENTION_DAYS" -delete
rclone delete "$BACKUP_REMOTE" --min-age "${RETENTION_DAYS}d" --include 'db-*' --include 'media-*'

[ -z "${HEALTHCHECK_PING_URL:-}" ] || curl -fsS -m 10 "$HEALTHCHECK_PING_URL" >/dev/null
echo "backup ok: $db $media"

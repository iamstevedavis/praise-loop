#!/usr/bin/env bash
# Restore a backup into a running stack. DESTRUCTIVE: replaces the database
# contents and media. Use on a fresh stack (restore drill) or after a loss.
# Usage: ops/restore.sh <db-*.sql.gz> <media-*.tar.gz>
# COMPOSE overrides the compose command (default: the base file only).
set -euo pipefail

[ $# -eq 2 ] || { echo "usage: $0 <db-*.sql.gz> <media-*.tar.gz>" >&2; exit 2; }
db="$(readlink -f "$1")"; media="$(readlink -f "$2")"
COMPOSE="${COMPOSE:-docker compose}"
gzip -t "$db" && tar -tzf "$media" >/dev/null

$COMPOSE up -d postgres
$COMPOSE stop web worker >/dev/null 2>&1 || true
# shellcheck disable=SC2016  # expanded inside the container
$COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$POSTGRES_DB\""'
# shellcheck disable=SC2016
gunzip -c "$db" | $COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q'

# Media volume is written through a throwaway worker container.
$COMPOSE run --rm --no-deps -T --entrypoint sh worker -c 'rm -rf /app/private-media/* /app/private-media/.[!.]* 2>/dev/null; tar -C /app/private-media -xzf -' < "$media"
$COMPOSE up -d
echo "restore ok"

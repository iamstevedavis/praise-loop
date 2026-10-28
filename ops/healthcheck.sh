#!/usr/bin/env bash
# Uptime check for cron (every 5 min) through the public tunnel hostname.
# Pings HEALTHCHECK_PING_URL (e.g. a Healthchecks.io / UptimeRobot heartbeat
# URL) only when the site answers, so the monitor alerts on silence.
#   PUBLIC_URL  e.g. https://praise.example.com (required)
set -euo pipefail
: "${PUBLIC_URL:?set PUBLIC_URL to the tunnel hostname}"
curl -fsS -m 10 -o /dev/null "$PUBLIC_URL/api/auth/providers"
[ -z "${HEALTHCHECK_PING_URL:-}" ] || curl -fsS -m 10 "$HEALTHCHECK_PING_URL" >/dev/null

#!/bin/sh
# Entrypoint for the `mobile` service in docker-compose.dev.yml: keeps the phone app's
# dependencies in step with package-lock.json, finds this machine's LAN address and
# starts the Expo dev server for Expo Go. Runs with the host network, so the address it
# finds is the one a phone on the same Wi-Fi can reach.
set -eu
cd /app/mobile

if ! sha256sum -c --status node_modules/.package-lock.sha256 2>/dev/null; then
  echo "mobile: package-lock.json changed; running npm ci"
  npm ci
  sha256sum package-lock.json > node_modules/.package-lock.sha256
fi

# DEV_LAN_IP in .env overrides detection (useful with several networks or a VPN).
IP="${DEV_LAN_IP:-$(node - <<'JS'
const os = require("os");
const skip = /^(lo|docker|br-|veth|virbr|cni|flannel|tailscale|zt|wg|tun)/;
const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
  if (skip.test(name)) continue;
  for (const a of addrs ?? []) {
    if (a.family === "IPv4" && !a.internal && priv.test(a.address)) { console.log(a.address); process.exit(0); }
  }
}
JS
)}"
if [ -z "$IP" ]; then
  echo "mobile: could not find a LAN address; set DEV_LAN_IP in .env" >&2
  exit 1
fi

export REACT_NATIVE_PACKAGER_HOSTNAME="$IP"
export EXPO_PUBLIC_API_BASE_URL="${EXPO_PUBLIC_API_BASE_URL:-http://$IP:3000}"
PORT="${MOBILE_PORT:-8081}"
echo "mobile: open Expo Go on a phone on this network and enter exp://$IP:$PORT (API: $EXPO_PUBLIC_API_BASE_URL)"
exec npx expo start --lan --port "$PORT"

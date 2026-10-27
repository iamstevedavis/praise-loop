import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression coverage for the issue-48 tooling baseline: real lint, declared
// sharp, pinned Node baseline, documented env URLs, and a production web
// image that never quietly runs `next dev`.
const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const pkg = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  engines?: { node?: string };
};

assert.equal(pkg.scripts.lint, "eslint .", "lint must run ESLint, not a placeholder");
assert.ok(pkg.scripts.worker, "worker execution must be a first-class npm script");
assert.ok(pkg.dependencies?.sharp, "sharp must be a declared runtime dependency");
assert.ok(pkg.engines?.node, "engines.node must declare the Node baseline");

const nodeMajor = /\d+/.exec(pkg.engines.node)?.[0] ?? "";
assert.equal(read(".nvmrc").trim(), nodeMajor, ".nvmrc must match engines.node major");

const envExample = read(".env.example");
assert.match(envExample, /@localhost:5432/, ".env.example must document the host DATABASE_URL");
assert.match(envExample, /@postgres:5432/, ".env.example must document the container DATABASE_URL");

assert.doesNotMatch(
  read("Dockerfile.web"),
  /CMD \["npm", "run", "dev"\]/,
  "production web image must not run next dev"
);



for (const file of ["docker-compose.yml", "docker-compose.dev.yml"]) {
  assert.match(read(file), /REDIS_URL=redis:\/\/redis:6379/, "Compose must override host Redis URL with its service hostname");
  assert.doesNotMatch(read(file), /REDIS_URL=\$\{REDIS_URL/, "host .env must not redirect the worker to localhost");
}

// Pilot hosting (#90): the overlay must hide web and take the tunnel token
// from the environment, and the ops scripts must exist and stay secret-free.
const pilot = read("docker-compose.pilot.yml");
assert.match(pilot, /ports: !reset \[\]/, "pilot overlay must unpublish the web port");
assert.match(pilot, /TUNNEL_TOKEN=\$\{CLOUDFLARE_TUNNEL_TOKEN:\?/, "tunnel token must come from .env, required");
assert.doesNotMatch(pilot, /eyJ[A-Za-z0-9]{20,}/, "no tunnel token in the repo");
assert.match(read(".env.example"), /^CLOUDFLARE_TUNNEL_TOKEN=$/m, "token must be blank in .env.example");
for (const f of ["backup.sh", "restore.sh", "healthcheck.sh"]) {
  assert.match(read(`ops/${f}`), /^#!\/usr\/bin\/env bash\nset -euo pipefail|^#!\/usr\/bin\/env bash\n(#.*\n)+set -euo pipefail/, `${f} must fail fast`);
}
console.log("tooling regression tests passed");

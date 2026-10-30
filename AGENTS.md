# AGENTS.md

Rules for any coding agent working in this repository (Claude Code, Codex, OpenCode,
Cursor and others). Commands, architecture and test notes are in [CLAUDE.md](CLAUDE.md);
contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md). Read both first.

## Never work in the main checkout

The folder this repo was cloned into stays on `master` and is only used to pull. Don't
create or switch branches, commit, or leave uncommitted edits there. People and other
agents run the app from it, and a branch switch underneath them breaks their dev stack
and loses work.

Make every change in its own git worktree, branched from the up-to-date default branch:

```bash
git fetch origin
git worktree add .claude/worktrees/<short-name> -b <branch-name> origin/master
cd .claude/worktrees/<short-name>
```

- Branch names: `issue-<id>-<slug>` for an issue, otherwise `fix-`, `feat-`, `chore-` or
  `docs-` plus a slug.
- Install dependencies in the worktree (`npm ci`; `mobile/` has its own) and run tests
  there. If Node isn't installed on the host, run them in a `node:22` container (see
  [docs/development.md](docs/development.md)).
- If the branch you need is already checked out in another worktree, use that worktree.
- When the PR is merged, remove the worktree and delete the branch.
- Claude Code's `EnterWorktree` tool does the same thing.

## Pull requests

- One PR per issue. Start the body with `Closes #<id>` (or `Refs #<id>` for partial work),
  then what changed, how to test, and tradeoffs. Report real command output and say plainly
  what you did not run.
- Run lint, typecheck and the full test suite first. Set `TEST_DATABASE_URL` (and
  `TEST_REDIS_URL` for the queue tests): database suites skip silently without it.
- Keep PRs focused: no dependency upgrades or unrelated refactors.
- When behaviour changes, update the docs and, as CLAUDE.md says, the dev seeder and
  `sample-data/`.

## Review and merge

- Open the PR, watch CI and review comments, then stop. Don't merge unless asked.
- Reply to every review comment saying what changed, or why nothing needed to. The `master`
  ruleset requires all review threads to be resolved.
- `master` needs linear history and squash merge is off, so merge with
  `gh pr merge --rebase`. A PR branch must be up to date with `master` to merge: rebase it
  (merging `master` into it breaks the rebase merge). Don't force-push a branch someone else
  is using.

## Safety

- Never commit secrets, `.env` files, real customer reviews or credentials. Test data is
  synthetic.
- No schema change without an issue and a migration; never rotate secrets or environment
  variables without explicit approval. The guardrails in CONTRIBUTING.md apply.

# Contributing

## Team rules

- Always open PRs
- One PR per issue
- No dependency upgrades unless asked
- Run tests before requesting review
- Tests required
- No giant refactors without an issue

## Practical expectations

- Keep PRs focused and reviewable
- Link issue/context in PR description (`Closes #<id>` for completing PRs)
- Closing keywords only fire when the PR merges into master; stacked PRs
  targeting another branch must be retargeted to master before merging
- Add/update docs when behavior changes
- Prefer incremental changes over big-bang rewrites
- Prefer targeted edits over refactors
- Don't re-read whole repo; ask for file list first
- When uncertain: ask a question instead of exploring 30 files

## Model usage guidance

- Use a cheaper model for routing/summarizing
- Use a stronger model only for actual implementation and debugging

## AI agent development loop (OpenClaw)

When implementing an issue:

1. Create a branch: `issue-<id>-<slug>`
2. Make the smallest change that satisfies acceptance criteria
3. Update or add tests
4. Run: lint, typecheck, tests
5. Open PR referencing the issue and include:
   - `Closes #<id>` when the PR completes the issue, so it auto-closes on merge
     (use `Refs #<id>` only for partial/blocked work and list what remains)
   - What changed
   - How to test
   - Any tradeoffs / follow-ups
6. Stop

### Hard guardrails

- Never push to main
- Never rotate secrets, tokens, or env vars without explicit approval
- Never change DB schema without an issue and migration
- Never add new integrations without stubbing + documented decision
- Never auto-post content in MVP; approval required

# Integrations

Feasibility gates, dated official references and owner setup for third-party providers. Neither integration is live yet.

## Buffer feasibility gate (#29) — checked 2026-10-15

Status: BLOCKED; no owner-authorized Buffer account/client/channel or public test
media origin is configured in this session. This PR completes research and removes
false stub success only, not the integration. Keep #29 open and this PR draft until
provider implementation/live acceptance is supplied. No external post was attempted.

### Verified official interfaces

- [Quick start](https://developers.buffer.com/guides/getting-started.html): GraphQL
  at https://api.buffer.com. Personal API keys act on the owner's account; do not
  share one global key across customers.
- [Authentication](https://developers.buffer.com/guides/authentication.html): SaaS
  clients use owner OAuth authorization-code + PKCE, registered redirect URI,
  state validation, account:read/posts:read/posts:write and offline_access. Refresh
  tokens rotate on each use; refreshing must hold a durable per-connection lock.
- [Posts and scheduling](https://developers.buffer.com/guides/posts-and-scheduling.html):
  customScheduled + dueAt UTC submits future posts in advance. Scheduled is distinct
  from sent/error. Supported services include Instagram and others; choose and
  verify ONE channel before implementation claims.
- [Image posts](https://developers.buffer.com/examples/create-image-post.html):
  asset image URLs must be provider-fetchable. Private /api/media owner cookies
  cannot be used. Plan narrowly scoped, expiring capabilities for one immutable
  approved artifact; never make draft filenames generally public/enumerable.
- [Rate limits](https://developers.buffer.com/guides/api-limits.html): use response
  Retry-After/RateLimit data with bounded backoff; quotas depend on plan/client.
  Recheck actual limits at connection time; do not hardcode these as posting limits.

No idempotency or reconciliation guarantee is assumed from the createPost examples.
An accepted request followed by a timeout/local write failure is ambiguous: persist
an unknown outcome for manual/provider reconciliation, never blindly create again.
Verify current deletion/cancel and any reschedule contract with the registered
client; refuse unsupported changes instead of changing local dates alone.

### Exact owner actions to unblock

1. Select one permitted test channel/account and register a confidential OAuth app
   in Buffer Settings → API with a canonical callback URL. Confirm API/channel access.
2. Make client ID/secret and a separate encryption key available via runtime secret
   configuration (not this repo/chat/logs). Use authenticated encryption at rest,
   owner/business-bound associated data, and a documented key rotation process.
3. Authorize the selected business connection in the app once implemented; select
   organization/channel, verify it belongs to that connection, and provide a public
   HTTPS test media origin for the capability route. Keep ordinary media private.
4. Explicitly authorize one externally visible synthetic test post, its channel and
   scheduled time before any write. Record redacted external ID/state evidence,
   verify sent/error reconciliation, and confirm cancel/reschedule/disconnect behavior.

### Remaining implementation / merge gate

Owner OAuth connect/select/disconnect; encrypted credential storage with rotating
refresh locking; durable submit/reconcile/cancel jobs in the existing worker;
validated channel/media handling; unique local claims and persisted external IDs;
bounded retries with ambiguity handling; explicit provider-aware lifecycle/audit.
Fixtures must cover auth/429/timeout-after-acceptance/media failure/concurrent workers,
future times, cancel/reschedule, reconciliation and ownership. Live test above remains
mandatory. A fake adapter alone does not complete #29.

Until then, scheduling fails closed. The legacy CLI no longer queries content,
logs captions/reviews, or marks local rows scheduled. A test-only fake returns
provider=fake/status=simulated/confirmed=false and cannot represent real publication.
No credentials, new dependencies, schema changes or production changes in this PR.

### Partial implementation (adapter + credential encryption, unverified live)

`lib/integrations/buffer.ts` is a Buffer GraphQL adapter tested only against mocked
`fetch` (`scripts/test-buffer.ts`). It refuses incomplete drafts and past times before
any network call, retries only 429 (bounded, Retry-After capped at 60s), maps 401/403
to an auth error, media/GraphQL errors to a rejection, and treats timeout/5xx/unreadable
responses as `SchedulerAmbiguous` (never auto-resubmitted). Only a returned post id with
status `scheduled` yields `confirmed: true`. `lib/integrations/credentials.ts` provides
AES-256-GCM encryption with owner/business-bound AAD, keyed by `CREDENTIAL_ENCRYPTION_KEY`
(32 bytes base64). Neither is wired into `getSchedulerAdapter()`, which still fails closed.
Still open for #29: OAuth connect/select/disconnect, credential tables and refresh
locking, expiring media capability route, worker submit/reconcile/cancel jobs, persisted
external IDs/audit, and the owner-approved live test.

## Google Business Profile feasibility (#46) — checked 2026-10-15

Status: BLOCKED. No approved developer project, OAuth client/owner grant, verified
permitted live location, or confirmed review-reuse policy interpretation is
available in this session. No account configuration, API call, scraping or mock
connector is presented as completion. Issue #46 stays open.
P2 delivery also waits for the paid-pilot demand evidence specified by the issue.

### Current official references

- [Prerequisites](https://developers.google.com/my-business/content/prereqs): API
  access requires an approved developer project. The applicant must manage an
  active verified profile for at least 60 days, with its business website present.
  Request basic access through the official form with the project number using an
  owner/manager email; zero quota is not proof of access. Enable APIs after approval.
- [OAuth implementation](https://developers.google.com/my-business/content/implement-oauth):
  use owner consent with business.manage scope. This broad management scope is not
  a product authorization to edit profiles/reviews; our connector must remain read-only.
- [Review list](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list):
  verified location required; accounts/*/locations/* parent, at most 50 per page,
  pageToken/nextPageToken and updateTime-desc ordering. No documented changed-since
  cursor is assumed; stable review IDs and durable pagination checkpoints are needed.
- [Review data](https://developers.google.com/my-business/content/review-data):
  review ID, comment, rating, reviewer/create time support provenance. Do not invent
  a review permalink when the response does not provide one.
- [API policies](https://developers.google.com/my-business/content/policies):
  authorization, attribution, termination and content-storage obligations apply.
  Limited cached content has a temporary 30-day ceiling and restrictions on
  manipulation/aggregation. Third-party projects and access have additional rules.

The product currently retains reviews and turns them into edited social graphics.
We cannot assume that indefinite storage or off-platform reuse is permitted by
API access or business-owner consent alone. Obtain provider clarification for this
specific use before connecting/importing; these notes are not a legal determination.
Do not silently repurpose Places API rules, remove attribution, or scrape instead.

### Exact owner actions to unblock

1. Confirm paid-pilot demand justifies this P2 integration, as required by #46.
2. Establish the developer's eligible GBP/website and Google Cloud project, request
   basic API access, confirm approval/quota, and enable the official APIs. Do not
   require each pilot business to apply for a supplemental developer project.
3. Ask Google to clarify permitted quote extraction/social reuse, attribution,
   cache/retention and handling of deleted/edited reviews for this product. Record
   the response and agreed policy before implementing persistence/publication.
4. Register an OAuth consent/client and canonical redirect, complete any required
   verification, and provide credentials through runtime secret configuration.
   Choose an owner-authorized verified test location and consented data scope.
5. Provide external encryption-key management and retention/deletion requirements;
   never place refresh tokens or encryption keys in source, test fixtures or logs.

### Implementation gate after access/policy resolution

Reuse #42 ownership, #43 durable queue and #45 identity; do not build parallel auth,
queue or deduplication systems. Add owner connect/location select/disconnect,
authenticated encryption with owner/business-bound associated data, a rotating-key
plan, and revoked/expired consent handling. Persist stable source IDs/checkpoints;
upsert pages transactionally, use bounded rate-limit retries, and retain last sync,
counts and sanitized error codes. Incremental refresh must account for edits and
periodic full reconciliation for deletions; absent pages during an interrupted scan
are not proof of deletion. Never silently mutate approved/published artifacts.

Fixture coverage must include pagination/repeated sync/edits/429/expired tokens,
interrupted import, ownership and disconnect. Live acceptance requires a permitted
location import followed by a duplicate-free refresh, with sanitized evidence.
A retention/deletion migration must preserve draft references while respecting the
resolved policy; do not blindly delete reviews. No connector, schema change, live
acceptance, production configuration or provider permission is claimed by this PR.

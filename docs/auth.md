# Owner authentication and access (#42)

Uses maintained NextAuth 4.24.15 (Next 15/React 19 support) with Google OAuth and a
small Postgres adapter. Sources: https://next-auth.js.org/configuration/providers/google,
https://support.google.com/cloud/answer/15549945
and https://next-auth.js.org/tutorials/creating-a-database-adapter (checked 2026-10-15).
The adapter stores provider identity only, discards provider access/refresh tokens,
and hashes opaque session tokens. Eight-hour sessions are checked in Postgres on
EVERY protected request; sign-out deletes the server session, including copied tokens.

Owner setup (no accounts, credentials, or production config created by this PR):

1. Run `npm ci` and `npm run db:migrate` (migration 007 preserves unclaimed businesses).
2. In Google Cloud Console (Google Auth Platform), configure an External consent screen
   and create an OAuth "Web application" client. Add authorized redirect URI
   `NEXTAUTH_URL/api/auth/callback/google`. Request only `openid email profile`
   (the provider default, checked 2026-10-18): Google then needs no test-user list or
   unverified-app warning and does not expire sign-ins after 7 days in Testing.
   Adding any sensitive scope (e.g. Business Profile for #46) changes that.
3. Supply `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, a random `NEXTAUTH_SECRET` (32+
   bytes), and canonical `NEXTAUTH_URL`; use HTTPS in production. Never commit values.
   Login and sign-out return an actionable 503 if `NEXTAUTH_URL` or `NEXTAUTH_SECRET`
   is missing. Google sign-in additionally needs the client variables; email sign-in
   does not, and its session can still be signed out when Google is unset. Use
   Sign in / Sign out in nav.
4. Keep DATABASE_URL private to the app/worker/operator. Worker runs in a separate
   process with direct DB access; no bearer token bypass or public worker endpoint.
5. Verify an existing business belongs to the signed-in owner, locate their
   `auth_users.id` privately, then run `npm run business:claim -- BUSINESS_ID AUTH_USER_ID`.
   Claim accepts only an unclaimed business and an existing owner, never assigns all
   data to a registrant, and refuses reassignment. New businesses belong to the caller.

Every API route except NextAuth and the public sign-in routes in the email section below
is wrapped in the same owner guard. Business lists
are filtered server-side; guessed foreign business/draft/media IDs return 404. A
composite FK rejects new cross-business review references without deleting legacy
data; existing violations require operator reconciliation before validating that FK.
Cookie writes require an Origin matching NEXTAUTH_URL and reject cross-site fetches.
Bearer writes skip that check because a browser never attaches the token itself.
Uploads are stream-bounded to 1.5 MB before JSON/form parsing; CSV has tighter limits.

Mobile bearer sessions (#80): `POST /api/mobile/session` (added in #81) creates a
session with `kind = 'mobile'` and returns the raw token once; only its SHA-256 hash
is stored. A request may authenticate with either the NextAuth cookie or
`Authorization: Bearer <43-character token>`, never both. Mobile sessions last 30
days from the last request, capped at 90 days after creation, and
`POST /api/mobile/session/revoke` deletes the calling session. Malformed, expired,
revoked and oversized (over 43 characters) tokens return 401. The same ownership,
CSRF, upload-size and daily-limit rules apply to both session kinds.
Generation attempts use atomic shared per-owner/day UTC counters (default 25,
`OWNER_GENERATION_DAILY_LIMIT`). Preview has a separate 120/day limit. Attempts
consume budget even on provider failure; the UI receives 429 on exhaustion.

Media is private: authorized DB image_path lookup precedes filesystem access, and
responses use private/no-store. `/generated/*` is blocked, including old static files.
Default storage is `private-media/` outside public. Compose mounts the SAME named
volume at `/app/private-media`, retaining its contents. Host installs must move
existing generated files from public/generated into private-media (or an external
MEDIA_ROOT) before restarting. Migration 007 rewrites legacy DB URLs to /api/media/.
Do not expose the media directory through a reverse proxy. #29 supplies deliberate
provider-fetchable media; guessing draft IDs never grants publication access.

`TEST_DATABASE_URL=postgres://... npm test` runs disposable-schema A/B ownership,
media, limits, expiry/revocation and cross-origin tests. Anonymous tests inventory
all actual route exports. Older domain tests bypass the guard explicitly; boundary
tests do not. Production auth/CSRF/sign-out HTTP smoke uses synthetic sessions only;
real Google login still requires owner-provided OAuth configuration and a manual check.
No live OAuth acceptance is claimed without that configuration.

Google sign-in from the app (#81): the app sends `{ "idToken": "<Google ID token>" }` to
`POST /api/mobile/session`, a public route (the only one besides NextAuth). The server
verifies the RS256 signature against Google's published keys
(https://www.googleapis.com/oauth2/v3/certs, cached by `jose`), the issuer
(`accounts.google.com`), expiry, `email_verified`, and that the audience is
`GOOGLE_IOS_CLIENT_ID` or `GOOGLE_ANDROID_CLIENT_ID`. Anything else returns 401, including
every request while neither variable is set (fail closed). It then finds or creates the owner through
`auth_accounts` (`provider = google`, `provider_account_id = sub`), the same row the web
uses, so both see the same businesses. A web owner with the same verified email but no
Google account row is linked instead of duplicated; if that owner is already linked to a different
Google subject the sign-in is rejected (401). No Google token is stored or logged.
Failed attempts are limited to 10 per 15 minutes per client IP (`cf-connecting-ip`, else
`x-forwarded-for`, honoured only when `TRUST_PROXY_HEADERS=1`, which the pilot overlay sets because
only cloudflared can reach the app; otherwise all callers share one bucket), counted in process memory: it resets on restart and is per replica,
which suits the single-instance pilot. Move it to Postgres if the web tier is replicated.

Owner steps to create the app's OAuth clients (Google Cloud Console, Google Auth Platform
> Clients, in the same project as the web client; live sign-in waits on these, #78):

1. iOS: create an OAuth client of type "iOS" with the app's bundle ID (the Expo
   `ios.bundleIdentifier`). Put its client ID in `GOOGLE_IOS_CLIENT_ID`.
2. Android: create a client of type "Android" with the package name (Expo
   `android.package`) and the SHA-1 of the signing certificate. Use the EAS or Play App
   Signing SHA-1 for store builds and add a separate client for the debug keystore if
   you test with one. Put the client ID(s) in `GOOGLE_ANDROID_CLIENT_ID`.
3. Native Google Sign-In must produce an ID token whose audience is one of these client
   IDs. If the Android library requests the token for the web client ID, add that ID to
   `GOOGLE_ANDROID_CLIENT_ID`. Each variable accepts several comma-separated IDs.

## Linking several sign-in methods to one owner (#156)

One owner can have several methods in `auth_accounts`. Every sign-in path (web
NextAuth callback and the mobile exchange) calls the same policy in
`lib/authLinking.ts`:

- **Identity is the provider plus its stable subject id**, never the email by
  itself. A returning Google `sub` is the same owner even if Google now reports a
  different address.
- **Email can find an existing owner only when the provider guarantees the
  claim is verified.** Google is trusted today; a future verified email code
  joins that list. The address must match the owner row. An owner linked to a
  different subject for the same provider is rejected, which is the #116/#117
  reassigned-address rule.
- **A provider whose email is not guaranteed verified never links by email.**
  Microsoft's `email` claim is the current example: it creates a new owner with
  no login email (the provider address is kept only on the method row), or is
  linked from a signed-in session. Google sign-in with `email_verified` absent
  is rejected rather than linked.
- **A signed-in owner may attach a new method** because the session proves
  control of the existing owner. The method must not already belong to another
  owner, and one owner cannot have two subjects for the same provider. On the
  web this happens when an owner on `/account` presses "Link Google": the
  NextAuth callback sees the live session and links instead of switching
  accounts. `POST /api/account/methods` does the same for the phone with a
  verified Google ID token. Neither action requires the emails to match.
- **Unlinking is refused for the last method.** `DELETE /api/account/methods`
  with `{ "provider": "google" }` removes a method only while another remains,
  so an owner cannot lock themselves out. `GET /api/account/methods` is the
  owner-wide list the web and phone screens share; it returns the provider,
  the method's email (a display snapshot), and when it was added and last used.
  Existing rows have no historical timestamps and report `null`.
- **Concurrency:** the email upsert locks the existing owner row and the
  signed-in paths lock the owner row before attaching, so two subjects racing
  for one address, or two link requests racing for one provider, leave exactly
  one method. An owner row created by a losing request is removed if it has no
  methods or other data.

Migration 017 adds `auth_accounts.email`, `created_at` and `last_used_at`; it is
additive and does not rewrite existing identities. Existing Google owners keep
their `auth_users` row, email and data, and are only dated from the migration
onward.

### Account recovery

The verified email on the owner is the recovery path: once the email one-time
code lands (#157), an owner who loses their only method can prove control of
that address and attach a new one. Until then there is no in-app recovery.
There is deliberately **no support override in code**: an operator cannot
impersonate an owner or attach a method through a hidden route. Merging two
owners after an address was reassigned remains an operator task, not something
the sign-in code does automatically.

`scripts/test-auth-linking.ts` covers link, reject, unlink-last and the races;
`scripts/test-mobile-google.ts` keeps the existing Google exchange behaviour.

Email one-time code (#157): the second way in, for owners whose organization does not
use Google. No password is stored and the only requirement is that the owner can read
the mailbox.

- `POST /api/auth/email/request` (`{email}`, public) normalises the address (trim,
  lowercase) and answers `200` with the same message whether or not an owner exists. A
  malformed address is a `400`; missing configuration is a `503`. A per-address limit
  (5 per 15 minutes) and a per-IP limit (20 per 15 minutes) drop excess requests without
  telling the caller, so throttling cannot be used to probe addresses. The email
  transport also caps 5 messages per recipient and 100 per sender per hour in each
  process, so rotating addresses cannot turn the server into an open relay.
- The code is 6 digits from `crypto.randomInt`, lives 10 minutes, is single use, and a
  newer request supersedes the earlier one. Only an HMAC-SHA256 keyed with
  `NEXTAUTH_SECRET` is stored in `email_sign_in_codes`; the real transport never logs
  the code. Five wrong guesses consume the code. Verify failures are limited to 10 per
  15 minutes per client IP, counted in process memory like the Google limiter.
- `POST /api/auth/email/verify` (`{email, code}`, public, same-origin only) sets the same
  hashed eight-hour Postgres session cookie as Google. `POST /api/mobile/session/email`
  is the phone equivalent and returns a normal bearer session. A wrong code is a `400`
  on both, never a `401`, because the app reads `401` as "the session ended" and would
  clear its token over a typo.
- Linking policy (#156): identity stays the provider plus its stable subject id. The
  email method uses the normalised address as its subject. A verified code proves
  control of that mailbox, so an owner already known by the same address keeps one
  owner and gains an email method; a Google owner and their businesses are untouched.
  A different address always gets its own owner and never attaches to someone else.
  Because a code proves the mailbox, a reassigned address can still recover the owner
  it was registered to: that is inherent in passwordless email and documented rather
  than hidden.
- Email transport (#155): `lib/email.ts` has one interface. In development and tests
  the fake transport keeps messages in an in-memory outbox (also shown at
  `/dev/outbox`), logs one `email_outbox` line including the code and never sends.
  Production always uses Resend over HTTPS and fails closed unless `RESEND_API_KEY`
  and `EMAIL_FROM` are set; `EMAIL_TRANSPORT=fake` is refused in production.
- Owner steps before live email sign-in: create the Resend account, verify the sending
  domain, publish SPF, DKIM and DMARC records, set `EMAIL_FROM` to an address on that
  domain (for example `PraiseLoop <signin@example.com>`), and put the API key in the
  runtime environment only. Real delivery was not run in the #157 PR because no account
  or domain exists yet.
- Development: the fake outbox is at `http://localhost:3000/dev/outbox` (development
  process and fake transport only); the seeder also creates an email-only owner
  (`demo-email@praiseloop.invalid`) so the flow can be walked without a mailbox.

Push tokens (#88): `POST /api/mobile/push-tokens` (`{token, platform}`) registers or refreshes
the signed-in owner's Expo push token and `DELETE` (`{token}`) removes it on sign-out; a
token can only be removed by its owner. When a business's weekly generation period has
finished with drafts awaiting approval, the worker sends each of that owner's devices one
notification (count, business name and a `praiseloop://queue?businessId=` deep link only),
recorded in `push_deliveries` so restarts never resend. Tokens Expo reports as
`DeviceNotRegistered`, in a ticket or a receipt, are deleted. Sends are retried up to three times.

Demo sign-in (development only): `POST /api/mobile/session/dev` mints a normal
bearer session for the fixed `dev-owner` row, with no Google token. It exists only
when `MOBILE_DEV_AUTH=1` **and** the process is not a production build; otherwise it
returns 404 exactly like an unknown route. `npm run dev:seed` creates the owners and
synthetic drafts; a body of `{"owner":"free"}` signs in as the seeded Free owner
instead of the default Pro one. The demo owner has the same ownership checks, version conflicts and
audit events as a real owner, so the flow is realistic; never enable the flag on a
shared server. Production sign-in remains the Google exchange above.

Profile (#149): `GET /api/profile` returns the signed-in owner's `name` (nullable),
`email`, `nameSource` (`provider`, `owner`, or null when there is no name), `provider`
(the owner's linked sign-in method, Google first when there are several, or null
when none is linked) and `initials` for an avatar. It
never returns provider tokens and keeps `Cache-Control: private, no-store`.
`PATCH /api/profile` accepts only `{ "name": "..." }`: trimmed, 1–80 characters, no
control characters, and 400 otherwise. The email is read-only because it is the
verified Google identity account linking depends on. Migration 016 adds
`auth_users.name_source`; a name the owner sets is never overwritten by a later
provider sign-in on the web or the phone, while an empty name may still be filled
from Google. Both cookie and `Authorization: Bearer` sessions use the same guard,
so a request only ever reads or writes the session's own owner. `scripts/test-profile.ts`
covers provider, missing, edited and sign-in-after-edit names.

When the session ends (#137): the server side above is unchanged; every protected route
answers 401. The clients now act on it.

- Web: pages call our own API through `apiFetch` (`app/apiFetch.ts`), never bare `fetch`. On a
  401 from a protected `/api/` route it stops the page's current action (the call never
  resolves, so no "something went wrong" message flashes), clears the dead cookie with
  `signOut({ redirect: false })`, then loads `/?reason=session-ended&callbackUrl=<current page>`.
  The landing page shows "Your session ended. Sign in again." and its Google button returns to
  that page (or goes there straight away if the owner is signed in again). 403, 404, 409, 429
  and 5xx keep their own messages and never sign the owner out. Loop guards: a 401 on the
  landing page, from `/api/auth/*` or from `/api/mobile/*` is ignored, several simultaneous
  401s (polling) sign out once, and a failing or slow `signOut` never blocks the redirect. The
  `callbackUrl` must be a same-site relative path. The decision logic is
  `lib/sessionExpiry.ts`. When a tab regains focus (at most every 30 seconds) the shell makes
  one `/api/businesses` call, so a tab left open overnight redirects without the owner acting
  first. New pages must use `apiFetch` for `/api/` calls.
- Phone: `api/client.ts` maps 401 to an `ApiError` of kind `signedOut`; every screen passes
  its errors to `useSession().handleError`, which deletes the keychain token and returns to
  sign-in, where a "Your session ended" banner explains why (not shown after a deliberate
  sign-out).
- Tests: `scripts/test-session-expiry.ts` (decision logic, the wrapper, and an expired cookie
  session and revoked mobile token against the real drafts and import routes) and
  `mobile/__tests__/sessionExpiry.test.ts`. No browser test was added, so the redirect itself
  is covered only by the wrapper tests with a fake `navigate`.

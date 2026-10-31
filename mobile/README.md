# PraiseLoop mobile

The owner's iOS/Android app: a thin Expo client over the existing PraiseLoop API.
The web app, worker and database stay where they are; this package is independent
of the root `package.json` and is never part of the web Docker build.

## Requirements

- Node 22 and npm 10 (the root `.nvmrc` works)
- Expo Go for quick checks, or a development build for native modules
- A running PraiseLoop server (`docker compose up` from the repo root)
- Google sign-in needs a development or store build and the iOS/Android OAuth
  clients from #78; Expo Go does not contain the native Google module, so it
  offers demo and email-code sign-in instead.

## Run it

With the dev stack (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up`
from the repo root) the `mobile` service already runs the Expo server and prints the QR
code; see [development](../docs/development.md#phone-app-in-the-dev-stack). To run it by
hand instead:

```bash
cd mobile
npm ci
npm start
```

Then scan the QR code with Expo Go, or press `a`/`i` for an emulator. On a physical
phone, `localhost` points at the phone, not your computer: set
`EXPO_PUBLIC_API_BASE_URL` to your machine's LAN address before starting, e.g.

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:3000 npm start
```

`APP_VARIANT=development|preview|production` selects the app name and the default
API URL (development falls back to `http://localhost:3000`). Preview and production
builds must set `EXPO_PUBLIC_API_BASE_URL`; there is no hard-coded secret, and the
app only talks to our API.

Native Google sign-in reads these public values through `app.config.ts`:

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Web OAuth client ID, the same value as the server's `GOOGLE_CLIENT_ID`. Empty hides **Continue with Google**. |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | iOS OAuth client ID from #78. |
| `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` | Reversed iOS client ID (`com.googleusercontent.apps.…`). Only needed for `expo prebuild`; the config plugin is added only when it is set. |

The server accepts ID tokens for `GOOGLE_IOS_CLIENT_ID` and
`GOOGLE_ANDROID_CLIENT_ID` (`docs/auth.md`). Android's native sign-in requests
the token for the web client ID, so include that ID in the server's
`GOOGLE_ANDROID_CLIENT_ID` as documented there.

The app has six screens: a launch gate driven by `GET /api/mobile/config`, sign-in,
an "update required" screen, the weekly queue (`#86`), a draft detail with the
share-sheet flow (`#87`) and the profile screen (`#151`), reached from the initials
avatar in the queue header. The profile shows the owner's name and email (the name
is editable, the email is not), the plan and this week's usage, the app version and
API server, and **Sign out**. Sign-in is **Continue with Google** in a
development or store build (#85/#81); the same screen always offers an
email-code option, and a development server with `MOBILE_DEV_AUTH=1` also offers
a demo owner, which is the fastest way to walk the whole flow with synthetic
data. Expo Go hides Google because the native module is absent, so demo and
email-code sign-in are the paths there.

```bash
# repo root
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
docker compose exec web npm run dev:seed

# mobile/
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:3000 npm start
```

Then tap **Sign in as demo owner**. The seed creates two businesses and five
rendered drafts; see [development](../docs/development.md#demo-flow-with-synthetic-data).
The token lives in the platform keychain (`expo-secure-store`); the share sheet
receives a cached PNG and the caption is copied to the clipboard for pasting into
Instagram. `shared` is owner-reported, never inferred. Queue thumbnails and the
draft image use the same authenticated download into the app cache, because the
core React Native `Image` does not reliably send custom headers in Expo Go.

## Checks

```bash
npm run lint
npm run typecheck
npm test
```

CI runs the same commands in the `mobile` job. Tests cover the API client's error
mapping (401/409/429/network/timeout), the version gate, native Google sign-in
availability/cancellation, the Google token exchange (success, invalid response,
401), the no-business screen's onboarding link and visibility, the keychain
session store, draft/version API shapes, queue list states and generation
progress, the draft image cache (bearer header, shared downloads, retry, eviction
and the 401 path), the profile helpers and API wrapper (name rule, initials,
400/401), and every share-flow branch (unavailable share sheet, download/copy/
share failures, cancelled share, version conflict, expired session).

## Builds

Local builds and EAS Build both work. Expo Router is the router; Jest with the
`jest-expo` preset runs the tests. No native `ios/` or `android/` folders are
committed. Google sign-in is compiled in at prebuild through the config plugin,
so set `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` and rebuild after changing OAuth
clients; changing it does not affect `expo start` or Expo Go. The bundle ID /
package name is `ca.visda.praiseloop` as a placeholder:
the owner must confirm it before store setup (#91), because it cannot change after
release.

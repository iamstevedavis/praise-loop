# PraiseLoop mobile

The owner's iOS/Android app: a thin Expo client over the existing PraiseLoop API.
The web app, worker and database stay where they are; this package is independent
of the root `package.json` and is never part of the web Docker build.

## Requirements

- Node 22 and npm 10 (the root `.nvmrc` works)
- Expo Go for quick checks, or a development build for native modules
- A running PraiseLoop server (`docker compose up` from the repo root)

## Run it

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

The app has a launch gate driven by `GET /api/mobile/config` (minimum version and
the update screen) and a sign-in screen (`#85`). A session token lives in the
platform keychain (`expo-secure-store`), and the API client sends it as a bearer
token; a 401 clears the keychain and returns to sign-in. The weekly queue (`#86`)
and the share-sheet flow (`#87`) follow.

Google sign-in is the production path (`#81`). On a development server started with
`MOBILE_DEV_AUTH=1`, the app also offers **Sign in as demo owner**, which mints a
session for a fixed synthetic owner without Google:

```bash
# repo root: set MOBILE_DEV_AUTH=1 in .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

The route answers 404 in production builds, so the flag can never mint sessions on
a shared server. Until there is seeded data, sign-in lands on a confirmation screen.

## Checks

```bash
npm run lint
npm run typecheck
npm test
```

CI runs the same commands in the `mobile` job. Tests cover the API client's error
mapping (401/409/429/network/timeout), the version gate, the demo-sign-in flag and
the keychain session store.

## Builds

Local builds and EAS Build both work. Expo Router is the router; Jest with the
`jest-expo` preset runs the tests. No native `ios/` or `android/` folders are
committed. The bundle ID / package name is `ca.visda.praiseloop` as a placeholder:
the owner must confirm it before store setup (#91), because it cannot change after
release.

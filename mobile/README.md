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

The current screens are a placeholder home and an "update required" screen driven
by `GET /api/mobile/config`. Sign-in (#85), the approval queue (#86) and the share
sheet (#87) follow.

## Checks

```bash
npm run lint
npm run typecheck
npm test
```

CI runs the same commands in the `mobile` job. Tests cover the API client's error
mapping (401/409/429/network/timeout) and the version gate.

## Builds

Local builds and EAS Build both work. Expo Router is the router; Jest with the
`jest-expo` preset runs the tests. No native `ios/` or `android/` folders are
committed. The bundle ID / package name is `ca.visda.praiseloop` as a placeholder:
the owner must confirm it before store setup (#91), because it cannot change after
release.

# HOLD — items waiting on the owner

Things I can't decide or obtain on my own. Each item lists what I did instead so work keeps moving.
When you clear an item, fill in the **Resolution** line. Nothing here blocks development; every item has a working fallback.

Status key: 🟥 blocks public launch · 🟨 needed before launch, fallback in place · 🟩 nice to have

---

## H-01 🟥 Production secrets and accounts
**Need:** a Gemini API key for production, plus production Postgres hosting.
**Why I can't:** these require your billing accounts.
**Doing instead:** everything reads from env vars (`artifacts/api-server/.env.example`). All AI paths (messages, quests, debriefs, taunts, raid dispatch rewrite, free-form parsing, voice transcription) are tested with an injected fake model; the first real-key run should exercise them once, voice especially (m4a is sent as audio/mp4). Local dev uses Docker Postgres (`docker-compose.yml`). With no key, AI falls back to deterministic templated SYSTEM messages, so the app still works: the end-to-end smoke (`scripts/smoke.ts`, run in CI's `docker-smoke` job) passes register → onboarding → log → quests → debrief → export → delete with no key. Outage handling: [docs/RUNBOOK.md](RUNBOOK.md#ai-outage-template-mode).
**Resolution:**

## H-02 🟥 Hosting provider
**Need:** where the API and worker run (Fly.io, Render, Railway, AWS, GCP…).
**Doing instead:** a provider-neutral Docker image (`artifacts/api-server/Dockerfile`, `ROLE=api|worker|migrate`), `docker-compose.prod.yml` (postgres, migrate, two APIs behind nginx, worker; example env in `.env.prod.example`), and a `render.yaml` Blueprint (web API, worker, managed Postgres, pre-deploy migrate; secrets are `sync: false`) that has not been run through the Render CLI yet (`render blueprints validate render.yaml` before first use). CI's `docker-smoke` job builds the image, boots the prod compose stack and smoke-tests it through nginx on every push. Any container host works. Setup: [docs/DEPLOYMENT.md](DEPLOYMENT.md); operations: [docs/RUNBOOK.md](RUNBOOK.md).
**Resolution:**

## H-03 🟥 App store accounts and app identity
**Need:** an Apple Developer account, a Google Play Console account, the final bundle ID and package name, and an Expo/EAS account.
**Doing instead:** placeholder IDs `com.systemself.app` (override with the `APP_ID` env var) in `artifacts/system-self/app.config.ts` on top of the static `app.json`; `eas.json` has `development`, `preview` and `production` profiles plus a `submit.production` stub with placeholder Apple IDs. `EAS_PROJECT_ID` and `GOOGLE_SERVICES_JSON` are injected from env at build time, never committed. Expo Go keeps working for development with no env set, started with `expo start --go` (`expo-dev-client` is installed for the `development` EAS profile, so without `--go` the dev server targets a dev client instead). Public distribution has to go through EAS store builds; Expo Go is not a public distribution channel. Full store checklist: [docs/RELEASE.md](RELEASE.md).
**Resolution:**

## H-04 🟨 Payments (RevenueCat + store products)
**Need:** a RevenueCat project, API keys, and store products for PRO (₹499/month, ₹3,999/year per the PRD).
**Doing instead:** server-side entitlements (`entitlements` table), a RevenueCat webhook endpoint that verifies a shared secret, and a paywall screen. Without keys the purchase button shows "unavailable", and an admin endpoint can grant PRO for testing ([docs/RUNBOOK.md](RUNBOOK.md#grant-pro-for-support)). The webhook is tested against all 20 of RevenueCat's published sample events (`artifacts/api-server/src/routes/fixtures/revenuecat-sample-events.json`): every one is accepted, a sample purchase grants PRO and a sample expiration revokes it. Still untested: a real sandbox purchase on a store build.
**Transfers:** `TRANSFER` webhook events (a restore moving a purchase to another account) are only applied when `REVENUECAT_API_KEY` (the secret v1 REST key) is set; without it they are logged and change nothing.
**Resolution:**

## H-05 🟨 Email provider (verification and password reset)
**Need:** a transactional email provider and sending domain (e.g. Resend, Postmark, SES).
**Doing instead:** a `Mailer` interface with a Resend transport (used when `RESEND_API_KEY` is set) and a log transport otherwise (`MAILER=log`). With the log transport, codes appear in the server log only in development/test; in production they are redacted (`******`), so nobody can verify an email or reset a password until a provider is set. Production needs this.
**Resolution:**

## H-06 🟨 Legal text
**Need:** reviewed Privacy Policy and Terms of Service, and a decision on the age floor (the PRD targets 16–32; India's DPDP Act and COPPA/GDPR treat minors specially).
**Doing instead:** draft templates in `docs/legal/`, shown in-app, clearly marked DRAFT. Sign-up requires age ≥ 16 (my call) and acceptance of the terms. Open-source notices: the API image ships a full `THIRD_PARTY_NOTICES.txt`; the app shows a compact name/version/licence list ("Open-source licences") pointing at `docs/legal/THIRD_PARTY_NOTICES-app.txt` — counsel should confirm whether store builds must carry the full licence texts in-app.
**Resolution:**

## H-07 🟩 Social sign-in (Apple / Google)
**Need:** Apple Services ID and keys, and Google OAuth client IDs.
**Doing instead:** email + password only. On iOS, Apple only requires Sign in with Apple when other third-party logins are offered, so this is allowed for now.
**Resolution:**

## H-08 🟩 Product analytics (PostHog)
**Need:** a PostHog project key, if you want PostHog.
**Doing instead:** first-party event logging into Postgres (`analytics_events`) plus a metrics endpoint for the PRD §25 metrics.
**Resolution:**

## H-09 🟩 Crisis resource links
**Need:** the region-specific helplines you want shown (the PRD asks for a crisis resource link in settings).
**Doing instead:** a Settings → "Need support?" screen listing international resources plus India's Tele-MANAS (14416). Easy to edit in `constants/support.ts`.
**Resolution:**

## H-10 🟨 Hands-on device QA in Expo Go
**Need:** someone to open the app in Expo Go on a real phone (iOS and Android) and walk through sign-up → onboarding → logging → quests → gym → settings, reporting anything that looks or behaves wrong.
**Why I can't:** I can't operate a phone, and the browser automation tools failed to connect in this session.
**Done so far (2026-10-20):** a full walk-through in Expo Go on an Android 17 emulator (Medium_Phone): sign-up → onboarding (ratings, objective, identity, life context, schedule) → home → free-form log (two entries confirmed, scores and streaks updated) → quest complete and refuse → stats and history → settings → legal → data export (share sheet) → account deletion (back to sign-in). Zero server errors. Six defects it found are fixed (keyboard covering sheets, prompt text shown as copy, invisible single-day history, unlabeled tabs, raw identity label, UTC export date). Still needed: iOS in Expo Go and a store build on real hardware.
**Doing instead:** every screen is verified by typecheck, a full Android bundle export (`expo export`), unit tests, and node smoke scripts that drive the same API calls the screens make against a real local server. Run it yourself with: `docker compose up -d postgres`, migrate, `pnpm --filter @workspace/api-server dev` (and `dev:worker`), then, with `EXPO_PUBLIC_API_URL=http://<LAN IP>:3001`, `pnpm exec expo start --go --lan` in `artifacts/system-self` and scan the QR code (`--go` is required: `expo-dev-client` is installed for EAS development builds, and without the flag the dev server serves a dev-client bundle that Expo Go cannot open). Step by step: [README.md](../README.md#dev-quick-start).
**Resolution:**

## H-11 🟩 Crash/error reporting (Sentry or similar)
**Need:** an error-reporting account (Sentry, Bugsnag, Rollbar…) and its DSN for the API, the worker and the app.
**Why I can't:** it needs an account in your name, and the DSN is a per-project credential.
**Doing instead:** structured error logs plus metrics. The API and worker log every unhandled error as JSON through pino (request id, route, `err` with stack; secrets redacted), the 5xx rate is on `/metrics` (`http_request_duration_seconds_count{status=~"5.."}`), and a stalled worker shows up as a stale `worker_last_tick_timestamp_seconds` and an unhealthy container ([docs/RUNBOOK.md](RUNBOOK.md#stuck-worker-or-lease)). App crashes are only visible in the store consoles (App Store Connect, Play Console vitals) until a reporter is wired in.
**Resolution:**

## H-12 🟨 Publishing the code
**Need:** your go-ahead to push `main` to GitHub (or open a PR from `feat/production-build`).
**Why I can't:** pushing publishes the code to a shared remote; that's your call.
**Doing instead:** all work is merged into the local `main` (fast-forward from `feat/production-build`; the full server suite passed 701/701 on that exact tree, plus engine 154, app 364, db 29). Nothing has been pushed. `git push origin main` publishes it, and CI (`.github/workflows/ci.yml`) then runs every check including the real-image docker smoke.
**Resolution:**

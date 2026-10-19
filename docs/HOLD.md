# HOLD — items waiting on the owner

Things I can't decide or obtain on my own. Each item lists what I did instead so work keeps moving.
When you clear an item, fill in the **Resolution** line. Nothing here blocks development; every item has a working fallback.

Status key: 🟥 blocks public launch · 🟨 needed before launch, fallback in place · 🟩 nice to have

---

## H-01 🟥 Production secrets and accounts
**Need:** a Gemini API key for production, plus production Postgres hosting.
**Why I can't:** these require your billing accounts.
**Doing instead:** everything reads from env vars (`artifacts/api-server/.env.example`). All AI paths (messages, quests, debriefs, taunts, raid dispatch rewrite, free-form parsing, voice transcription) are tested with an injected fake model; the first real-key run should exercise them once, voice especially (m4a is sent as audio/mp4). Local dev uses Docker Postgres (`docker-compose.yml`). With no key, AI falls back to deterministic templated SYSTEM messages, so the app still works.
**Resolution:**

## H-02 🟥 Hosting provider
**Need:** where the API and worker run (Fly.io, Render, Railway, AWS, GCP…).
**Doing instead:** a provider-neutral Docker image (`artifacts/api-server/Dockerfile`, `ROLE=api|worker|migrate`), `docker-compose.prod.yml` (postgres, migrate, two APIs behind nginx, worker; example env in `.env.prod.example`), and a ready `render.yaml` Blueprint (web API, worker, managed Postgres, pre-deploy migrate; secrets are `sync: false`). Any container host works.
**Resolution:**

## H-03 🟥 App store accounts and app identity
**Need:** an Apple Developer account, a Google Play Console account, the final bundle ID and package name, and an Expo/EAS account.
**Doing instead:** placeholder IDs `com.systemself.app` in `app.json`, and EAS build profiles (`eas.json`) ready to run once logged in. Expo Go keeps working for development. Public distribution has to go through EAS store builds; Expo Go is not a public distribution channel.
**Resolution:**

## H-04 🟨 Payments (RevenueCat + store products)
**Need:** a RevenueCat project, API keys, and store products for PRO (₹499/month, ₹3,999/year per the PRD).
**Doing instead:** server-side entitlements (`entitlements` table), a RevenueCat webhook endpoint that verifies a shared secret, and a paywall screen. Without keys the purchase button shows "unavailable", and an admin endpoint can grant PRO for testing.
**Transfers:** `TRANSFER` webhook events (a restore moving a purchase to another account) are only applied when `REVENUECAT_API_KEY` (the secret v1 REST key) is set; without it they are logged and change nothing.
**Resolution:**

## H-05 🟨 Email provider (verification and password reset)
**Need:** a transactional email provider and sending domain (e.g. Resend, Postmark, SES).
**Doing instead:** a `Mailer` interface with a Resend transport (used when `RESEND_API_KEY` is set) and a log transport otherwise. Without email, password-reset codes are only written to server logs, so production needs this.
**Resolution:**

## H-06 🟨 Legal text
**Need:** reviewed Privacy Policy and Terms of Service, and a decision on the age floor (the PRD targets 16–32; India's DPDP Act and COPPA/GDPR treat minors specially).
**Doing instead:** draft templates in `docs/legal/`, shown in-app, clearly marked DRAFT. Sign-up requires age ≥ 16 (my call) and acceptance of the terms.
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
**Doing instead:** every screen is verified by typecheck, a full Android bundle export (`expo export`), unit tests, and node smoke scripts that drive the same API calls the screens make against a real local server. Run it yourself with: `docker compose up -d postgres`, migrate, `pnpm --filter @workspace/api-server dev`, then `pnpm exec expo start --lan` in `artifacts/system-self` and scan the QR code.
**Resolution:**

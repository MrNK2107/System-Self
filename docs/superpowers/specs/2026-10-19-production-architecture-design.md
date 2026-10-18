# Production Architecture & Build Roadmap — Design

**Date:** 2026-10-19
**Owner directive:** build SYSTEM // SELF as a complete product, per the PRD (`attached_assets/SYSTEM_SELF_PRD_*.md`) and the adherence design (`docs/superpowers/specs/2026-10-19-adherence-features-design.md`), ready for public use and able to scale. The owner delegated every decision. Items that truly need the owner are in `docs/HOLD.md`.
Everything below marked **(my call)** was decided without the owner.

---

## 1. Where we start

- Expo SDK 54 app (`artifacts/system-self`). **All game state is local** (AsyncStorage) and computed on the device: scores, rank, quests, shadow, rivals (simulated), achievements.
- Express API (`artifacts/api-server`) that generates AI text and stores AI output and quest-completion events by `username`. "Auth" is static env tokens.
- Nothing is multi-user. A public product needs accounts, server-side state, and real social features.

## 2. Target architecture (my call)

```
Expo app (Expo Go in dev / EAS builds in prod)
  └─ React Query cache + persisted offline queue ──HTTPS/JWT──▶ API (Express, stateless, N instances)
                                                                 │
                                                  Postgres ◀─────┤
                                                                 │
                                                  Worker (same image, `worker` command, N instances)
                                                    ├─ daily rollover per user timezone (decay, quest expiry, shadow, rank)
                                                    ├─ weekly jobs (raids, rival re-matching, challenges)
                                                    └─ push dispatch (Expo Push API)
                                                  Gemini API (via retry/fallback wrapper)
```

1. **The server is the authority** for scores, rank, quests, shadow, rivals and clans. The PRD requires the hidden score to be server-only (§23) and the social features to be trustworthy.
2. **Pure engine package `lib/engine`.** Scoring, rank, streak, decay, shadow and quest rules are pure TypeScript functions with no I/O and full unit tests. The server uses them; the client may import them only for previews (e.g. the streak multiplier preview).
3. **Ranking is ported unchanged.** The owner said the rankings must not be affected. The engine ports the *current app's* hidden score formula, multiplier and rank thresholds exactly as they are in `AppContext.tsx`. The PRD's differences (SOCIAL weight, 14-day promotion / 7-day demotion windows) are **not applied** unless the current code already has them. New domains (SOCIAL, CUSTOM) are tracked and scored but **excluded from the hidden score**.
4. **No pay-to-win.** The PRD's "S-rank requires premium" conflicts with its own "No pay-to-win" and with the owner's ranking rule, so rank is never gated by payment. PRO gives depth and tools only.
5. **Offline-first client.** Logs and quest actions go into a persisted queue with idempotency keys and replay when online. Reads come from the React Query cache, persisted to AsyncStorage.
6. **Jobs scale horizontally.** The worker claims due users with `SELECT … FOR UPDATE SKIP LOCKED` on `user_day_state.next_rollover_at`, so any number of worker instances can run safely. There's no Redis requirement.
7. **AI cost control.** Briefings and debriefs are generated lazily (on first open after the user's scheduled time), cached in `system_messages`, and limited to one per type per local day. Without `GEMINI_API_KEY`, deterministic template messages in the SYSTEM voice are used.
8. **AI SDK.** Move from the deprecated `@google/generative-ai` to `@google/genai`. Default models are `gemini-2.5-flash` with fallback `gemini-2.5-flash-lite`; the 1.5 models in the current defaults are retired.

## 3. Platform decisions (my call)

| Concern | Decision |
|---|---|
| Accounts | Email + password. Argon2id hashing (`@node-rs/argon2`). JWT access token (15 min, `jose`) + rotating refresh tokens (30 days), stored hashed, with reuse detection that revokes the whole token family. |
| Token storage (app) | `expo-secure-store` (works in Expo Go). |
| Password reset / verification | 6-digit email code through the `Mailer` interface (HOLD H-05). Verification is not required to use the app; it is required for clan creation and purchases. |
| Admin | `role` column (`user` / `admin`); admin routes need `role=admin`. Static env tokens are removed. |
| Migrations | `drizzle-kit generate` → SQL files in `lib/db/migrations`, applied by `pnpm --filter @workspace/db migrate` (and on container start). `push` is dev-only. |
| Tests | API integration tests against real Postgres (`TEST_DATABASE_URL`; Docker locally, a service container in CI). Engine unit tests have no DB. Runner: `node --test` via `tsx` (already used). |
| Notifications | `expo-notifications`. Daily briefing/debrief reminders are **local scheduled** notifications (work in Expo Go). Event pushes (rank change, rival passed, shadow, raid result, quest 24h) go through the Expo Push API from the worker. The server enforces the PRD cap of 3 system notifications per user per local day. |
| Payments | RevenueCat (HOLD H-04). Server `entitlements` table is the source of truth, fed by a webhook. |
| Voice logging | `expo-audio` recording → `POST /logs/voice` → Gemini transcription + parsing (PRO). |
| Free-form logs | Gemini parses text into structured domain logs; stored with the raw text. |
| Analytics | First-party `analytics_events` table + `/admin/metrics` for the PRD §25 metrics (HOLD H-08). |
| Observability | pino JSON logs with request IDs, `prom-client` `/metrics` (latency, status codes, AI attempts/fallbacks, job durations), and `/healthz` + `/readyz` (readyz checks the DB). |
| Rate limiting | `express-rate-limit`, per instance, plus a stricter limiter on auth routes (10 / 15 min / IP). This is acceptable at launch scale; swap in a shared store if abuse appears. |
| Deploy | Docker image (API + worker), `docker-compose.yml` for dev, `docker-compose.prod.yml` as a reference. Hosting provider is HOLD H-02. |
| Mobile release | `eas.json` profiles: development / preview / production (HOLD H-03). |
| Out of scope (the PRD itself marks these v2) | Web companion, bank integration, Apple Health / Google Fit, Todoist / Notion, cosmetic clan insignia purchases. |

## 4. Product scope by phase

Each phase gets its own implementation plan in `docs/superpowers/plans/` and ends with working, tested software.

| Phase | Plan file | Delivers |
|---|---|---|
| 0 | (done directly) | Install works on Windows/macOS, typecheck green, CI on pnpm 11 |
| 1 | `…-p1-platform-accounts.md` | Migrations, docker-compose Postgres, test harness, users/auth/refresh/reset/delete, user-scoped existing endpoints, `@google/genai` |
| 2 | `…-p2-server-engine.md` | `lib/engine` (ported rules), tables for profile/scores/logs/quests/shadow/achievements/rank history, onboarding + log + quest + dashboard endpoints, daily rollover worker |
| 3 | `…-p3-mobile-on-server.md` | Auth screens, API client with tokens, AppContext backed by the server, offline queue, removal of local scoring |
| 4 | `…-p4-adherence.md` | Adherence design features 1.1–4.3 (Duo deferred to phase 5) |
| 5 | `…-p5-social.md` | Real rival matching with ghost-rival fallback for cold start, identity control, following, clans (8–30, dead weight), weekly raids, named challenges, Shame Mode, Party of Two |
| 6 | `…-p6-domains-logging.md` | Finance module (income, budgets, savings rate, goals, net worth), SOCIAL domain, CUSTOM domains, free-form + voice logging, retroactive logging rules |
| 7 | `…-p7-monetization-engagement.md` | Entitlements + paywall + RevenueCat, PRO gating per PRD §22 (minus rank gating), notifications, adaptive UI states, Rank Freeze, full history/analytics |
| 8 | `…-p8-production.md` | Docker / deploy, metrics, EAS, legal + support screens, data export, account deletion UX, security review, load test, runbooks |

## 5. Cold start (my call)

At launch there aren't enough users for ±5-point rival matching. The matcher uses real users when it finds at least one match within ±10 points of hidden score in the same rank tier, and fills the remaining slots with **ghost rivals**: server-simulated profiles that drift like the current client simulation, clearly codenamed and never shown as real people in any field. Ghosts are replaced by real matches at the 30-day rematch or on rank change.

## 6. Data the client keeps

Only cache, the offline queue, auth tokens (SecureStore), and per-device preferences (e.g. notification schedule IDs). No scores are computed authoritatively on the device.

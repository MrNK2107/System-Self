# System-Self Architecture & Technical Documentation

## 1. Purpose
System-Self is a mobile-first life-operations app with an AI-backed "SYSTEM" persona that:
- Generates tactical messages and quest plans.
- Tracks user execution outcomes (complete/refused/failed).
- Adapts future quest generation based on historical completion signals.
- Produces weekly recap metrics and AI debriefs.

This document describes architecture, modules, data model, API surface, operational behavior, and deployment requirements.

## 2. High-Level Architecture
The project is a pnpm workspace monorepo with three primary runtime layers:

1. Mobile client (`artifacts/system-self`)
- Expo / React Native app.
- Local state and persistence via AsyncStorage.
- Calls backend API for AI generation and analytics ingest.

2. API server (`artifacts/api-server`)
- Express + TypeScript.
- Validation, security middleware, rate limiting, AI orchestration.
- Persistence and analytics queries through Drizzle ORM.

3. Database package (`lib/db`)
- Shared Drizzle schema and DB client.
- PostgreSQL as persistence engine.

Supporting libraries:
- API schema/client packages (`lib/api-zod`, `lib/api-client-react`) for typed contracts.
- AI generation via Gemini API (with retry + fallback model strategy).

## 3. Monorepo Structure
Key paths:
- `artifacts/system-self` - mobile app
- `artifacts/api-server` - backend API
- `lib/db` - DB schema and connection
- `lib/api-spec/openapi.yaml` - OpenAPI spec
- `docs/` - operational and roadmap docs

## 4. Backend Architecture
### 4.1 API Server Entry & Middleware
Main entry:
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/app.ts`

Middleware stack:
- `pino-http` for structured request logging.
- `helmet` for baseline security headers.
- `cors` with configurable origin allowlist.
- `express-rate-limit` for abuse protection.
- `express.json` / `express.urlencoded` payload parsing.
- Centralized 404 handler and error handler.

### 4.2 Environment Configuration
Env parsing:
- `artifacts/api-server/src/lib/env.ts`

Core vars:
- `PORT`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `GEMINI_FALLBACK_MODEL`
- `GEMINI_RETRY_COUNT`
- `GEMINI_RETRY_BASE_MS`
- `CORS_ORIGIN`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`
- `NODE_ENV`
- `DATABASE_URL`
- `JWT_SECRET`, `ACCESS_TOKEN_TTL_SEC`, `REFRESH_TOKEN_TTL_DAYS`
- `RESEND_API_KEY`, `MAIL_FROM`

Defaults: `GEMINI_MODEL=gemini-2.5-flash`, `GEMINI_FALLBACK_MODEL=gemini-2.5-flash-lite`. `JWT_SECRET` must be set (32+ chars) in production. See `artifacts/api-server/.env.example`.

### 4.2.1 Authentication
- Accounts: `POST /api/auth/register`, `/login`, `GET /api/auth/me`, `DELETE /api/auth/account`. Passwords are hashed with argon2.
- Sessions: short-lived JWT access tokens (`jose`, HS256, `ACCESS_TOKEN_TTL_SEC`) sent as `Authorization: Bearer`, plus opaque refresh tokens stored hashed in Postgres. `POST /api/auth/refresh` rotates the token on every use; presenting an already-rotated token revokes the whole family. `POST /api/auth/logout` revokes the family.
- Email codes: verification (`/auth/email/verify/request`, `/auth/email/verify`) and password reset (`/auth/password/forgot`, `/auth/password/reset`) use short-lived single-use codes with atomic attempt counting, delivered through Resend (or a log mailer when no key is set). Password change/reset bumps `tokenVersion`, invalidating outstanding access tokens, and revokes all refresh tokens.
- There are no static API tokens. All `/api/system/*` data is scoped to the authenticated user id; `username` query/body parameters are not trusted. Admin routes require `role = "admin"`.

### 4.3 AI Reliability Layer
AI orchestration:
- `artifacts/api-server/src/lib/ai.ts`

Capabilities:
- Primary + fallback Gemini model chain.
- Retry with exponential backoff for transient errors.
- Normalized return payload includes:
  - response text
  - selected model
  - total attempts

### 4.4 Request/Response Validation
Schema definitions:
- `artifacts/api-server/src/lib/schemas.ts`

Validation middleware:
- `artifacts/api-server/src/middlewares/validate.ts`

Centralized error serialization:
- `artifacts/api-server/src/middlewares/errors.ts`

## 5. Data Architecture
### 5.1 DB Connection
DB bootstrap:
- `lib/db/src/index.ts`

Behavior:
- `DATABASE_URL` present -> full DB client enabled.
- `DATABASE_URL` missing -> `db = null`; endpoints that need DB return `503`.

### 5.2 Core Tables
Schema file:
- `lib/db/src/schema/system_ai.ts`

Tables:
1. `system_messages`
- Stores generated system message payloads + metadata.
- Includes message type, rank/trajectory context, prompt/model metadata, and JSON context blob.

2. `generated_quest_batches`
- One row per quest generation run.
- Stores generation context and prompt/model metadata.

3. `generated_quests`
- Quest rows linked to `generated_quest_batches`.
- Includes title, description, domain, and type.

4. `quest_completion_events`
- Tracks execution outcomes from client:
  - `complete`
  - `failed`
  - `refused`
- Includes domain, quest type, completion timestamp, and source tag.

## 6. API Surface
### 6.1 Health & Readiness
- `GET /api/healthz` - liveness
- `GET /api/readyz` - readiness (`GEMINI_API_KEY` presence + DB config status)

### 6.2 AI Generation
- `POST /api/system/message`
- `POST /api/system/quests`

Both include response metadata:
- `meta.promptVersion`
- `meta.model`
- `meta.attempts`

### 6.3 Completion Event Ingest
- `POST /api/system/quest-completion`

Purpose:
- Records quest outcomes to drive adaptive generation and analytics.

### 6.4 History & Recaps
- `GET /api/system/messages`
  - filters: `username`, `limit`, `cursor`, `messageType`, `rank`, `from`, `to`
- `GET /api/system/quests/history`
  - filters: `username`, `limit`, `cursor`, `rank`, `from`, `to`
- `GET /api/system/recap/weekly`
  - weekly aggregate counts + completion metrics
- `GET /api/system/recap/weekly/debrief`
  - Gemini-generated narrative debrief from weekly metrics
- `GET /api/system/completions/summary`
  - completion trends (`attempts`, `completed`, `completionRate`, domain/status and daily breakdowns) over the requester's resolved quests in the last `days` local days (by `resolvedLocalDate`)

OpenAPI source:
- `lib/api-spec/openapi.yaml`

### 6.5 Game API
The server game engine (`/api/state`, `/api/logs`, `/api/quests`, `/api/chains`, `/api/notices`, `/api/messages`, `/api/debrief`, `/api/recap`, `/api/gym`, `/api/onboarding`). Request and response schemas live in `lib/contracts` (`@workspace/contracts`); route tests parse every response with them.

- **Not onboarded:** `GET /api/state` returns `404 { code: "not_onboarded" }`; every other game endpoint returns `409 { code: "not_onboarded" }`.
- **Idempotency:** mutating endpoints accept an `Idempotency-Key` header or a `clientId` body field; a repeat returns the stored result with `200`. For `POST /api/logs` and gym session/set create the body `clientId` is the key (it wins over the header). Endpoints whose first response is `204` (`POST /api/notices/seen`, `POST /api/debrief/:date/ack`) replay as `200` with a `null` body.
- **Rollover grace:** the worker and passive catch-up (`GET /api/state`, timezone changes) roll a local date (in `users.timezone`: quest expiry, streak breaks, decay, snapshot, rank, shadow) only 2h after it ends, so an offline log from before midnight that syncs shortly after still counts for its own date. Activity ignores the grace: `POST /api/logs` first rolls every date before the log's date, applies it, then rolls the rest as usual; quest complete/refuse, `POST /api/chains`, quest generate and gym session complete roll every date before today first.
- **Activity scoring:** every path that scores an *activity* (`POST /api/logs`, quest complete, gym session complete, and any future one) must call `applyActivityChanges` (`artifacts/api-server/src/services/activity.ts`), never `applyChanges` directly. It runs `detectComeback` before the score changes (when any change has `activity: true`), then `applyChanges`, then the caller's `afterApply` follow-ups (home-session count, chain advance), then `evaluateComeback`, and returns notices ordered `[comeback..., applied..., afterApply..., marks...]`. Non-activity score paths (refusal penalty, quest expiry, rollover decay) keep calling `applyChanges`. No other path may change a score (rank-neutral rule, adherence spec §3).
- **Notices:** `GET /api/notices` and `GameState.unseenNotices` return at most 50 unseen notices, oldest first, with `hasMore` / `hasMoreNotices`; mark them seen to get the next ones. Each notice kind has a fixed payload shape (`NoticeSchema`).

## 7. Adaptive Difficulty Loop
Adaptive quest generation currently consumes:
1. Recent generated quest batches.
2. Recent generated quest distribution by domain/type.
3. Recent completion events (`quest_completion_events`) to derive completion rate.

Prompt signal logic (high-level):
- Low completion rate: reduce scope, retain discipline pressure.
- High completion rate: increase scope and strictness.
- Overrepresented domains: rebalance distribution.
- Repeated weakest-domain targeting: vary quest execution style while preserving pressure.

This loop lives in:
- `artifacts/api-server/src/routes/system.ts`

## 8. Mobile App Architecture
### 8.1 State & Persistence
Primary state layer:
- `artifacts/system-self/context/AppContext.tsx`

Persistence:
- AsyncStorage keys under `@system_self:*`

Key domain concepts:
- User profile, rank, scores, logs
- Quests and quest chains
- Shadow Self progression
- Achievements/milestones
- Weekly recap helpers

### 8.2 Quest Scheduler
Hook:
- `artifacts/system-self/hooks/useQuestScheduler.ts`

Responsibilities:
- Daily quest rollover / regeneration.
- Expire active daily quests to `failed`.
- Trigger quest generation from backend.
- Emit failed completion events once per quest ID (deduplicated via local sent-id ledger).

### 8.3 Completion Event Emission
Client emits completion events in three cases:
1. Quest completed (`completeQuest`).
2. Quest refused (`refuseQuest`).
3. Quest expired to failed (scheduler path).

Design decision:
- Event posting is non-blocking so user UX is never blocked by analytics transport.

### 8.4 Stats Performance Card
Implemented in:
- `artifacts/system-self/app/(tabs)/stats.tsx`

Uses:
- `GET /api/system/completions/summary?username=<name>&days=14`

Displays:
- completion rate
- completed/attempted
- weakest execution domain
- 14-day sparkline

### 8.5 Deep-Link Filter into Quest Board
Flow:
- Stats “weakest execution domain” tap navigates to Quests tab with `domain` param.
- Quests tab applies domain filter and exposes clear action.

Files:
- `artifacts/system-self/app/(tabs)/stats.tsx`
- `artifacts/system-self/app/(tabs)/quests.tsx`

## 9. Security & Resilience Considerations
Implemented controls:
- Security headers (`helmet`)
- Rate limiting
- Input validation on mutating endpoints
- Structured logging
- AI retries + fallback model
- DB optional mode with graceful `503` behavior

Known gaps / future hardening:
- Per-user authentication and authorization are implemented (see 4.2.1); remaining work is MFA and session management UI.
- Signed event ingestion to prevent spoofed completion events.
- Idempotency token support for completion event posts.
- Field-level encryption for sensitive profile data (if introduced).

## 10. Observability
Current:
- Structured logs with Pino and request-scoped logging.
- AI metadata logging (`model`, `attempts`, `promptVersion`).

Recommended next:
- Add metrics (latency, 4xx/5xx rates, AI failure/retry counts).
- Add uptime checks for `/healthz` and `/readyz`.
- Add alerting thresholds (error spikes, high retry rates, DB unavailable).

## 11. Deployment Requirements
### 11.1 Required Environment
- `DATABASE_URL`
- `JWT_SECRET`

Recommended:
- `GEMINI_API_KEY` (template output is served without it)
- `RESEND_API_KEY`, `MAIL_FROM`
- `GEMINI_MODEL`
- `GEMINI_FALLBACK_MODEL`
- `CORS_ORIGIN`
- rate limit variables

### 11.2 Deployment Order
1. Apply versioned DB migrations (`lib/db/migrations`):
```bash
pnpm --filter @workspace/db migrate
```
Schema changes are authored with `pnpm --filter @workspace/db generate` (drizzle-kit) and committed as SQL. `push` is dev-only and must not be used against shared or production databases. Migration `0002_*.sql` is hand-edited with `DELETE FROM` for the AI tables and must not be replayed against a populated pre-0002 database (see `docs/DEPLOYMENT.md`).
2. Build and run API:
```bash
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/api-server start
```
3. Launch app and validate ingestion/analytics flow.

## 12. End-to-End Runtime Flows
### 12.1 Quest Generation
1. App requests `/api/system/quests`.
2. API builds prompt with user context + adaptive historical signals.
3. Gemini call runs via retry/fallback wrapper.
4. Validated quest response returned with model metadata.
5. API persists batch + quest rows.
6. App renders active quest board.

### 12.2 Completion Feedback
1. User completes/refuses quest OR scheduler marks quest failed.
2. App emits `/api/system/quest-completion`.
3. API persists event in `quest_completion_events`.
4. Completion events affect:
   - adaptive quest prompt signals
   - weekly recap metrics
   - completion summary analytics

### 12.3 Weekly Debrief
1. API aggregates 7-day generated and completion metrics.
2. API requests Gemini for a strict debrief narrative.
3. Debrief response returned with model metadata.

## 13. Testing Guidance
Because this repository uses workspace tooling, run locally:
```bash
pnpm install
docker compose up -d postgres
export TEST_DATABASE_URL=postgres://system_self:system_self@localhost:5432/system_self_test
pnpm --filter @workspace/db test
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server test
```

Manual smoke tests:
- health/readiness endpoints
- system message generation
- quest generation
- completion ingest endpoint
- weekly recap + debrief
- completion summary endpoint
- stats weakest-domain deep-link to quest filter

## 14. Change Log Summary (Recent)
Major implemented changes:
- Migrated AI stack from Anthropic/Replit integrations to Gemini.
- Added resilient AI call layer with fallback and retries.
- Added persistence for messages/quest batches/quests.
- Added completion-event ingestion and adaptive completion-rate logic.
- Added history/recap/debrief/completion summary analytics endpoints.
- Added mobile performance card and stats-to-quests domain deep-link.
- Added accounts (argon2, JWT access + rotating refresh tokens, email codes), user-scoped data, versioned migrations, and Postgres-backed CI.

## 15. Suggested Next Enhancements
1. Add MFA and session management for accounts.
2. Add completion event idempotency key and server de-duplication.
3. Add denormalized daily analytics table for faster dashboards.
4. Add scheduled weekly recap materialization jobs.
5. Add CI gates for API schema drift (OpenAPI vs implemented routes).


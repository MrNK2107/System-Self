# Deployment Checklist

## 1. Environment
Source of truth: `artifacts/api-server/src/lib/env.ts` (template: `artifacts/api-server/.env.example`).

Required in production:
- `NODE_ENV=production`
- `DATABASE_URL=postgres://<user>:<password>@<host>:5432/<db>`
- `JWT_SECRET=<random, at least 32 chars>` (generate with `openssl rand -base64 48`). The built-in dev secret is used only when `NODE_ENV` is explicitly `development` or `test`; in every other case (including an unset `NODE_ENV`) startup fails unless `JWT_SECRET` is set, and any value containing `change-me` (such as the `.env.example` placeholder) is rejected.
- `RESEND_API_KEY=...` and `MAIL_FROM="SYSTEM // SELF <no-reply@your-domain>"`. Startup fails without `RESEND_API_KEY` unless `MAILER=log` is set explicitly; the log mailer then writes mails to the logs with every 6-digit code replaced by `******` (codes are shown only when `NODE_ENV` is `development` or `test`), so users cannot verify email or reset passwords in that mode.
- `TRUST_PROXY=<hops>` when the API runs behind a reverse proxy or load balancer (see below).

Recommended:
- `PORT=3001`
- `CORS_ORIGIN=https://your-app-domain.com` (comma-separated allowlist; unset means `*`)
- `GEMINI_API_KEY=...` (without it, or when Gemini fails after retries and the fallback model, the API serves template output with `meta.model = "template"`)

Optional tuning (defaults shown):
- `ACCESS_TOKEN_TTL_SEC=900`
- `REFRESH_TOKEN_TTL_DAYS=30`
- `GEMINI_MODEL=gemini-2.5-flash`
- `GEMINI_FALLBACK_MODEL=gemini-2.5-flash-lite`
- `GEMINI_RETRY_COUNT=2`
- `GEMINI_RETRY_BASE_MS=250`
- `RATE_LIMIT_WINDOW_MS=60000`
- `RATE_LIMIT_MAX=60`
- `LOG_LEVEL=info` (defaults to `silent` when `NODE_ENV=test`)

### Reverse proxies (`TRUST_PROXY`)
Rate limits are keyed by client IP. Behind a proxy (Render, Fly, Nginx, a cloud load balancer) every request arrives from the proxy's IP, so all clients would share one bucket and the auth limiters would lock everyone out together. Set `TRUST_PROXY` to the number of proxy hops in front of the API (usually `1`) so Express takes the client IP from `X-Forwarded-For`. Accepted values: unset or `false` (default, direct exposure; `X-Forwarded-For` is ignored), an integer hop count, or `true` (trust every hop; only when the network guarantees clients cannot reach the API directly, because clients can then forge `X-Forwarded-For`). Never set it when the API is exposed directly. `/api/healthz` and `/api/readyz` are exempt from the global rate limiter so health probes are never throttled.

The static-token variables (`AUTH_ENABLED`, `API_AUTH_TOKENS`, `API_AUTH_REVOKED_TOKENS`, `ADMIN_API_TOKENS`, `AUTH_ROTATION_WARNING_DAYS`) no longer exist and are ignored.

## 2. Health Checks
- Liveness: `GET /api/healthz`
- Readiness: `GET /api/readyz` (503 when the database is unavailable; reports `ai: "gemini" | "template"`)

## 3. Database Migrations + Build + Start
Production schema changes are applied with versioned migrations, never `push`:
```bash
pnpm --filter @workspace/db migrate      # applies lib/db/migrations/*.sql using DATABASE_URL
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/api-server start
```
Authoring a schema change: edit `lib/db/src/schema`, run `pnpm --filter @workspace/db generate`, review and commit the SQL. `pnpm --filter @workspace/db push` is for throwaway local databases only.

Warning: `lib/db/migrations/0002_*.sql` was hand-edited to begin with `DELETE FROM` statements for the AI tables (`generated_quests`, `generated_quest_batches`, `quest_completion_events`, `system_messages`), because legacy rows were keyed by username and could not be attributed to a user. This was safe only because no production data existed. Never replay this migration against a populated database that still has the pre-0002 schema; it would delete that data. Databases already past 0002 are unaffected (migrations run once).

## 4. Pre-Release Validation
- `docker compose up -d postgres` and set `TEST_DATABASE_URL=postgres://system_self:system_self@localhost:5432/system_self_test`
- `pnpm run typecheck`
- `pnpm --filter @workspace/db test`
- `pnpm --filter @workspace/api-server typecheck`
- `pnpm --filter @workspace/api-server test`
- Verify the mobile app can register/login, refresh, and call `/api/system/message` and `/api/system/quests` with `Authorization: Bearer <accessToken>`.

## 5. Auth Operations
- Accounts use email + password (argon2). Sessions are short-lived JWT access tokens plus rotating refresh tokens (`/api/auth/refresh`); reuse of a rotated token revokes its family.
- Rotate `JWT_SECRET`: deploying a new value invalidates all access tokens; clients recover via refresh only if the refresh token store is intact (refresh tokens are opaque and not signed with `JWT_SECRET`).
- Password change/reset bumps the user's `tokenVersion` and revokes all refresh tokens.
- Operator access: users with `role = "admin"` can use `/api/admin/users`.
- Raw tokens and codes are never logged; the `authorization` and `cookie` headers are redacted.

## 6. Query Options
- Messages:
  - `limit` (default 20, max 100)
  - `cursor` (message id for pagination)
  - `messageType`, `rank`
  - `from`, `to` (ISO datetime)
- Quest history:
  - `limit` (default 10, max 50)
  - `cursor` (batch id for pagination)
  - `rank`
  - `from`, `to` (ISO datetime)

## 7. Completion Event Ingestion
Send a completion event when a quest is completed/failed/refused:
```json
{
  "questId": "quest-123",
  "status": "complete",
  "domain": "DISCIPLINE",
  "questType": "daily",
  "completedAt": "2026-05-03T12:00:00.000Z",
  "source": "app"
}
```
Idempotency:
- Send `Idempotency-Key` header (recommended) and/or `idempotencyKey` in body.
- Server deduplicates completion events by `(userId, idempotencyKey)`.
- App currently uses deterministic key: `questId:status:domain:questType`.

App behavior:
- `complete` and `refused` are emitted from quest actions.
- `failed` is emitted automatically by the quest scheduler when active daily quests expire.
- Failed events are de-duplicated client-side so each quest id is sent once.

## 8. Rollout
- Deploy to staging first.
- Run smoke checks on staging.
- Promote to production.
- Monitor logs and request latency/error rate for first 24h.

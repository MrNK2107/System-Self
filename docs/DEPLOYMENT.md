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
- `CORS_ORIGIN=https://your-app-domain.com` (comma-separated allowlist). Required outside development/test, and `*` is refused: boot fails with a one-line-per-variable message. Requests from an unlisted `Origin` get 403; requests without an `Origin` header (the native app, server-to-server) pass. Unset (development only) means `*`.
- `DATABASE_URL` is required outside development/test (boot fails without it). `DB_POOL_MAX` sizes each process's Postgres pool (default 10): keep `DB_POOL_MAX × (API instances + workers)` under the database's connection limit.
- JSON and urlencoded bodies are limited to 100 KB (413 `payload_too_large`); the voice upload route keeps its own 5 MB raw limit.
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
- `RATE_LIMIT_DISABLED` / `LOAD_TEST`: load-test targets only (see `docs/PERFORMANCE.md`). The API refuses to boot outside development/test with `RATE_LIMIT_DISABLED=1` unless `LOAD_TEST=1` is also set. Never set either in a deployment.
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
Databases previously created with `pnpm --filter @workspace/db push` have no migration history: `migrate` would try to create tables that already exist and fail. Drop and recreate such a database (local data is disposable) before running `migrate`, e.g. `docker compose down -v && docker compose up -d postgres` for the compose database.

The compose service runs `scripts/db/init-test-db.sql` (which creates `system_self_test`) only when the `pgdata` volume is first initialised. On an existing volume it does nothing; create the test database by hand (`docker compose exec postgres createdb -U system_self system_self_test`) or recreate the volume with `docker compose down -v`.

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
- Accounts use email + password (argon2). Sessions are short-lived JWT access tokens plus rotating refresh tokens (`/api/auth/refresh`); reuse of a rotated token revokes its family. Grace window: a client whose refresh response was lost may retry with the same token within 30 seconds of the original rotation; if the unseen successor is still live it is revoked (`revoked_reason = 'superseded'`) and a new token is issued in the same family. Replays after 30 seconds, or of tokens revoked by logout/password change, revoke the family.
- Rotate `JWT_SECRET` without logging anyone out: set `JWT_SECRET_PREVIOUS` to the old value and `JWT_SECRET` to the new one, and deploy. Access tokens verify against `JWT_SECRET`, then `JWT_SECRET_PREVIOUS`; new tokens are always signed with `JWT_SECRET`. After one `ACCESS_TOKEN_TTL_SEC` (15 min by default), remove `JWT_SECRET_PREVIOUS` and deploy again. For a leaked secret, skip `JWT_SECRET_PREVIOUS`: every access token dies at once and clients recover through refresh (refresh tokens are opaque and not signed with `JWT_SECRET`).
- Email codes (verification, password reset) are capped at 5 per account and purpose per hour: `/api/auth/email/verify/request` then answers 429 `code_rate_limited`; `/api/auth/password/forgot` still answers 204 but sends nothing.
- Password change/reset bumps the user's `tokenVersion` and revokes all refresh tokens. `/api/auth/password/change` then returns a fresh session (200, same body as login) so the caller stays signed in; reset returns 204 and the user signs in again.
- Operator access: users with `role = "admin"` can use `/api/admin/users` and `PATCH /api/admin/users/:id/role`. Demoting the last remaining admin is refused with 409 `last_admin`.
- Bootstrap the first admin (the user must already be registered): `DATABASE_URL=... pnpm --filter @workspace/api-server admin:grant <email>`. It exits non-zero when no user has that email.
- Email codes are stored as HMAC-SHA256 keyed with `JWT_SECRET`, so rotating `JWT_SECRET` also invalidates outstanding codes (they expire within 15 minutes anyway).
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

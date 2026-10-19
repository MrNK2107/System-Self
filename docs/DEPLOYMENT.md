# Deployment

How SYSTEM // SELF runs in production: environment, the Docker image, compose and Render, scaling, push, billing,
metrics, migrations and backups. Day-two procedures (deploy, rollback, rotations, incidents) are in
[RUNBOOK.md](RUNBOOK.md). The mobile store pipeline is in [RELEASE.md](RELEASE.md). What is still waiting on the owner
(hosting provider, secrets, store accounts) is in [HOLD.md](HOLD.md).

## 1. Environment
Source of truth: `artifacts/api-server/src/lib/env.ts` (templates: `artifacts/api-server/.env.example` for development,
`.env.prod.example` for the production compose stack). The API, the worker and the migrator read the same variables.
Production validation failures exit the process at boot with one line per offending variable.

Required in production:
- `NODE_ENV=production`
- `DATABASE_URL=postgres://<user>:<password>@<host>:5432/<db>`
- `JWT_SECRET=<random, at least 32 chars>` (generate with `openssl rand -base64 48`). The built-in dev secret is used only when `NODE_ENV` is explicitly `development` or `test`; in every other case (including an unset `NODE_ENV`) startup fails unless `JWT_SECRET` is set, and any value containing `replace`, `change` or `example` (such as the `.env.example` placeholder) is rejected.
- `RESEND_API_KEY=...` and `MAIL_FROM="SYSTEM // SELF <no-reply@your-domain>"`. Startup fails without `RESEND_API_KEY` unless `MAILER=log` is set explicitly; the log mailer then writes mails to the logs with every 6-digit code replaced by `******` (codes are shown only when `NODE_ENV` is `development` or `test`), so users cannot verify email or reset passwords in that mode (HOLD H-05).
- `CORS_ORIGIN=https://your-app-domain.com` (comma-separated allowlist). Required outside development/test, and `*` is refused. Requests from an unlisted `Origin` get 403; requests without an `Origin` header (the native app, server-to-server) pass. Unset (development only) means `*`.
- `TRUST_PROXY=<hops>` when the API runs behind a reverse proxy or load balancer (see below).

Recommended:
- `PORT=3001`
- `DB_POOL_MAX` sizes each process's Postgres pool (default 10). See [Scaling](#4-scaling) for the connection budget.
- `GEMINI_API_KEY=...` (without it, or when Gemini fails after retries and the fallback model, the API serves template output with `meta.model = "template"`; HOLD H-01)
- `METRICS_TOKEN=<random>` turns on `/metrics` (see [Metrics](#7-metrics)). Placeholder-looking values are refused.
- `REVENUECAT_WEBHOOK_SECRET` and `REVENUECAT_API_KEY` (see [Billing](#6-billing-revenuecat)). Placeholder-looking webhook secrets are refused.
- `EXPO_ACCESS_TOKEN` only when Enhanced Push Security is on for the Expo project.
- JSON and urlencoded bodies are limited to 100 KB (413 `payload_too_large`); the voice upload route keeps its own 5 MB raw limit.

Optional tuning (defaults shown):
- `ACCESS_TOKEN_TTL_SEC=900`
- `REFRESH_TOKEN_TTL_DAYS=30`
- `JWT_SECRET_PREVIOUS` (unset): only during a JWT secret rotation ([RUNBOOK.md](RUNBOOK.md#rotate-the-jwt-secret)).
- `GEMINI_MODEL=gemini-2.5-flash`
- `GEMINI_FALLBACK_MODEL=gemini-2.5-flash-lite`
- `GEMINI_RETRY_COUNT=2`
- `GEMINI_RETRY_BASE_MS=250`
- `RATE_LIMIT_WINDOW_MS=60000`
- `RATE_LIMIT_MAX=60`
- `WORKER_TICK_MS=60000`, `SOCIAL_JOB_BUDGET_MS=2000`, `PUSH_JOB_BUDGET_MS=15000`, `PUSH_SEND_BUDGET_MS=15000` (worker)
- `WORKER_METRICS_PORT` (unset): the worker's own `/metrics` listener, which also needs `METRICS_TOKEN`.
- `SHUTDOWN_DRAIN_MS` (5000 in production, else 0): how long `/api/readyz` answers 503 before the listener closes on SIGTERM.
- `RATE_LIMIT_DISABLED` / `LOAD_TEST`: load-test targets only (see [PERFORMANCE.md](PERFORMANCE.md)). The API refuses to boot outside development/test with `RATE_LIMIT_DISABLED=1` unless `LOAD_TEST=1` is also set. Never set either in a deployment.
- `LOG_LEVEL=info` (defaults to `silent` when `NODE_ENV=test`)

### Reverse proxies (`TRUST_PROXY`)
Rate limits are keyed by client IP. Behind a proxy (Render, Fly, Nginx, a cloud load balancer) every request arrives from the proxy's IP, so all clients would share one bucket and the auth limiters would lock everyone out together. Set `TRUST_PROXY` to the number of proxy hops in front of the API (usually `1`) so Express takes the client IP from `X-Forwarded-For`. Accepted values: unset or `false` (default, direct exposure; `X-Forwarded-For` is ignored), an integer hop count, or `true` (trust every hop; only when the network guarantees clients cannot reach the API directly, because clients can then forge `X-Forwarded-For`). Never set it when the API is exposed directly. `/api/healthz` and `/api/readyz` are exempt from the global rate limiter so health probes are never throttled.

The static-token variables (`AUTH_ENABLED`, `API_AUTH_TOKENS`, `API_AUTH_REVOKED_TOKENS`, `ADMIN_API_TOKENS`, `AUTH_ROTATION_WARNING_DAYS`) no longer exist and are ignored.

### Health checks
- Liveness: `GET /api/healthz` (200 while the process is up).
- Readiness: `GET /api/readyz`: 200 `{"status":"ready","db":"ok","ai":"gemini"|"template"}`; 503 when the database is unreachable or during shutdown drain. Point load balancers and platform health checks here.

## 2. Docker

One image, built from the repository root, runs every role:

```sh
docker build -f artifacts/api-server/Dockerfile -t system-self-api:<tag> .
```

| `ROLE` | Process | Notes |
| --- | --- | --- |
| `api` (default) | `node dist/index.mjs` | Listens on `PORT` (3001). Stateless; run as many as you need. |
| `worker` | `node dist/worker.mjs` | Day rollover, quest deadlines, push, social jobs, pruning. Safe to run more than one. |
| `migrate` | `node dist/migrate.mjs` | Applies `dist/migrations` and exits 0. Run it before the new code serves traffic. |

- Multi-stage, `node:22-alpine` flattened onto `scratch`, non-root `node` user, `tini` as PID 1, `NODE_ENV=production`.
- `build.mjs` bundles every pure-JS dependency into `dist`; the only runtime `node_modules` is the native
  `@node-rs/argon2` and its platform binary. Source maps are removed from the image.
- Third-party notices: `build.mjs` writes `dist/THIRD_PARTY_NOTICES.txt` with the name, version, licence and licence
  file text of every package that ships (everything esbuild bundled, from its metafile, plus the production dependency
  graph walked through node_modules, which covers the native externals). The licence comments kept inline are in
  `dist/index.mjs.LEGAL.txt` and `dist/worker.mjs.LEGAL.txt` (esbuild `legalComments`). The image build fails if any
  of these is missing. The app's list is `docs/legal/THIRD_PARTY_NOTICES-app.txt`, shown in the app as
  Settings > Open-source licences (`pnpm --filter @workspace/system-self gen:notices` after changing app dependencies).
- Size: **212 MB** in `docker images` on Docker Desktop (that figure counts unpacked plus compressed content; the root
  filesystem is about 150 MB). The budget is 250 MB, and CI's `docker-smoke` job fails the build above it
  (`docker image inspect` Size). Details: [PERFORMANCE.md](PERFORMANCE.md).
- SIGTERM: the API flips `/api/readyz` to 503, drains for `SHUTDOWN_DRAIN_MS`, then finishes in-flight requests. The
  worker finishes the user it is rolling over and releases the rest of its claimed batch. Give containers a 30 s stop
  grace period (`stop_grace_period` in compose).

### Migrations run first
`ROLE=migrate` is a one-shot job. Run it, and wait for exit 0, before starting new API and worker containers. It holds
a Postgres session advisory lock (`pg_advisory_lock(7265390417)`) while drizzle applies the pending migrations, so two
migrators started at once run one after the other and the second finds nothing to do. That makes it safe to run from
several places (a pre-deploy hook and a compose `migrate` service, or two deploys racing). Migrations are written to
be forward-only and additive: old code keeps working on the new schema, which is what makes a code-only rollback safe
([RUNBOOK.md](RUNBOOK.md#rollback)).

From a repo checkout (no image), the same migrator is `pnpm --filter @workspace/db migrate` with `DATABASE_URL` set.
Never use `drizzle-kit push` against a shared database.

### Production compose (`docker-compose.prod.yml`)
postgres, a one-shot `migrate`, two API instances (`api1`, `api2`) behind nginx on port 8080 (`deploy/nginx.conf`),
and one worker. The APIs start only after `migrate` exits 0, and nginx only after both APIs pass their readiness check.

```sh
cp .env.prod.example .env.prod       # replace every CHANGE ME value; .env.prod is gitignored
# set POSTGRES_PASSWORD (shell env or a .env file) to the password in DATABASE_URL
docker compose -f docker-compose.prod.yml up -d --build
curl http://localhost:8080/api/readyz
SMOKE_BASE_URL=http://localhost:8080 pnpm --filter @workspace/scripts smoke
docker compose -f docker-compose.prod.yml logs -f api1 api2 worker
```

Compose variables: `ENV_FILE` (default `.env.prod`), `POSTGRES_PASSWORD` (default is a placeholder; change it) and
`API_IMAGE` (default `system-self-api:prod`). Postgres is not published to the host. `api1` and `api2` are also on
3011 and 3012 for debugging. `bash scripts/docker-smoke.sh` runs the whole stack with generated secrets, smoke-tests
it and tears it down. CI runs the same script on every push.

The compose file is a reference topology for a single host, not a managed platform: put TLS in front of nginx (or
replace nginx with your load balancer) and use a managed Postgres with backups for real traffic.

## 3. Render (`render.yaml`)

A Blueprint for the HOLD H-02 decision: a Docker web service (`system-self-api`, health check `/api/readyz`, a
`preDeployCommand` that runs the migrator), a Docker background worker (`system-self-worker`), and a managed Postgres
16 (`system-self-db`). `NODE_ENV` comes from the `system-self-shared` env group, `DATABASE_URL` from the database, and
every secret is `sync: false`, so Render prompts for it on the first sync. Dashboard: New > Blueprint, pick the repo.

**Not validated with the Render CLI.** The file was written against the Blueprint spec but never run through Render's
validator. Before first use:

```sh
render blueprints validate render.yaml
```

Then fill the prompted secrets (`JWT_SECRET`, `CORS_ORIGIN`, `RESEND_API_KEY`, `MAIL_FROM`, `REVENUECAT_*`,
`GEMINI_API_KEY`, `EXPO_ACCESS_TOKEN`) on both services; the worker needs the same values. Add `METRICS_TOKEN` by hand if
you want `/metrics`. `TRUST_PROXY=1` is preset for Render's proxy.

## 4. Scaling

- **API:** stateless. Run N instances behind a load balancer that health-checks `/api/readyz` and retries 503s on
  another instance (the nginx config does `proxy_next_upstream error timeout http_503`). Set `TRUST_PROXY` to the
  number of proxy hops.
- **Connection budget:** every process opens up to `DB_POOL_MAX` connections (default 10). Keep
  `DB_POOL_MAX × (API instances + worker instances) + 2 per migrator run + admin headroom` under the database's
  `max_connections` (100 on stock Postgres; small managed plans allow fewer). The load test hit its targets on one API
  instance with the default pool ([PERFORMANCE.md](PERFORMANCE.md)). Put PgBouncer (transaction mode) in front before
  you need more than the database allows.
- **Rate limits are per instance.** The global, auth, billing-webhook and export limiters use express-rate-limit's
  in-memory store, so with N replicas a client can make up to N times the configured limit (more if the balancer
  spreads its requests). Before running more than one replica, either move the limiters to a shared store
  (a Postgres-backed store; there is no Redis in this stack) or accept proportionally looser limits and lower
  `RATE_LIMIT_MAX` to compensate. The reference compose stack runs two replicas and accepts the looser limits.
- **Workers:** more than one instance is safe. Day rollover claims users with `FOR UPDATE SKIP LOCKED` and a 10-minute
  lease (`CLAIM_LEASE_MS`), so two workers never roll the same user, and a crashed worker's users become due again when
  the lease runs out. Score writes take a per-user advisory transaction lock, so a worker and an API request for the
  same user serialize. One worker handles the current load; add more when `job_duration_seconds{job="rollover"}`
  approaches `WORKER_TICK_MS`.

## 5. Push notifications

The worker sends pushes through the Expo Push API (`https://exp.host/--/api/v2/push/send`); there are no FCM or APNs
credentials on the server. The device side needs:

- An EAS project: `EAS_PROJECT_ID` at app build time sets `extra.eas.projectId`. Without it the app skips push
  registration entirely.
- Android: a Firebase project, `google-services.json` uploaded as the EAS file env var `GOOGLE_SERVICES_JSON`, and the
  FCM service account key under `eas credentials`.
- iOS: an APNs key created through `eas credentials`.

The steps are in [RELEASE.md](RELEASE.md#one-time-setup) (HOLD H-03). `EXPO_ACCESS_TOKEN` is needed on the worker only
if Enhanced Push Security is enabled for the Expo project. Tokens Expo reports as `DeviceNotRegistered` are deleted
automatically.

## 6. Billing (RevenueCat)

- Webhook URL: `https://<api-host>/api/billing/revenuecat` (POST). In the RevenueCat dashboard set the Authorization
  header value to `Bearer <REVENUECAT_WEBHOOK_SECRET>` (the raw secret without `Bearer ` is accepted too). Generate the
  secret with `openssl rand -base64 32`. Unset, the endpoint answers 503 and accepts nothing.
- `REVENUECAT_API_KEY` (the secret v1 REST key, `sk_...`) is needed for `TRANSFER` events, when a restore moves a
  purchase to another account: both accounts are re-fetched from RevenueCat. Without it a transfer is logged and changes
  no entitlement. If RevenueCat is unreachable during a transfer the webhook answers 503 and RevenueCat retries.
- The webhook has its own rate-limit bucket, separate from the per-IP global limiter.
- Support can grant PRO without RevenueCat through the admin endpoint ([RUNBOOK.md](RUNBOOK.md#grant-pro-for-support)).
- Products, entitlement id and app keys: [RELEASE.md](RELEASE.md#one-time-setup) (HOLD H-04).

## 7. Metrics

- `METRICS_TOKEN` set: the API serves Prometheus metrics at `GET /metrics` (not under `/api`) and requires
  `Authorization: Bearer <METRICS_TOKEN>` (401 otherwise). Unset: `/metrics` is 404.
- The worker is a separate process with its own registry. With `WORKER_METRICS_PORT` and `METRICS_TOKEN` both set it
  serves `/metrics` on that port (same bearer token). Do not publish that port publicly.
- Series: `http_request_duration_seconds{method,route,status}` (route is the pattern, such as `/api/quests/:id/complete`,
  never a raw id), `ai_calls_total{model,outcome}`, `ai_fallbacks_total`, `job_duration_seconds{job}` (worker),
  `rollover_users_total` (worker), plus the default Node process metrics.
- Every response carries an `x-request-id` header. An incoming `x-request-id` that is short and plain is kept, otherwise
  a UUID is generated. Each request log line has the same id as `req.id`, so a user-reported id finds its logs.

Prometheus scrape example (scrape each API instance directly, not through the load balancer, so every replica is seen):

```yaml
scrape_configs:
  - job_name: system-self-api
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/system-self-metrics-token
    static_configs:
      - targets: ["api1:3001", "api2:3001"]
  - job_name: system-self-worker
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/system-self-metrics-token
    static_configs:
      - targets: ["worker:9464"]   # WORKER_METRICS_PORT=9464
```

## 8. Database migrations

Production schema changes are applied with versioned migrations, never `push`:
```bash
pnpm --filter @workspace/db migrate      # applies lib/db/migrations/*.sql using DATABASE_URL (the image: ROLE=migrate)
```
Authoring a schema change: edit `lib/db/src/schema`, run `pnpm --filter @workspace/db generate`, review and commit the
SQL. Keep changes additive (new tables, nullable or defaulted columns, new indexes) so the previous release still runs
on the new schema; remove a column only in a later release, after no deployed code reads it.
`pnpm --filter @workspace/db push` is for throwaway local databases only.

Databases previously created with `pnpm --filter @workspace/db push` have no migration history: `migrate` would try to
create tables that already exist and fail. Drop and recreate such a database (local data is disposable) before running
`migrate`, e.g. `docker compose down -v && docker compose up -d postgres` for the dev compose database.

The dev compose service runs `scripts/db/init-test-db.sql` (which creates `system_self_test`) only when the `pgdata`
volume is first initialised. On an existing volume it does nothing; create the test database by hand
(`docker compose exec postgres createdb -U system_self system_self_test`) or recreate the volume with
`docker compose down -v`.

Warning: `lib/db/migrations/0002_*.sql` was hand-edited to begin with `DELETE FROM` statements for the AI tables (`generated_quests`, `generated_quest_batches`, `quest_completion_events`, `system_messages`), because legacy rows were keyed by username and could not be attributed to a user. This was safe only because no production data existed. Never replay this migration against a populated database that still has the pre-0002 schema; it would delete that data. Databases already past 0002 are unaffected (migrations run once).

### Index migrations on large tables
drizzle applies pending migrations inside a transaction, and a plain `CREATE INDEX` blocks writes to the table while it
builds. That is fine on a new or small database, and every index so far (for example
`0040_perf_hot_path_indexes.sql`) was written that way. `CREATE INDEX CONCURRENTLY` cannot run inside a transaction,
so on a large populated table the index needs a manual step outside drizzle:

1. Write the migration with `CREATE INDEX IF NOT EXISTS ...` (edit the generated SQL), so it is a no-op when the index
   already exists.
2. Before deploying, build the index by hand with the same name and definition:
   `psql "$DATABASE_URL" -c 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "quests_user_resolved_date_idx" ON "quests" ("user_id","resolved_local_date") WHERE "resolved_local_date" IS NOT NULL;'`
3. Check it is valid (`select indexrelid::regclass, indisvalid from pg_index where not indisvalid;` returns nothing; drop
   and retry an invalid one), then deploy. The migrator records the migration and skips the existing index.

## 9. Backups

Use the database provider's point-in-time recovery (PITR) when it has it: Render, Neon, RDS and Cloud SQL all do on
paid plans. Aim for at least 7 days of PITR and a daily snapshot kept for 30 days. Without PITR, take a logical dump at
least daily and keep 14 days, stored off the database host and encrypted:

```sh
pg_dump --format=custom --no-owner --dbname "$DATABASE_URL" --file "system-self-$(date -u +%Y%m%dT%H%MZ).dump"
```

Test a restore into a scratch database every quarter ([RUNBOOK.md](RUNBOOK.md#restore-a-backup)). Account deletions
are applied to the live database at once, but backups keep deleted users until they age out, so state the backup
retention in the privacy policy (HOLD H-06).

## 10. Auth operations
- Accounts use email + password (argon2). Sessions are short-lived JWT access tokens plus rotating refresh tokens (`/api/auth/refresh`); reuse of a rotated token revokes its family. Grace window: a client whose refresh response was lost may retry with the same token within 30 seconds of the original rotation; if the unseen successor is still live it is revoked (`revoked_reason = 'superseded'`) and a new token is issued in the same family. Replays after 30 seconds, or of tokens revoked by logout/password change, revoke the family.
- Rotating `JWT_SECRET` without logging anyone out uses `JWT_SECRET_PREVIOUS`; the procedure is in [RUNBOOK.md](RUNBOOK.md#rotate-the-jwt-secret). Refresh tokens are opaque database rows, not signed with `JWT_SECRET`, so a rotation never signs anyone out.
- Email codes (verification, password reset) are capped at 5 per account and purpose per hour: `/api/auth/email/verify/request` then answers 429 `code_rate_limited`; `/api/auth/password/forgot` still answers 204 but sends nothing.
- Password change/reset bumps the user's `tokenVersion` and revokes all refresh tokens. `/api/auth/password/change` then returns a fresh session (200, same body as login) so the caller stays signed in; reset returns 204 and the user signs in again.
- Operator access: users with `role = "admin"` can use `/api/admin/users`, `PATCH /api/admin/users/:id/role`, `POST /api/admin/users/:id/entitlement`, and the support routes `GET /api/admin/users/:id/export` and `POST /api/admin/users/:id/delete` (body `{"confirm":"<username>"}`; [RUNBOOK.md](RUNBOOK.md#user-data-export-or-deletion-request)). Each support call logs an `admin_action` line with the actor, action, target id and status. Demoting the last remaining admin is refused with 409 `last_admin`.
- Bootstrap the first admin (the user must already be registered): from a repo checkout, `DATABASE_URL=... pnpm --filter @workspace/api-server admin:grant <email>`. It exits non-zero when no user has that email. The image has no `tsx`, so from a host with only database access use `update users set role = 'admin' where email = '<email>';`.
- Email codes are stored as HMAC-SHA256 keyed with `JWT_SECRET`, so rotating `JWT_SECRET` also invalidates outstanding codes (they expire within 15 minutes anyway).
- Raw tokens and codes are never logged; the `authorization` and `cookie` headers are redacted.

## 11. Pre-release validation
- CI (`.github/workflows/ci.yml`): `validate` (typecheck, db, api-server and app tests, API build), `app-export`
  (Android bundle) and `docker-smoke` (image build and size, the prod compose stack, `scripts/smoke.ts` through nginx).
- Locally: `pnpm run typecheck`, the test suites in the [README](../README.md#tests), then `bash scripts/docker-smoke.sh`.
- Against staging after a deploy: `SMOKE_BASE_URL=https://<staging-api> pnpm --filter @workspace/scripts smoke`. It
  creates one account and deletes it at the end.

## 12. Legacy endpoints
These pre-date the game API and are still served (authenticated).

Query options:
- `GET /api/system/messages`: `limit` (default 20, max 100), `cursor` (message id), `messageType`, `rank`, `from`, `to` (ISO datetime).
- `GET /api/system/quests/history`: `limit` (default 10, max 50), `cursor` (batch id), `rank`, `from`, `to` (ISO datetime).

Completion event ingestion, `POST /api/system/quest-completion`:
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
- Send an `Idempotency-Key` header (recommended) and/or `idempotencyKey` in the body. The server deduplicates
  completion events by `(userId, idempotencyKey)`.

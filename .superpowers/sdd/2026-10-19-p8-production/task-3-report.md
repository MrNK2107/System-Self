# P8 Task 3 report: security hardening and parked hygiene

Branch `feat/production-build`, base `2281c87`. Commit: `sec: production hardening` (SHA in the hand-off).

## 1. Brief items

| Item | Where | Notes |
|---|---|---|
| Production boot validation | `src/lib/env.ts` | Outside development/test (an unset `NODE_ENV` counts as production): `DATABASE_URL` required; `CORS_ORIGIN` required, comma-separated, and no entry may contain `*`; `JWT_SECRET` at least 32 characters (now with an explicit message); the placeholder guard also covers `JWT_SECRET_PREVIOUS`. `env` is loaded by `loadEnv`, which writes `Invalid environment:` plus one `  - VAR: reason` line per issue to stderr and exits 1, with no ZodError stack (`formatEnvError`). |
| Strict CORS | `src/app-factory.ts` (`strictOrigin`) | When an allowlist is configured, a request whose `Origin` is not on it gets 403 `{ error: "Origin not allowed", code: "cors_origin_rejected" }`, preflight included. A request with no `Origin` header (native app, server-to-server) passes. `*` remains only for development with `CORS_ORIGIN` unset. `createApp({ corsOrigins })` is a test seam. |
| `JWT_SECRET_PREVIOUS` (Review Focus 5) | `src/lib/auth/tokens.ts` | `verifyAccessToken` tries `JWT_SECRET`, then `JWT_SECRET_PREVIOUS`. Signing always uses `JWT_SECRET`. Rotation runbook is in `docs/DEPLOYMENT.md` section 5: set previous = old and current = new, deploy, then remove previous after one access TTL (15 min). The role still comes from the DB and `tokenVersion` is still checked, so a token from the previous secret gets no extra power. |
| JSON limit 100 KB, 413 JSON | `app-factory.ts`, `middlewares/errors.ts` | `express.json`/`urlencoded` take `limit: "100kb"`. They are wrapped in `skipVoice`, so `POST /api/logs/voice` never reaches them and keeps its own 5 MB `express.raw`. The error handler maps `entity.too.large` to 413 `payload_too_large` and `entity.parse.failed` to 400 `invalid_json`. Both used to be 500s. Any other exposed 4xx http-error becomes a generic 400. |
| `DB_POOL_MAX` | `lib/db/src/index.ts` | `createDb(url, { max })`, defaulting to `poolMaxFromEnv(process.env)`, which is 10. Validated in `env.ts` as an integer from 1 to 500. |
| `TRUST_PROXY` | already env-driven (`env.TRUST_PROXY`, default `false`) | Production compose (`.env.prod.example`) and `render.yaml` set it to `1`. No change needed. |

## 2. Security review

The `security-review` skill was invoked. Its method calls for sub-agents, which this task forbids, so I ran the same review by hand over the branch's server code (`artifacts/api-server/src`, `lib/db`).

| # | Severity | Area | Finding | Status |
|---|---|---|---|---|
| 1 | Medium | CORS | With `CORS_ORIGIN` unset in production, CORS fell back to `*`. Unknown origins were never refused, they only lacked headers. | **Fixed**: boot fails without `CORS_ORIGIN` or with `*`, and unknown origins get 403. |
| 2 | Medium | Config | Production booted without `DATABASE_URL`, serving 503 on every route instead of failing the deploy. Env errors also came out as raw ZodError stacks. | **Fixed**: required, with a readable exit message. |
| 3 | Medium | Auth / key management | No way to rotate `JWT_SECRET` without logging everyone out, which discourages rotating at all. | **Fixed**: `JWT_SECRET_PREVIOUS` plus the runbook. |
| 4 | Low | Error handling | Malformed or oversized JSON returned 500 (and was logged as an unhandled error). | **Fixed**: 400 `invalid_json` and 413 `payload_too_large`. The limit itself was already Express's 100 KB default; it is now explicit. |
| 5 | Low | Data integrity | Timezones were validated only against Node's ICU data. A zone Postgres does not know would break every later `at time zone` query for that user. | **Fixed**: parked item 4b. |
| 6 | Low | Account enumeration | `POST /auth/register` returns 409 `email_taken`, and `username_taken` too. | Accepted. This is standard sign-up UX, and the endpoint has a 10 per 15 min per-IP limiter. `forgot` always returns 204. `reset` returns the same `invalid_code` for unknown emails and wrong codes; only an existing account can later show `locked` or `expired`. |
| 7 | Low | Timing | `password/forgot` does a little more work (code insert) when the account exists. The mail send is fire-and-forget. | Accepted. The difference is small and the endpoint is rate-limited. Login is timing-equalised with a dummy argon2 hash. |
| 8 | Low | Rate limiting | `/auth/refresh` only has the global limiter (60/min/IP). Every limiter uses an in-memory store, so with N API instances the effective limit is N times higher. | Accepted. Refresh tokens are 256-bit random values. A shared store (Redis) is a later ops item. |
| 9 | Low | Robustness | Some `:id` routes (finance, gym, custom domains) pass a non-UUID id to a `uuid` column, which gives a generic 500 (`22P02`). | Not fixed. There is no leakage (generic body) and ownership is still enforced. Can be cleaned up with the UUID guard the quests routes already use. |
| 10 | Info | Secrets | Rotating `JWT_SECRET` also invalidates outstanding email codes (HMAC key), which have a 15 min lifetime. | Documented (DEPLOYMENT.md already says so). |
| 11 | Info | `METRICS_TOKEN` / webhook secret | Only the placeholder guard applies, with no minimum length. Compares are SHA-256 plus `timingSafeEqual`. | Accepted. The example values use `openssl rand`. |

Checked and found clean:
- **authn**: every router path sits under a `requireAuth`-mounted prefix. The only public routes are `/auth/{register,login,refresh,logout,password/forgot,password/reset}`, `/healthz`, `/readyz`, `/billing/revenuecat` (secret-authenticated) and `/metrics` (bearer, 404 when unset). The admin routers apply `requireAdmin` with the role loaded from the DB.
- **IDOR**: every `:id` route I checked (quests, gym, finance, custom-domains, seasons, clans, duo, rivals, challenges) scopes by `req.user.id`, and `ownership.test.ts` covers this.
- **SQL injection**: the only `sql.raw` (`services/raids.ts`) takes constant column names. Everything else is parameterised.
- **SSRF**: outbound fetches go only to fixed hosts (`api.resend.com`, `api.revenuecat.com/v1/subscribers/<encodeURIComponent>`, `exp.host`, and the Gemini SDK).
- **Secrets in logs**: pino redacts `authorization` and cookies, the request serializer logs only id, method and path, the log mailer redacts codes outside dev/test, push logs carry counts only, and Resend errors log the status only.
- **Timing-safe compares**: email codes, webhook secret and metrics token all use `timingSafeEqual`.
- **helmet**: on (now asserted by a test), and `x-powered-by` is disabled.
- **Error leakage**: the final handler always sends a generic 500 body and never a stack.
- **Randomness**: refresh tokens use `randomBytes(32)`, codes use `randomInt`, and clan invites use 8 characters from a 32-symbol alphabet (`randomInt`).

## 3. `pnpm audit --prod`

**Before**: 105 vulnerabilities (5 low, 33 moderate, **64 high, 3 critical**).
High/critical packages: `proxy-addr` (critical, through express), `path-to-regexp` (express router), `ws` (`@google/genai` and the Expo/RN toolchain), `shell-quote` (critical), `tar` (critical), `undici`, `picomatch`, `brace-expansion`, `js-yaml`, `postcss`, `nanoid`, `browserslist`, `@xmldom/xmldom`, `source-map-js`, `compression`, `node-forge`, `braces`, `image-size`.

**Fix**: same-major `overrides` in `pnpm-workspace.yaml` for proxy-addr, path-to-regexp, ws (6/7/8), picomatch (2/4), shell-quote, undici 6, brace-expansion (1/2/5), js-yaml (3/4), tar 7, postcss, nanoid 3, browserslist, @xmldom/xmldom (0.8/0.9), source-map-js and compression. All typechecks, the app tests and the server suite pass on the new tree.

**After**: 13 vulnerabilities (2 low, 7 moderate, **4 high, 0 critical**). Unresolved, with reasons:
- `image-size` 1.2.1 (2 advisories, high: DoS through a parser infinite loop). Path: `react-native > @react-native/community-cli-plugin > metro > image-size`. The fix exists only in 2.0.3, a major version with a changed API, and metro depends on 1.x. Forcing it would risk breaking the bundler. Exposure: build-time only (metro reads the project's own images), so it is not in the API image or the app binary.
- `node-forge` 1.4.0 (high: PKCS#1 v1.5 signature check). Path: `expo > @expo/cli > @expo/code-signing-certificates`. The advisory names >=1.4.1, but **no such version is published** (1.4.0 is the latest), so there is nothing to override to. Exposure: Expo CLI code-signing at build or dev time only.
- `braces` 3.0.3 (high: stack exhaustion on deeply nested patterns). Path: `metro > metro-file-map > micromatch > braces`. The advisory names >=3.0.4, which is **not published**. Exposure: build-time globbing over the repo's own patterns.

None of the remaining findings are in `artifacts/api-server`'s runtime dependency tree.

## 4. Parked hygiene

| Item | Change | Test (red first) |
|---|---|---|
| a) Real sleeps | `signAccessToken({ now })` and `verifyAccessToken({ now })` use jose's `currentDate`, so the 2.1 s sleep is gone. Also fixed: `routes/push.test.ts` (15 ms sleep replaced with backdating `last_seen_at`), `lib/shutdown.test.ts` (50 ms sleep replaced with waiting for the handler to be entered), `lib/db/src/migrate.test.ts` (700 ms sleep replaced with polling `pg_locks` until the migrator is waiting on the advisory lock), and the app's `lib/api/client.test.ts` "5 concurrent 401s" (20 ms sleep replaced with a gate that opens after the 5th 401). The remaining short sleeps only keep work in flight (outbox ordering) or are bounded polls, and CPU load cannot make them fail. | `auth-core.test.ts`: the expiry check runs with an injected clock. |
| b) Timezones against Postgres | `services/timezone.ts` `postgresKnowsTimezone` runs `select now() at time zone $1` outside any transaction; a `22023` error means false, and known-good answers are cached. It is enforced at `POST /auth/register`, `PATCH /auth/me` and `POST /onboarding`, the only places that write `users.timezone`. The 400 body is `{ error, code: "invalid_timezone", issues: [{ path: "timezone" }] }`, so the app's existing "retry with a fallback zone" paths (`rejectsOnlyTimezone`, `submitOnboardingWithFallback`) still trigger. Injectable through `createApp({ timezoneKnown })`. | `services/timezone.test.ts` (real Postgres), and `onboarding.test.ts` covers all three writers, with nothing written. |
| c) analytics_events retention | `pruneAnalyticsEvents` (90 days, batches of 1000, at most 5 per tick) runs in the worker tick in its own try/catch, plus a new index `analytics_events_created_idx`. | `jobs/prune.test.ts`: bounded batches, keeps recent rows, runs in the tick even when the push prune throws. |
| d) Orphaned gym sessions | Sessions start at `POST /gym/sessions` and finish at `POST /gym/sessions/:id/complete`; the finish path is the only one that scores. New column `workout_sessions.abandoned_at` and a partial index on open sessions by `started_at`. `closeAbandonedGymSessions` (worker tick, bounded, `for update skip locked`) stamps `completed_at = abandoned_at = now` and `points = 0` on sessions open for more than 12 h. **Rank-neutral option chosen**: no score event, `gym_session` log, PR or body-part points are written, so the rank, the streak and "activity" are all untouched. `completed_at` is set so the app stops showing the session as in progress (no app change needed). The two "completed sessions" counts (past-self `gym.sessionsTotal`, the comeback home-path offer) exclude abandoned sessions through `finishedSession()`. A late `/sets` or `/complete` call gets 409 `session_abandoned`. | `jobs/gym-abandon.test.ts`. |
| e) Push token on session expiry | App: `actions.sessionExpired()` calls `forgetPushToken()` (removes the AsyncStorage key, no server call) and never throws. `AuthContext` calls it from `onSessionExpired`. Server: the refresh-token table is `refresh_tokens`. `pruneOrphanedPushTokens` deletes `push_tokens` (with `last_seen_at` more than 30 d old) for users with no `refresh_tokens` row that was valid within the last 30 days, where a row stopped being valid at `least(expires_at, revoked_at)`. It is bounded and runs in the worker tick. | App `lib/auth/actions.test.ts`. Server `jobs/prune.test.ts` covers the live, recently-revoked and stale users, the batching, and the tick. |
| f) `billing_events.received_at` index | `billing_events_received_idx`, migration `0038_jittery_post.sql`. | `prune.test.ts` asserts both retention indexes through `pg_indexes`. |
| g) Worker metrics listener | `server.on("error")` logs and does not crash. A `registry.metrics()` failure answers 500. `closeWorkerMetricsServer` is awaited in `worker.ts` after `runLoop` returns on shutdown. | `worker-metrics.test.ts`: EADDRINUSE goes to `onError` with no uncaught exception, and close resolves. |
| h) Push send budget | New `PUSH_SEND_BUDGET_MS` (default 15 s). `deliverPushes` times sending from its own start against `sendBudgetMs`. `PUSH_JOB_BUDGET_MS` now bounds only the decide phase, and `dispatchPushes` and `runNotificationJobs` no longer hand the decide start time to the send phase. | `notifications.test.ts`: a decide phase that used up its budget does not starve 250 messages, and the send budget still caps sending. |

Migrations: `0038_jittery_post.sql` adds the two retention indexes. `0039_fearless_morgan_stark.sql` adds `workout_sessions.abandoned_at` and `workout_sessions_open_started_idx`. Both are additive. The `CREATE INDEX` is not `CONCURRENTLY` because drizzle runs migrations in a transaction, so on a large `analytics_events` it holds a short write lock during deploy.

## 5. Tests and verification

Red-first evidence (each failed before its implementation):
- `env.test.ts`: `formatEnvError` not exported, then the CORS, DATABASE_URL, JWT_SECRET_PREVIOUS and DB_POOL_MAX cases and the boot subprocess test (`production boot without CORS_ORIGIN exits 1 with a clear message`).
- `pool.test.ts`: `poolMaxFromEnv` not exported.
- `auth-core.test.ts`: `accessTokenSecrets` not exported (rotation test, clock injection).
- `app-factory.test.ts`: 3 of 8 red (101 KB to 413, malformed JSON to 400, strict CORS).
- `timezone.test.ts` and `onboarding.test.ts`: module missing, and the new route test failed.
- `prune.test.ts`: `ANALYTICS_EVENT_TTL_MS` and `pruneOrphanedPushTokens` missing.
- `gym-abandon.test.ts`: `ABANDON_GYM_SESSION_AFTER_MS` missing.
- `worker-metrics.test.ts`: `closeWorkerMetricsServer` missing.
- `notifications.test.ts`: send budget, unsent 150 against 0 expected.
- App `actions.test.ts`: `sessionExpired is not a function`.

`freeform.test.ts` "a 4 MB upload is not caught by the global 100 KB body limit" is a regression guard. It passed before and after, because `express.json` only reads `application/json`; the explicit `skipVoice` makes that independent of content type.

Runs:
- `pnpm run typecheck:libs`, the server typecheck and the app typecheck: clean.
- App tests: 341/341.
- Full server suite (one run): **incomplete**. Claude Code stopped it partway because system memory was critically low (not a test failure). By then 189 tests had passed and 0 had failed. Per the harness it was not restarted, so it needs a rerun. Every file touched by this task was also run on its own, serially, and passed: env, pool, auth-core, app-factory, freeform voice, onboarding, timezone, prune, gym-abandon, gym, progress, comeback, notifications, push, shutdown, worker-metrics, migrate.
- `lib/db`: `migrate.test.ts` and `pool.test.ts` pass (3/3).
- Root `pnpm run build`: passes (typecheck plus api-server bundle).

## 6. Concerns

- **The full server suite has not completed** (memory-pressure kill, see section 5). Rerun `pnpm test` in `artifacts/api-server` once before merging.

- The admin adherence metrics accept `days` up to 365, but `floor_offered` and `floor_completed` now count at most 90 days of analytics events. The rest of that endpoint reads non-pruned tables.
- With both budgets and Expo's 10 s request timeout, a worst-case worker tick takes about 15 + 15 + 10 s of push work on top of rollover. That is still under the worker's 60 s exit backstop, but closer to it.
- The `SessionSchema` contract is unchanged: abandoned sessions look like completed 0-point sessions to the app. An `abandonedAt` contract field would be a small follow-up if the UI should label them.
- Rate-limit stores are per process (finding 8).

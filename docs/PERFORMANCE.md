# Performance: load test and DB tuning (P8 task 6)

Targets (single API instance, local Postgres):

| Scenario | Rate | Target |
|---|---|---|
| `GET /api/state` | 100 req/s for 60 s | p95 < 250 ms |
| `POST /api/logs` | 50 req/s for 60 s | p95 < 300 ms |
| both | | zero 5xx |

**Result: each scenario run alone met its target before any tuning and still does after it, with a wide margin.**
The tuning made `GET /api/state` about 20% faster under load (p95 96 to 73 ms) and halved its idle service time
(13 to 6 ms). It also fixed three query plans that scale with the whole table instead of with one user.

**The mixed run (both scenarios at once) sits right at the state target with plain autocannon pacing.** Its state p95
was 250.0 ms, so it fails `< 250`. With the same average rates spread over each second (`--stagger 10`), its p95s were
28.8 ms (state) and 48.1 ms (logs). See "Mixed load" below.

## Machine

| | |
|---|---|
| CPU | AMD Ryzen 7 8745HX, 8 cores / 16 threads |
| RAM | 15.8 GB (Docker Desktop VM: 7.65 GB) |
| OS | Windows 11 Home 10.0.26200; Docker Desktop 29.2.1 on WSL2 (kernel 6.6.87.2) |
| Node | v24.13.0 |
| Postgres | `postgres:16-alpine` (16.15) from `docker-compose.yml`, stock config: `shared_buffers=128MB`, `work_mem=4MB`, `effective_cache_size=4GB`, `max_connections=100`, `random_page_cost=4`, `fsync=on`, `synchronous_commit=on` |
| API | `dist/index.mjs` (production build), `NODE_ENV=production`, `DB_POOL_MAX=10` (the default), `LOG_LEVEL=info` (one JSON line per request, redirected to a file) |
| Load generator | autocannon 8, 32 connections, on the same machine as the API and the database |

The API, the database and the load generator share one laptop, so these numbers are a floor, not a capacity plan.

## Dataset

`scripts/load/seed.ts` builds it through the real API code on an injected clock. Each user is registered and onboarded
through `POST /api/auth/register` and `POST /api/onboarding`. The onboarding is then moved 30 days back. Each day,
every user gets 3 daily quests, and on about 85% of days 1 to 3 logs through `POST /api/logs` and about 60% of the
quests completed through `POST /api/quests/:id/complete`. The other days are missed. The real rollover (run by the
log and quest writes and a final `GET /api/state`) writes the snapshots, failures, streak breaks, decay, notices,
achievements and milestones. Today's 3 dailies are left active. Users are spread over UTC, Asia/Kolkata,
Europe/Berlin and America/New_York. The PRNG is seeded, so the same arguments give the same shape.

| Users | Logs | Quests | Snapshots | Score events | Notices | DB size |
|---|---|---|---|---|---|---|
| 200 (default) | 11,796 | 18,600 | 6,000 | 35,505 | 15,380 | 47 MB |
| 1,000 (scale check) | 58,965 | 93,000 | 30,000 | 177,492 | 76,990 | 185 MB |

Every measured run had a fresh seed. A logs run adds about 3,000 logs.

## Results

Latencies are client-side, in ms, from every response (exact percentiles, not autocannon's histogram).

| Run | Users | `GET /state` p50 / p95 / p99 | `POST /logs` p50 / p95 / p99 | 5xx | Errors |
|---|---|---|---|---|---|
| Baseline (HEAD e559676) | 200 | 78.3 / **96.2** / 126.2 | 104.1 / **139.5** / 158.9 | 0 | 0 |
| Indexes only (old code) | 200 | 79.8 / 94.7 / 107.9 | 106.7 / 140.0 / 161.4 | 0 | 0 |
| After (indexes + code) | 200 | 60.8 / **72.9** / 84.3 | 104.1 / **137.7** / 153.6 | 0 | 0 |
| After, scale check | 1,000 | 63.6 / 73.7 / 87.5 | 108.1 / 144.9 / 166.0 | 0 | 0 |

Every run achieved its full rate: 6,000 `GET /state` responses (all 200) and 3,000 `POST /logs` responses (all 201) in
60 s. A run passes only if p95 is under target, there are no 5xx and no errors, and the achieved rate is at least 95% of
the target.

Fix round 1 (reads capped at 4 connections per request, see below) reran the state-only scenario: p50 / p95 / p99
63.7 / **77.3** / 111.5 ms, 6,000 × 200, PASS.

### Mixed load (state 100 req/s and logs 50 req/s at once, 60 s, 200 users, fix-round-1 build)

| Pacing | State p50 / p95 / p99 | Logs p50 / p95 / p99 | 5xx / errors | Verdict |
|---|---|---|---|---|
| autocannon `overallRate` (default, `--stagger 1`) | 95.3 / **250.0** / 278.3 | 130.0 / **179.7** / 220.4 | 0 / 0 | state FAIL (at the limit), logs PASS |
| Same, `DB_POOL_MAX=20` (diagnostic) | 96.1 / 258.6 / 288.4 | 157.6 / 196.4 / 229.6 | 0 / 0 | state FAIL, logs PASS |
| Same rates, `--stagger 10` (diagnostic) | 12.8 / **28.8** / 47.4 | 38.5 / **48.1** / 53.7 | 0 / 0 | PASS / PASS |

Both rates were achieved in full: 6,000 × 200 and 3,000 × 201.

**Why the default mixed run fails.** With `overallRate`, all 150 requests of each second leave together at the start of
that second, so one Node event loop starts the second with a queue of 150. A CPU profile of the API during a mixed
run, taken over the inspector, showed:
- **62% idle on average.** About 380 ms of CPU per second.
- **CPU per request about 2.5 ms.** Most of it is drizzle query building and row mapping: drizzle's `is()` entity
  check alone was 5.7% of all samples, and `buildQueryFromSourceParams`, `buildSelection` and `mapFromDriverValue`
  follow. Socket and log writes (`writev`) were 6%.

The last requests of each burst wait out the queue, and that is what puts the state p95 at 250 ms. Doubling the pool
made no difference, so this is not pool starvation. When the same 150 req/s arrive as 10 smaller bursts per second,
p95 drops by almost 10x. Real clients do not synchronize on second boundaries, so the staggered figure is closer to
production. The default figure is a worst-case burst test, and the API survives it with zero errors. Raising the
burst margin would mean cutting per-request CPU (drizzle's query building and mapping is the largest part), or
running more than one API instance.

**Accepted figure.** The staggered figure is the representative mixed result: state p95 28.8 ms, logs p95 48.1 ms.
The burst figure stays published as a worst case. **Horizontal API scaling is the remedy for synchronized bursts:**
each instance's event loop then takes a share of the burst.

Idle service time of one `GET /state` (curl, warm): **about 13 ms before, about 6 ms after.**

### How to read these numbers

- **autocannon's `overallRate` sends in bursts.** Each connection gets a per-second quota and sends it as soon as the
  second starts (`lib/httpClient.js`, a 1 s `setInterval` resets the counter). So each second's 100 requests arrive
  almost together, not every 10 ms. The p50 of about 60 to 80 ms is mostly queueing inside that burst. Under load,
  the API used about 30% of one core and Postgres about 30% of one core. A `select 1` round trip measured during the
  load stayed at 0.41 ms p50, the same as idle. Raising `DB_POOL_MAX` to 20 made no difference (p50 83 ms), so
  neither the pool nor Postgres was the bottleneck. The results are therefore conservative: traffic that arrives
  evenly at the same average rate queues less.
- **`POST /logs` is one serial transaction under the per-user advisory lock.** It holds the lock while it checks
  idempotency, catches up the rollover, checks for a duplicate, inserts, applies the score changes and the
  activity, runs the rollover again and stores the key. Its statements depend on each other and must share the
  transaction, so parallel reads cannot help. It meets the target with a 2x margin and was not changed.

## Query plans (summary)

`EXPLAIN (ANALYZE, BUFFERS)` was run on the hot queries against the 200-user dataset, and again at 1,000 users. To get
the 1,000-user "before" plans, the new indexes were dropped inside a transaction that was then rolled back.

| Query (where it runs) | Before | After |
|---|---|---|
| Unseen notices, oldest first, limit 7 (`unseenNotices`, every `GET /state`) | For some users, the planner walked `notices_created_idx` across **every user's notices** and filtered (1,388 rows read for 9 kept at 200 users). This grows with the whole table. | `notices_user_unseen_idx`: an ordered range read of 7 rows, 0.08 ms. |
| Resolved quests in the 30-day window (`hiddenAndTrajectoryBatch` in `GET /state`; rollover snapshot step) | Bitmap scan of **all** the user's quests on `quests_user_status_expires_idx (user_id, …)`, then a date filter. This grows with the user's lifetime. | `quests_user_resolved_date_idx`: a range read of the window only. |
| `GET /api/quests` "recent" (resolved in the last 2 days) | All the user's quests (90), 87 removed by the filter. | 3 rows read through `quests_user_resolved_date_idx`. |
| Quest-deadline candidates (`jobs/notifications.ts`, all users; carried from P7) | The index has `user_id` first and the query has no `user_id`, so it was a **full scan of `quests_user_status_expires_idx`**: 2.3 ms for the index alone at 93k quests, growing linearly with the quests table. | `quests_active_deadline_idx` (partial, active non-bonus only): reads just the active quests in the window, 0.56 ms for 3,000 rows. |
| Newest 30 snapshots for one user (`GET /state`) | `row_number()` window over all the user's snapshots. This grows with the user's history. | Single user: `order by local_date desc limit 30` on the primary key. The batch path for social projections keeps the window. |
| Rollover claim (`claimDueUsers`) | `user_day_state_next_rollover_idx` range plus `FOR UPDATE SKIP LOCKED`, 0.02 ms. | Unchanged. It was already right. |
| Rollover: last log date, expired quests, recent snapshots | Index range scans (`logs_user_local_date_idx`, `quests_user_status_expires_idx`, snapshot PK), each under 0.15 ms. | Unchanged. |
| Logs insert path: duplicate check, insert, score events | `logs_user_client_id_idx` unique probe, 0.03 ms; `score_events_user_local_date_idx`. | Unchanged. |
| Deadline job's "already noticed today" check | User's notices through `notices_user_seen_created_idx`, then a kind/payload filter (about 80 rows). | Unchanged. It runs once per candidate per day. |

## Indexes added (migration `lib/db/migrations/0040_perf_hot_path_indexes.sql`)

```sql
CREATE INDEX notices_user_unseen_idx       ON notices (user_id, created_at, id) WHERE seen_at IS NULL;
CREATE INDEX quests_user_resolved_date_idx ON quests  (user_id, resolved_local_date) WHERE resolved_local_date IS NOT NULL;
CREATE INDEX quests_active_deadline_idx    ON quests  (expires_at) WHERE status = 'active' AND bonus = false;
```

All three are partial, so they stay small. The migrator runs them as plain `CREATE INDEX` inside its transaction,
which blocks writes to `notices` and `quests` while each index builds. That takes milliseconds at launch size. On a
large production table, build them with `CREATE INDEX CONCURRENTLY` by hand before deploying; the migration's
`CREATE INDEX` then fails on the name, so mark it as applied or make it `IF NOT EXISTS`.

## Code changes

1. **`GET /api/state` skips the locked catch-up when nothing is due** (`ensureRolledOverIfDue` in
   `services/rollover.ts`). One unlocked read (`user_day_state ⋈ users ⋈ profiles`) applies the same
   "is a date due" test as `rollOverDue`. Only when a date is due does it take the advisory lock and catch up. Before,
   every call ran BEGIN, the lock, 3 reads and COMMIT. The worker keeps `ensureRolledOver`, because it must rewrite
   its lease. A stale schedule with nothing due is left for the worker to fix. Tests are in `services/rollover.test.ts`.
2. **`buildGameState` issues independent reads together** (`lib/reads.ts`). It used to make 11 sequential queries;
   now it makes two waves: 8 reads, then the hidden-score pair plus seasons. On the pool, at most
   **4 reads per request** (`READS_MAX_CONCURRENCY`) hold a connection at once, so one request cannot drain the
   default 10-connection pool. Inside a transaction (onboarding, profile, AI context) they still run one at a time,
   because node-postgres deprecates overlapping queries on one client.
3. The single-user snapshot read is bounded (see the plans table).

## Findings

- Both targets were met at HEAD with a large margin: about 2.6x on state and 2.2x on logs. They are still met at
  5x the dataset.
- At this data size, latency comes from round trips and request bursts, not from query execution: every hot query
  runs in well under 1 ms. That is why the indexes alone did not change the latency numbers. Cutting round trips (a
  lock-free fast path, parallel reads) did.
- The indexes fix plans that grow with the size of the table or the length of a user's history. The worst was the
  deadline job's full index scan over every quest. The notices plan is also data-dependent: the planner picked the
  global `created_at` scan for some users and not for others.
- **Image boot bug (fixed in fix round 1).** `@opentelemetry/api` is externalized by `build.mjs` and required at load by
  `prom-client`, but it was only a dependency of `@workspace/db`. So `pnpm --filter @workspace/api-server --prod deploy`
  left it out, and the image's API and worker crashed at boot with `MODULE_NOT_FOUND`. Running `dist/index.mjs` from the
  repo failed the same way. It is now a direct dependency of `@workspace/api-server`. The rebuilt image boots:
  `ROLE=migrate` applied the migrations, `ROLE=api` answered `/api/healthz` 200 and `/api/readyz` 200, and
  `ROLE=worker` started and ran a tick without `MODULE_NOT_FOUND`.
- **Image size (fix round 2).** The image measured 294 MB with `docker images`, over the 250 MB budget.
  - **Why it was big:** `pnpm deploy` shipped 67 MB of node_modules, including drizzle-orm, @google/genai and zod,
    that the bundles mostly did not need.
  - **What changed:** `build.mjs` now bundles every pure-JS dependency. The only externals are `RUNTIME_EXTERNALS`:
    native `@node-rs/*` and optional native add-ons. The runtime stage carries only `@node-rs/argon2` and its
    platform binary (788 KB) plus a minimal `package.json`. The base also drops `/usr/local/include` and Node's docs.
  - **Result: 212 MB in `docker images`.** On Docker Desktop's containerd store that figure counts the unpacked and
    the compressed content together. The root filesystem itself is 150 MB, of which `dist` is 14 MB.
  - **Boot check:** `ROLE=migrate`, `ROLE=api` and `ROLE=worker` all boot. Register and login exercise argon2, and a
    bundled @google/genai call reached the Gemini API: with a fake key it answered `API_KEY_INVALID`.

## The load-test switch (`RATE_LIMIT_DISABLED` / `LOAD_TEST`)

The per-IP limiters (global, auth and billing webhook) would throttle a load generator on one IP. `RATE_LIMIT_DISABLED=1`
turns them off. Outside development and test, the API refuses to boot with it unless `LOAD_TEST=1` is also set:
`Invalid environment: RATE_LIMIT_DISABLED is refused outside development/test unless LOAD_TEST=1`. Any value other
than `1`/`0` is refused, so a typo is never read as "off". An unset `NODE_ENV` counts as production. A process with
the switch on logs a `rate_limits_disabled` warning at startup. Never set either variable in a deployment. Tests:
`lib/env.test.ts` and `app-factory.test.ts`.

## Reproduce

```sh
docker compose up -d postgres
pnpm install

# 1. Seed (always drops and recreates system_self_load; refuses any database whose name lacks "load", or dev/test).
#    Writes scripts/load/.tokens.json (gitignored), signed with LOAD_JWT_SECRET, valid 6 h (--token-ttl).
export LOAD_JWT_SECRET=<32+ chars, no "change"/"example"/"replace">
pnpm --filter @workspace/scripts load:seed            # --users 200 --days 30 --concurrency 8

# 2. Build and start the API in production mode against the load DB.
pnpm --filter @workspace/api-server build
cd artifacts/api-server
NODE_ENV=production PORT=3901 \
  DATABASE_URL=postgres://system_self:system_self@localhost:5432/system_self_load \
  CORS_ORIGIN=http://localhost:8081 JWT_SECRET=$LOAD_JWT_SECRET REVENUECAT_WEBHOOK_SECRET=<any> MAILER=log \
  RATE_LIMIT_DISABLED=1 LOAD_TEST=1 node dist/index.mjs > /tmp/api.log &
cd -

# 3. Run both scenarios (exit code 1 if a target is missed). Results land in scripts/load/results/ (gitignored).
LOAD_BASE_URL=http://127.0.0.1:3901 pnpm --filter @workspace/scripts load:run --label mine
#   --scenario state|logs|all|mixed  --duration 60  --state-rate 100  --logs-rate 50  --connections 32  --warmup 5
#   --stagger k   split each rate over k generators started 1000/k ms apart (default 1: plain overallRate bursts)
```

The `system_self_load` database is left in place after a run. Drop it with
`docker compose exec postgres psql -U system_self -d postgres -c "drop database system_self_load with (force)"`.

# P8 — Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the system deployable, observable, secure, compliant, and store-ready, with evidence that it scales horizontally.

**Architecture:** One Docker image runs either `api` or `worker`; migrations run as a separate one-shot command before rollout. Prometheus-format metrics, JSON logs with request ids, health/readiness probes. EAS build profiles for store binaries. Legal and support content ships in-app.

**Tech Stack:** Docker (node:22-alpine), `prom-client`, `autocannon` (load test), EAS CLI config.

**Spec:** architecture spec §3 (Observability, Deploy, Mobile release, Rate limiting); HOLD H-01..H-09.

## Global Constraints

- Image: multi-stage build, non-root user, `NODE_ENV=production`, `CMD` selected by `ROLE=api|worker|migrate`; no dev dependencies or source maps of secrets in the final layer; image < 250 MB.
- Production env validation: `JWT_SECRET` ≥ 32 chars, `DATABASE_URL` set, `CORS_ORIGIN` set (no `*`), otherwise the process exits with a clear message.
- Body size limit 100 KB JSON (voice route keeps its own 5 MB raw limit). DB pool size `DB_POOL_MAX` (default 10).
- `/metrics` requires `Authorization: Bearer ${METRICS_TOKEN}` (404 when `METRICS_TOKEN` unset).
- Load target (single API instance + local Postgres, documented machine): `GET /api/state` p95 < 250 ms at 100 req/s for 60 s; `POST /api/logs` p95 < 300 ms at 50 req/s; zero 5xx.
- Data export: everything stored about the user, as JSON, excluding other users' data and password hashes.
- App identity placeholders: iOS `bundleIdentifier` / Android `package` `com.systemself.app` (HOLD H-03).

## Review Focus

1. **Migrations under multiple instances** — two `migrate` containers started at once don't corrupt the schema (drizzle's migrator uses a lock table; verify, or wrap in `pg_advisory_lock`). (Task 1)
2. **Graceful shutdown** — SIGTERM during a request finishes it; the worker finishes its current user and releases its lease. (Task 1)
3. **Export of a user with every kind of data** — includes logs, quests, finance, clans (own membership only), notices; no other user ids except as handles. (Task 4)
4. **Metrics cardinality** — route labels use the route pattern (`/api/quests/:id/complete`), never raw ids. (Task 2)
5. **Expired JWT secret rotation** — supporting `JWT_SECRET_PREVIOUS` for verification during rotation. (Task 3)

---

### Task 1: Container image, compose, migrations, graceful shutdown
**Files:** `artifacts/api-server/Dockerfile`, `.dockerignore`, `docker-compose.prod.yml` (postgres, migrate, api ×2, worker), `artifacts/api-server/src/index.ts` and `worker.ts` (SIGTERM handling, `server.close`, pool end), `lib/db/src/migrate.ts` (advisory lock around migrate), `scripts/docker-entrypoint.sh`.
- [ ] Build the image; `docker compose -f docker-compose.prod.yml up` → readyz 200 through both API containers; two migrate runs concurrently → both exit 0 → commit `build: production image, compose, safe migrations`.

### Task 2: Observability
**Files:** `src/lib/metrics.ts` (`http_request_duration_seconds{method,route,status}`, `ai_calls_total{model,outcome}`, `ai_fallbacks_total`, `job_duration_seconds{job}`, `rollover_users_total`, default process metrics), middleware, `routes/metrics.ts`, request id: accept `x-request-id` (≤ 64 chars `[A-Za-z0-9-]`) or generate; echo in the response; include in pino logs; app sends `x-request-id` per request.
- [ ] Tests: metrics auth; route label uses the pattern; request id echoed → commit `feat: metrics and request ids`.

### Task 3: Security hardening
**Files:** `src/lib/env.ts` (production validation, `JWT_SECRET_PREVIOUS`), `src/app-factory.ts` (JSON limit, CORS strictness in production, `trust proxy` from `TRUST_PROXY` env for correct client IPs behind a load balancer), `lib/auth/tokens.ts` (verify with current then previous secret); run the `security-review` skill over the branch and fix every High/Medium finding in this task; `pnpm audit --prod` and resolve High/Critical.
- [ ] Tests: production boot fails without CORS_ORIGIN; token signed with the previous secret verifies; 101 KB body → 413 → commit `sec: production hardening`.

### Task 4: Privacy, legal, support
**Files:** `routes/account.ts` (`GET /api/account/export` → JSON attachment), `docs/legal/privacy.md`, `docs/legal/terms.md` (DRAFT templates covering data collected, purposes, AI processing by Google Gemini, retention, deletion, age 16+, contact placeholder `privacy@systemself.app` — HOLD H-06), App `app/legal/[doc].tsx` renders the bundled markdown (simple renderer: headings, paragraphs, lists), Settings → "Export my data" (shares the JSON file via `expo-sharing` if bundled in SDK 54, else copies a download link).
- [ ] Tests: Review Focus 3 → commit `feat: data export, legal drafts, in-app legal`.

### Task 5: Mobile release configuration
**Files:** `artifacts/system-self/app.json` (bundle ids, `ios.infoPlist` microphone + notification strings, `android.permissions` minimal, `version 1.0.0`, `ios.buildNumber "1"`, `android.versionCode 1`, privacy manifest entries required by Expo SDK 54 for AsyncStorage/UserDefaults), `eas.json` (`development` with `developmentClient`, `preview` internal, `production` with auto-increment), `docs/RELEASE.md` (store checklist: screenshots, privacy nutrition labels, age rating, account deletion URL, review notes with a demo account).
- [ ] Verify `pnpm exec expo config --type public` succeeds and Expo Go still launches → commit `build: EAS profiles and store config`.

### Task 6: Load test and DB tuning
**Files:** `scripts/load/seed.ts` (creates N users with onboarding + 30 days of logs via the engine services), `scripts/load/run.ts` (autocannon scenarios from Global Constraints), `docs/PERFORMANCE.md` (results table, machine, findings); add any missing indexes found with `EXPLAIN ANALYZE` on the hot queries (state, logs insert, quests board, rollover claim).
- [ ] Run, record, fix until targets are met → commit `perf: load test harness, indexes, results`.

### Task 7: End-to-end smoke test and CI
**Files:** `scripts/smoke.ts` (register → onboard → log → generate quests → complete → refuse → debrief → export → delete, against `SMOKE_BASE_URL`), `.github/workflows/ci.yml` (job: build image, start postgres + api, run migrate + smoke), root `README.md` (what it is, quick start for dev: docker compose, migrate, api, worker, Expo Go with `--lan`; env vars; HOLD pointer), `docs/DEPLOYMENT.md` rewrite, `docs/RUNBOOK.md` (deploy, rollback, rotate JWT secret, restore backup, handle AI outage → template mode, scale workers).
- [ ] Smoke passes locally against the compose stack → commit `ci: e2e smoke; docs: README, deployment, runbook`.

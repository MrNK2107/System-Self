# P1 — Platform & Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the API real user accounts, a migration-managed Postgres schema, an integration-test harness, and a key-optional AI layer, so later phases can store per-user game state.

**Architecture:** Postgres (Docker locally, service container in CI) with drizzle-kit SQL migrations. Email/password accounts with Argon2id, short-lived JWT access tokens, and rotating hashed refresh tokens with reuse detection. Existing AI-output tables move from `username` text to `user_id` FKs. The API is created by a factory `createApp()` so tests can boot it without listening.

**Tech Stack:** Express 5, drizzle-orm 0.45 + drizzle-kit 0.31, pg, `@node-rs/argon2`, `jose`, `@google/genai`, zod 3, `node:test` via `tsx`, `supertest`.

**Spec:** `docs/superpowers/specs/2026-10-19-production-architecture-design.md` (§2, §3). The decisions marked "(my call)" there are binding.

## Global Constraints

- Node ≥ 22, pnpm 11.5.2. All new deps go through `pnpm add` in the owning package. Respect `minimumReleaseAge: 1440`; if a version is too new, pin the previous one.
- `@node-rs/argon2` must be added to the esbuild `external` list in `artifacts/api-server/build.mjs` (native module). `@node-rs/*` is the pattern.
- Passwords: min 10, max 128 chars. Usernames: `^[a-z0-9_]{3,20}$`, stored lowercase, unique. Emails stored trimmed + lowercased, unique.
- Access token: HS256 JWT, 15 min, claims `{ sub: userId, role, ver: tokenVersion }`, issuer `system-self`. Secret `JWT_SECRET` (≥ 32 chars, required when `NODE_ENV=production`; dev/test default `dev-insecure-secret-change-me-0123456789`).
- Refresh token: 32 random bytes base64url, stored only as SHA-256 hex, 30-day expiry, rotated on every use; reuse of a revoked token revokes its whole `family_id`.
- Age floor: `birthYear` must make the user ≥ 16 in the current year (`currentYear - birthYear >= 16`). `acceptTerms` must be `true`.
- Error body shape is always `{ error: string, code?: string, issues?: [...] }`.
- Tests that need the DB use `TEST_DATABASE_URL`; when it's unset they are **skipped** (not failed) with `test.skip`-style guard so `pnpm test` works without Docker.
- No `username` query/body param may decide ownership anywhere after this phase; ownership comes only from `req.user`.

## Review Focus

1. **Refresh replay** — the same refresh token used twice: the second call must 401 and revoke the family, so the newer token also stops working. (Task 3)
2. **Email case/whitespace** — `" Foo@Bar.com "` registers, and `foo@bar.com` logs in; registering `FOO@bar.com` again → 409. (Task 4)
3. **Login timing/user enumeration** — wrong password and unknown email return the identical 401 body `{ error: "Invalid email or password" }`. (Task 4)
4. **Deleted account** — after `DELETE /auth/account`, an old access token gets 401 (token version bump) and refresh fails. (Task 4)
5. **No DB configured** — with `DATABASE_URL` unset the server still starts; `/healthz` 200, `/readyz` 503, auth routes 503 `{ code: "db_unavailable" }`. (Task 5)

---

### Task 1: Dev database, migrations, test harness

**Files:**
- Create: `docker-compose.yml` (service `postgres`: image `postgres:16-alpine`, port `5432:5432`, user/password/db `system_self`, plus a second DB `system_self_test` created via an init script `scripts/db/init-test-db.sql`)
- Create: `lib/db/src/migrate.ts`, `lib/db/src/testing.ts`
- Modify: `lib/db/src/index.ts`, `lib/db/package.json`, `lib/db/drizzle.config.ts`
- Delete: `lib/db/src/schema/conversations.ts`, `lib/db/src/schema/messages.ts` (unused Replit template tables; remove their exports from `schema/index.ts`)
- Create: `lib/db/migrations/` (generated)
- Test: `lib/db/src/testing.test.ts`

**Interfaces:**
- Produces: `createDb(url: string): { db: NodePgDatabase<typeof schema>; pool: pg.Pool }`; existing exports `db`, `pool`, `hasDatabase` kept (built from `DATABASE_URL`); `export type Db = NodePgDatabase<typeof schema>`.
- Produces: `runMigrations(url: string): Promise<void>` (drizzle `migrate()` with `migrationsFolder` resolved relative to the file).
- Produces (`@workspace/db/testing`): `getTestDb(): Db | null` (null when `TEST_DATABASE_URL` unset; runs migrations once per process), `resetDb(db: Db): Promise<void>` (TRUNCATE every table in `public` except `__drizzle_migrations`, `RESTART IDENTITY CASCADE`).
- Scripts in `lib/db/package.json`: `generate` = `drizzle-kit generate --config ./drizzle.config.ts`, `migrate` = `tsx src/migrate.ts` (reads `DATABASE_URL`), `test` = `tsx --test src/**/*.test.ts`. `drizzle.config.ts` gets `out: "./migrations"` and no longer throws when `DATABASE_URL` is missing for `generate`.

- [ ] **Step 1:** Write `testing.test.ts`: `resetDb truncates rows` — skip if `getTestDb()` is null; insert a row into `system_messages` with raw SQL, call `resetDb`, assert count is 0.
- [ ] **Step 2:** `docker compose up -d postgres`, then run `TEST_DATABASE_URL=postgres://system_self:system_self@localhost:5432/system_self_test pnpm --filter @workspace/db test`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `createDb`, `runMigrations`, `getTestDb`, `resetDb`. Run `pnpm --filter @workspace/db generate` to produce the initial migration from the current schema (minus the deleted template tables).
- [ ] **Step 4:** Rerun the test → PASS. Also run without `TEST_DATABASE_URL` → test reported as skipped, exit 0.
- [ ] **Step 5:** Commit `feat(db): migrations, docker postgres, test harness`.

### Task 2: Accounts schema

**Files:**
- Create: `lib/db/src/schema/users.ts`
- Modify: `lib/db/src/schema/system_ai.ts`, `lib/db/src/schema/index.ts`
- Generate: new migration
- Test: `lib/db/src/schema/users.test.ts`

**Interfaces (tables, all PK `uuid` default `gen_random_uuid()` unless noted, timestamps `timestamptz`):**
- `users`: `id`, `email text unique not null`, `passwordHash text not null`, `username text unique not null`, `role text not null default 'user'` (`'user'|'admin'`), `emailVerifiedAt`, `birthYear integer not null`, `termsAcceptedAt not null`, `timezone text not null default 'UTC'`, `tokenVersion integer not null default 0`, `createdAt default now()`, `updatedAt default now()`.
- `refresh_tokens`: `id`, `userId → users.id on delete cascade`, `familyId uuid not null`, `tokenHash text unique not null`, `expiresAt not null`, `revokedAt`, `replacedById uuid`, `userAgent text`, `createdAt`. Index `(userId)`, `(familyId)`.
- `email_codes`: `id`, `userId → users cascade`, `purpose text not null` (`'verify'|'reset'`), `codeHash text not null`, `expiresAt not null`, `consumedAt`, `attempts integer not null default 0`, `createdAt`. Index `(userId, purpose)`.
- `system_messages`, `generated_quest_batches`, `generated_quests`, `quest_completion_events`: replace `username` with `userId uuid not null → users.id on delete cascade`. The unique index becomes `(userId, idempotencyKey)`. Add indexes `system_messages(userId, createdAt)`, `generated_quest_batches(userId, createdAt)`, `generated_quests(userId, createdAt, domain)`, `quest_completion_events(userId, completedAt, status, domain)`.
- Export inferred types `User`, `RefreshToken`, `EmailCode`.

- [ ] **Step 1:** Write `users.test.ts` (DB-guarded): `email unique` (second insert of the same email rejects with code `23505`); `deleting user cascades refresh_tokens and system_messages`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the schema, run `generate`. The migration must drop `username` columns (no production data exists).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(db): users, refresh tokens, email codes; key AI tables by user_id`.

### Task 3: Auth core library

**Files:**
- Create: `artifacts/api-server/src/lib/auth/passwords.ts`, `tokens.ts`, `refresh.ts`, `codes.ts`
- Modify: `artifacts/api-server/src/lib/env.ts` (add `JWT_SECRET`, `ACCESS_TOKEN_TTL_SEC` default 900, `REFRESH_TOKEN_TTL_DAYS` default 30, `DATABASE_URL` optional; remove `AUTH_ENABLED`, `API_AUTH_TOKENS`, `API_AUTH_REVOKED_TOKENS`, `ADMIN_API_TOKENS`, `AUTH_ROTATION_WARNING_DAYS` and their resolver functions; update the Gemini model defaults to `gemini-2.5-flash` / `gemini-2.5-flash-lite`)
- Modify: `artifacts/api-server/build.mjs` (externalize `@node-rs/*`)
- Test: `artifacts/api-server/src/lib/auth/auth-core.test.ts`

**Interfaces:**
- `hashPassword(plain: string): Promise<string>`, `verifyPassword(hash: string, plain: string): Promise<boolean>` (argon2id defaults).
- `signAccessToken(u: { id: string; role: "user" | "admin"; tokenVersion: number }): Promise<{ token: string; expiresAt: Date }>`; `verifyAccessToken(token: string): Promise<{ userId: string; role: "user" | "admin"; ver: number } | null>`.
- `issueRefreshToken(db: Db, userId: string, opts?: { familyId?: string; userAgent?: string }): Promise<{ token: string; id: string; expiresAt: Date }>`.
- `rotateRefreshToken(db: Db, token: string, userAgent?: string): Promise<{ ok: true; userId: string; token: string; expiresAt: Date } | { ok: false; reason: "invalid" | "expired" | "reused" }>`. Reuse = presented token's row has `revokedAt` set, which revokes every row in its family.
- `revokeRefreshFamilyByToken(db: Db, token: string): Promise<void>`, `revokeAllForUser(db: Db, userId: string): Promise<void>`.
- `createEmailCode(db: Db, userId: string, purpose: "verify" | "reset"): Promise<string>` (6 digits, 15-min expiry, invalidates earlier unconsumed codes of the same purpose); `consumeEmailCode(db, userId, purpose, code): Promise<"ok" | "invalid" | "expired" | "locked">` (locked after 5 attempts).
- `hashToken(t: string): string` (sha256 hex) in `tokens.ts`.

- [ ] **Step 1:** Write tests: `hash/verify roundtrip and wrong password false`; `access token roundtrip; tampered token → null; expired (ttl 1s, wait) → null`; DB-guarded: `rotate returns new token and old one becomes reused`; `reusing a rotated token revokes the family (new token then → invalid/reused)`; `email code: correct → ok, second use → invalid, 6th wrong attempt → locked`.
- [ ] **Step 2:** Run `pnpm --filter @workspace/api-server test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; `pnpm --filter @workspace/api-server typecheck` clean (fix existing references to removed env resolvers by stubbing them in Task 4's middleware rewrite. If needed, do this task and Task 4 back-to-back before committing).
- [ ] **Step 5:** Commit `feat(api): auth core (argon2, jwt, rotating refresh tokens, email codes)`.

### Task 4: Auth routes, middleware, ownership by user

**Files:**
- Create: `artifacts/api-server/src/routes/auth.ts`, `artifacts/api-server/src/lib/mailer.ts`, `artifacts/api-server/src/app-factory.ts`
- Rewrite: `artifacts/api-server/src/middlewares/auth.ts`, `artifacts/api-server/src/types/express.d.ts`, `artifacts/api-server/src/routes/admin.ts`
- Modify: `artifacts/api-server/src/app.ts` (becomes `export default createApp()`), `routes/index.ts`, `routes/system.ts`, `routes/history.ts`, `lib/schemas.ts` + `lib/schemas.test.ts` (drop `username` from bodies)
- Delete: `artifacts/api-server/src/lib/auth-audit.ts` (replace with `req.log.info({ event }, ...)` calls in the new middleware)
- Test: `artifacts/api-server/src/routes/auth.test.ts`, `artifacts/api-server/src/routes/ownership.test.ts`

**Interfaces:**
- `createApp(deps?: { db?: Db | null; mailer?: Mailer }): Express`. Defaults: `@workspace/db`'s `db`, and a mailer chosen by env. Middleware order as in the current `app.ts`, plus `authLimiter` (10 req / 15 min / IP) on `/api/auth/login|register|password/*|email/*`.
- `interface Mailer { send(msg: { to: string; subject: string; text: string }): Promise<void> }`; `createMailer(): Mailer` → Resend over `fetch` (`POST https://api.resend.com/emails`, `Authorization: Bearer ${RESEND_API_KEY}`, from `MAIL_FROM` default `SYSTEM // SELF <no-reply@systemself.app>`) when `RESEND_API_KEY` is set, else a log mailer (`logger.info({ to, subject, text })`). Tests inject a fake capturing messages.
- `req.user?: { id: string; role: "user" | "admin"; username: string }`; `requireAuth` (401 `{ error: "Unauthorized" }` when the token is missing/invalid, the user is missing, or `tokenVersion` ≠ `ver`); `requireAdmin` (403). Public: `/api/healthz`, `/api/readyz`, `/api/auth/register|login|refresh|password/forgot|password/reset`.
- Routes (all JSON; `AuthResponse = { user: PublicUser; accessToken: string; accessTokenExpiresAt: string; refreshToken: string }`; `PublicUser = { id, email, username, role, emailVerified: boolean, timezone, createdAt }`):
  - `POST /api/auth/register` `{ email, password, username, birthYear, acceptTerms: true, timezone? }` → 201 `AuthResponse`; 409 `{ code: "email_taken" | "username_taken" }`; sends a verify code email.
  - `POST /api/auth/login` `{ email, password }` → 200 `AuthResponse`; 401 `{ error: "Invalid email or password" }`.
  - `POST /api/auth/refresh` `{ refreshToken }` → 200 `AuthResponse`; 401 `{ code: "invalid_refresh" }`.
  - `POST /api/auth/logout` `{ refreshToken }` → 204 (revokes the family).
  - `GET /api/auth/me` → `{ user: PublicUser }`. `PATCH /api/auth/me` `{ timezone?, username? }` → `{ user }`.
  - `POST /api/auth/email/verify/request` → 204; `POST /api/auth/email/verify` `{ code }` → `{ user }` / 400 `{ code: "invalid_code" | "expired_code" | "locked" }`.
  - `POST /api/auth/password/forgot` `{ email }` → always 204 (sends a code if the user exists); `POST /api/auth/password/reset` `{ email, code, newPassword }` → 204, bumps `tokenVersion`, revokes all refresh tokens.
  - `POST /api/auth/password/change` `{ currentPassword, newPassword }` → 204, same revocation.
  - `DELETE /api/auth/account` `{ password }` → 204, deletes the user row (cascades). 401 if the password is wrong.
- `system.ts` / `history.ts`: every query filters by `req.user.id`, every insert writes `userId: req.user.id`; `requireOwnership` is deleted; the `username` query param is removed from every query schema. AI prompts use `req.user.username`.
- `admin.ts`: `GET /api/admin/users?limit&cursor` (admin only) → `{ items: PublicUser[], nextCursor }`; `PATCH /api/admin/users/:id/role` `{ role }`.

- [ ] **Step 1:** Write `auth.test.ts` (DB-guarded, `supertest(createApp({ db, mailer: fake }))`, `resetDb` in `beforeEach`): `register → 201 with tokens and verify email sent`; `register duplicate email (different case/whitespace) → 409 email_taken`; `register age 15 → 400`; `login wrong password and unknown email return identical 401 bodies`; `refresh rotates; replaying the old refresh → 401 and the new one also fails`; `forgot+reset with the mailed code; old access token then 401`; `delete account → old access token 401, refresh 401, user row gone`; `GET /auth/me without token → 401`.
- [ ] **Step 2:** Write `ownership.test.ts`: two users A and B; `quest-completion` posted by A is not visible in B's `GET /api/system/completions/summary`; a `username` query param naming A, sent by B, is ignored.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implement; update `schemas.test.ts` for the bodies without `username`.
- [ ] **Step 5:** Run tests + typecheck → PASS.
- [ ] **Step 6:** Commit `feat(api): accounts API, JWT middleware, user-scoped data`.

### Task 5: Key-optional AI layer and readiness

**Files:**
- Modify: `artifacts/api-server/src/lib/ai.ts`, `artifacts/api-server/src/routes/health.ts`, `routes/system.ts`, `routes/history.ts`
- Create: `artifacts/api-server/src/lib/ai-fallback.ts`
- Test: `artifacts/api-server/src/lib/ai.test.ts`, `artifacts/api-server/src/routes/health.test.ts`

**Interfaces:**
- `ai.ts` switches to `@google/genai` (`new GoogleGenAI({ apiKey }).models.generateContent({ model, contents, config: { systemInstruction, maxOutputTokens, temperature } })`; text via `response.text`). Remove `@google/generative-ai` from `package.json`. Keep `generateWithFallback(options): Promise<AiCallResult>`; add `AiCallResult.model = "template"` when no key is configured.
- Add `aiAvailable(): boolean`.
- `ai-fallback.ts`: `templateSystemMessage(messageType: string, ctx: { rank: string; dayNumber: number; shadowGap: number; trajectory: "up" | "stable" | "down" }): string` — deterministic and in the SYSTEM voice (second person, no exclamation marks, no emoji); at least one template per message type in `generateSystemMessageBodySchema`. `templateQuests(ctx: { weakestDomain: string }): { title: string; description: string; domain: string; type: "daily" }[]` returns exactly 3 quests, the first in the weakest domain.
- Routes use templates when `!aiAvailable()` instead of 500ing.
- `/api/readyz`: 200 `{ status: "ready", db: "ok", ai: "gemini" | "template" }` when `SELECT 1` succeeds; 503 `{ status: "not_ready", db: "unavailable" | "error" }` otherwise. Routes needing the DB return 503 `{ error: "Database unavailable", code: "db_unavailable" }` when `db` is null.

- [ ] **Step 1:** Write tests: `templateSystemMessage covers every message type, contains no "!" and no emoji (regex /\p{Extended_Pictographic}/u)`; `templateQuests returns 3 with the weakest domain first`; `generateWithFallback without key returns model "template"` (env key unset); `readyz 503 when db null` (via `createApp({ db: null })`); `auth register 503 db_unavailable when db null`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(api): @google/genai, template fallback, db readiness`.

### Task 6: CI, env examples, docs

**Files:**
- Modify: `.github/workflows/ci.yml` (add a `services.postgres` `postgres:16-alpine` with health check; env `TEST_DATABASE_URL`; step `pnpm --filter @workspace/db test`; run migrations before API tests)
- Modify: `artifacts/api-server/.env.example`, `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE_TECH_DOC.md` (auth + migrations sections)
- Create: `scripts/db/init-test-db.sql` (if not created in Task 1)

- [ ] **Step 1:** Update the files. `.env.example` lists every env var from `env.ts` with a comment and safe dev values.
- [ ] **Step 2:** Run locally: `docker compose up -d postgres && pnpm --filter @workspace/db migrate && pnpm run typecheck && pnpm --filter @workspace/api-server test` with `TEST_DATABASE_URL` set → all PASS, no skipped DB tests.
- [ ] **Step 3:** Commit `ci: postgres service, migrations, db tests; docs for accounts`.

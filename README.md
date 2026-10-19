# SYSTEM // SELF

SYSTEM // SELF is a life operating system, not a productivity app. Every part of your life (body, mind, wealth, social,
discipline) is logged, scored, ranked and judged. The judge is THE SYSTEM, a cold AI persona written as your future
self, the version that made it, looking back at who you are now. It sets daily quests, takes points for refusals,
writes a nightly debrief, and ranks you against rivals and clans. The idea is that people grow when the gap between who
they are and who they could be becomes visible. The full product spec is
[attached_assets/SYSTEM_SELF_PRD_1777727383321.md](attached_assets/SYSTEM_SELF_PRD_1777727383321.md).

## Architecture

A pnpm 11 monorepo (`pnpm-workspace.yaml`) on Node 22 and TypeScript 5.9.

| Path | Package | What it is |
| --- | --- | --- |
| `artifacts/api-server` | `@workspace/api-server` | Express 5 API (`src/index.ts`), the rollover/push/social worker (`src/worker.ts`), the esbuild bundle (`build.mjs`) and the production `Dockerfile` (`ROLE=api\|worker\|migrate`). |
| `artifacts/system-self` | `@workspace/system-self` | The Expo SDK 54 app (expo-router). `scripts/smoke/*.ts` drive the same API calls the screens make. |
| `lib/db` | `@workspace/db` | Drizzle schema, versioned SQL migrations (`lib/db/migrations`) and the advisory-locked migrator. |
| `lib/engine` | `@workspace/engine` | Pure game rules: scoring, ranks, decay, quests, debriefs, dungeons, rivals. Shared by the server and the app. |
| `lib/contracts` | `@workspace/contracts` | Zod request and response schemas shared by the API and the app. |
| `lib/api-spec` | `@workspace/api-spec` | `openapi.yaml` and the orval codegen config. |
| `lib/api-zod`, `lib/api-client-react` | | Generated from the OpenAPI spec. |
| `scripts` | `@workspace/scripts` | The end-to-end smoke (`smoke.ts`, `docker-smoke.sh`), the load test (`load/`) and container helpers. |
| `deploy/nginx.conf`, `docker-compose.prod.yml`, `render.yaml` | | Production topology: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). |

The API is stateless (JWT access tokens plus rotating refresh tokens, Postgres for everything else). The worker rolls
each user's day over, sends pushes and runs the social jobs. Without a Gemini key every AI path falls back to
deterministic templates, so the app works fully offline from AI.

## Dev quick start

Prerequisites: Node 22, pnpm 11 (`corepack enable`), Docker, and Expo Go on a phone on the same Wi-Fi as your machine.

```sh
pnpm install
docker compose up -d postgres                  # Postgres 16 on localhost:5432 (also creates system_self_test)

export DATABASE_URL=postgres://system_self:system_self@localhost:5432/system_self
pnpm --filter @workspace/db migrate            # applies lib/db/migrations

pnpm --filter @workspace/api-server dev        # API on http://localhost:3001 (NODE_ENV=development)
pnpm --filter @workspace/api-server dev:worker # in a second shell, same DATABASE_URL
```

Nothing loads a `.env` file: export the variables in each shell (PowerShell: `$env:DATABASE_URL = "..."`). In
development the API uses a built-in JWT secret, allows any CORS origin and writes mails, verification codes included,
to its log. Check it with `curl http://localhost:3001/api/readyz`.

Run the app in Expo Go:

```sh
cd artifacts/system-self
export EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:3001   # e.g. http://192.168.1.12:3001, not localhost
pnpm exec expo start --go --lan                       # scan the QR code with Expo Go (--go: expo-dev-client is installed)
```

The phone must reach your machine's LAN IP on port 3001, so allow it through the firewall.

## Tests

```sh
pnpm run typecheck                          # libs (tsc --build), then every artifact and scripts
pnpm --filter @workspace/engine test
pnpm --filter @workspace/system-self test

export TEST_DATABASE_URL=postgres://system_self:system_self@localhost:5432/system_self_test
pnpm --filter @workspace/db test
pnpm --filter @workspace/api-server test
```

The db and api-server suites need `TEST_DATABASE_URL`, and they truncate that database. Do not run them at the same
time as each other, or twice at once: they share the one test database, and each suite already runs its files with
`--test-concurrency=1`.

End to end: `SMOKE_BASE_URL=http://localhost:3001 pnpm --filter @workspace/scripts smoke` drives register, onboarding,
a log, quests, the debrief, export and deletion against a running API. `bash scripts/docker-smoke.sh` builds the
production image and runs the same smoke against the full production compose stack. It is the CI `docker-smoke` job.

## Environment variables

Every variable is parsed and validated in `artifacts/api-server/src/lib/env.ts`. The commented template is
`artifacts/api-server/.env.example` (development) and `.env.prod.example` (production compose). Production rules and the
full reference are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#1-environment). The app reads `EXPO_PUBLIC_API_URL` and
the RevenueCat public keys; see [docs/RELEASE.md](docs/RELEASE.md).

## Production

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): the Docker image, compose, Render, scaling, push, billing, metrics, backups.
- [docs/RUNBOOK.md](docs/RUNBOOK.md): deploy, rollback, secret rotation, restore, and incident procedures.
- [docs/RELEASE.md](docs/RELEASE.md): mobile store builds through EAS.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): the load test and its results.

## Waiting on the owner (HOLD)

Some things need the owner's accounts or decisions. Each has a working fallback. Details and status are in
[docs/HOLD.md](docs/HOLD.md).

- **H-01** Production secrets: a Gemini API key and production Postgres. Without a key, AI runs in template mode.
- **H-02** Hosting provider. The Docker image, prod compose and `render.yaml` are ready for any container host.
- **H-03** App store accounts and the final bundle ID or package name. `com.systemself.app` is a placeholder.
- **H-04** Payments: a RevenueCat project and store products. An admin can grant PRO meanwhile.
- **H-05** Email provider. Without one, codes only reach the server log, so production needs this.
- **H-06** Legal text review and the age floor. The drafts are in `docs/legal/`, and sign-up requires age 16 or over.
- **H-07** Apple and Google sign-in. Email and password only for now.
- **H-08** PostHog analytics. First-party events in Postgres for now.
- **H-09** Region-specific crisis helplines. International resources plus Tele-MANAS for now.
- **H-10** Hands-on device QA in Expo Go on real iOS and Android phones.

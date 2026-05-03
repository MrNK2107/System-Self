# Next Stage Execution Plan

## Objective
Move System-Self from feature-complete prototype into a stable, releasable product with safe delivery loops.

## Stage 1: Delivery Foundation (Now)
- CI pipeline in GitHub Actions:
  - install
  - workspace typecheck
  - API typecheck
  - API tests
  - API build
- Environment templates for API and mobile apps.

## Stage 2: Security & Identity
1. Introduce auth boundary (JWT/session) on API.
2. Enforce per-user identity in all history/recap endpoints.
3. Add completion ingest safeguards:
   - signed request validation or user-scoped token
   - idempotency key support
4. Restrict CORS to known origins in staging/prod.

## Stage 3: Data Integrity
1. Add explicit migration strategy (versioned SQL or migration files).
2. Add uniqueness constraint for completion events:
   - unique `(username, quest_id, status)` optionally with event date bucket
3. Add indexes for frequent queries:
   - `system_messages (username, created_at)`
   - `generated_quest_batches (username, created_at)`
   - `generated_quests (username, created_at, domain)`
   - `quest_completion_events (username, completed_at, status, domain)`

## Stage 4: Observability
1. Metrics:
   - request latency / error rate
   - AI retry/fallback frequency
   - completion ingest success/failure
2. Alerts:
   - sustained 5xx
   - DB unavailable
   - AI failure spike
3. Add correlation id propagation from app -> API logs.

## Stage 5: Release Engineering
1. Add staging + production environments in GitHub.
2. Add deployment workflow (manual approval gate).
3. Add release checklist:
   - db migration applied
   - smoke tests pass
   - rollback command validated
4. Mobile release flow:
   - EAS profiles (`development`, `preview`, `production`)
   - beta channels
   - store submission checklist

## Stage 6: Product Hardening
1. Build server-side completion trend cache/materialized summary.
2. Add anomaly detection (sudden completion collapse by domain).
3. Add personalized intervention prompts when failure streaks increase.

## Immediate Next Implementation
1. Auth scaffolding (API middleware + token model).
2. Query ownership enforcement by authenticated user.
3. Idempotent quest completion ingest endpoint.

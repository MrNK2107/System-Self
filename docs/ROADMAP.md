# System-Self Roadmap

## Phase 1: Foundation (Implemented)
- Harden API with security headers (`helmet`) and rate limiting.
- Add centralized error handling and 404 handling.
- Add request schema validation for `/api/system/message` and `/api/system/quests`.
- Add environment parsing with defaults.
- Add readiness endpoint (`/api/readyz`) for deployment probes.
- Add initial schema tests.

## Phase 2: AI Reliability (Implemented)
- Add prompt version tags and record them in responses/logs.
- Add model fallback chain (primary + backup model).
- Add stricter response schema validation for AI outputs.
- Add retry/backoff wrappers around Gemini calls.

## Phase 3: Data + Product (Partially Implemented)
- Persist generated quests/messages with timestamps and model metadata.
- Add weekly recap aggregation endpoints.
- Add retrieval endpoints for message and quest history.
- Remaining: adaptive quest difficulty from history and streaks.

## Phase 4: Deployment + Operations
- Add CI for typecheck/build/test.
- Add staging and production environment configs.
- Deploy API with health/readiness probes.
- Add uptime monitoring and basic alerting.

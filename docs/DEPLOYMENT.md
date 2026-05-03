# Deployment Checklist

## 1. Environment
Set these variables in each environment:
- `NODE_ENV=production`
- `PORT=3001`
- `GEMINI_API_KEY=...`
- `GEMINI_MODEL=gemini-1.5-flash`
- `CORS_ORIGIN=https://your-app-domain.com`
- `RATE_LIMIT_WINDOW_MS=60000`
- `RATE_LIMIT_MAX=60`
- `AUTH_ENABLED=true`
- `API_AUTH_TOKENS=<token>:<username>[,<token2>:<username2>]`
 - Optional token expiry format:
   - `<token>|<ISO_UTC_TIMESTAMP>:<username>`
 - `API_AUTH_REVOKED_TOKENS=<token>[,<token2>]`
 - `AUTH_ROTATION_WARNING_DAYS=7`

## 2. Health Checks
- Liveness: `GET /api/healthz`
- Readiness: `GET /api/readyz`

## 3. Build + Start
```bash
pnpm --filter @workspace/db push
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/api-server start
```

## 4. Pre-Release Validation
- `pnpm --filter @workspace/api-server typecheck`
- `pnpm --filter @workspace/api-server test`
- Verify mobile app can call `/api/system/message` and `/api/system/quests`.
- Verify mobile requests include `Authorization: Bearer <token>` where token maps to the same username in API query/body.

## 8. Token Rotation Procedure
1. Add a new token to `API_AUTH_TOKENS` for the same username.
2. Keep old token active temporarily (optional expiry recommended).
3. Roll out client config with new `EXPO_PUBLIC_API_TOKEN`.
4. Monitor for old-token traffic.
5. Revoke old token by adding it to `API_AUTH_REVOKED_TOKENS`.

## 9. Admin Token Observability
- Configure `ADMIN_API_TOKENS` for operator-only access.
- Endpoint:
  - `GET /api/admin/auth/tokens`
- Returns token fingerprints and status metadata only (no raw token values):
  - `isExpired`, `expiringSoon`, `isRevoked`, `tokenType`, `username`

## 10. Auth Audit Logging
Security-relevant auth events are logged in structured form:
- missing/invalid/revoked/expired token attempts
- ownership check failures
- admin endpoint access/forbidden attempts
- token-expiring-soon warnings

Sensitive handling:
- Raw token values are never logged.
- Logs include short SHA-256 token fingerprints for traceability.
- Verify history endpoints:
  - `GET /api/system/messages?username=<name>`
  - `GET /api/system/quests/history?username=<name>`
  - `GET /api/system/recap/weekly?username=<name>`
  - `GET /api/system/recap/weekly/debrief?username=<name>`
  - `GET /api/system/completions/summary?username=<name>&days=14`
  - `POST /api/system/quest-completion`

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
  "username": "nanda",
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
- Server deduplicates completion events by `(username, idempotencyKey)`.
- App currently uses deterministic key: `questId:status:domain:questType`.

App behavior:
- `complete` and `refused` are emitted from quest actions.
- `failed` is emitted automatically by the quest scheduler when active daily quests expire.
- Failed events are de-duplicated client-side so each quest id is sent once.

## 5. Rollout
- Deploy to staging first.
- Run smoke checks on staging.
- Promote to production.
- Monitor logs and request latency/error rate for first 24h.

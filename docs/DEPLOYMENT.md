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
- Verify history endpoints:
  - `GET /api/system/messages?username=<name>`
  - `GET /api/system/quests/history?username=<name>`
  - `GET /api/system/recap/weekly?username=<name>`
  - `GET /api/system/recap/weekly/debrief?username=<name>`

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

## 5. Rollout
- Deploy to staging first.
- Run smoke checks on staging.
- Promote to production.
- Monitor logs and request latency/error rate for first 24h.

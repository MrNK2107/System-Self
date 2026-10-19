#!/usr/bin/env bash
# Docker smoke: what CI's docker-smoke job runs, and how to run it by hand (Linux, macOS, Git Bash on Windows).
#   1. builds the API image from artifacts/api-server/Dockerfile and checks it is under 250 MB;
#   2. boots docker-compose.prod.yml (postgres, migrate, api1 + api2 behind nginx, worker) with freshly generated
#      secrets in .env.smoke (gitignored), no Gemini key (template mode) and MAILER=log;
#   3. waits for /api/readyz through nginx, checks /metrics, runs scripts/smoke.ts against nginx;
#   4. checks the worker is still up; prints container logs on any failure; tears the stack down (down -v).
# It needs docker (with compose v2), curl, node and an installed workspace (pnpm install).
# Env: SMOKE_PROJECT (compose project, default system-self-smoke), API_IMAGE (default system-self-api:smoke),
#      SKIP_BUILD=1 (reuse an existing image), KEEP_STACK=1 (leave the stack up afterwards).
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${SMOKE_PROJECT:-system-self-smoke}"
export API_IMAGE="${API_IMAGE:-system-self-api:smoke}"
export ENV_FILE=.env.smoke
MAX_IMAGE_BYTES=$((250 * 1000 * 1000))
BASE_URL="http://localhost:8080"
compose() { docker compose -p "$PROJECT" -f docker-compose.prod.yml "$@"; }
rand() { node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"; }

stage="start"
on_exit() {
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "::error::docker smoke failed at stage: $stage"
    echo "===== compose ps ====="
    compose ps -a || true
    echo "===== container logs ====="
    compose logs --no-color --timestamps || true
  fi
  if [ "${KEEP_STACK:-0}" != "1" ]; then
    compose down -v --remove-orphans >/dev/null 2>&1 || true
    rm -f .env.smoke
  fi
  exit "$code"
}
trap on_exit EXIT

stage="build image"
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  docker build -f artifacts/api-server/Dockerfile -t "$API_IMAGE" .
fi

stage="image size"
# `docker image inspect` Size is the unpacked size on the classic overlay2 store (GitHub runners: the authoritative
# check). Docker Desktop's containerd store reports compressed content there and in `docker save`, so locally both
# numbers read low (`docker images` shows unpacked + compressed together, 212 MB at the time of writing).
size=$(docker image inspect -f '{{.Size}}' "$API_IMAGE")
saved=$(docker save "$API_IMAGE" | wc -c | tr -d ' ')
echo "image $API_IMAGE: inspect Size $size bytes ($((size / 1000 / 1000)) MB), docker save $saved bytes ($((saved / 1000 / 1000)) MB), limit $MAX_IMAGE_BYTES"
if [ "$size" -ge "$MAX_IMAGE_BYTES" ] || [ "$saved" -ge "$MAX_IMAGE_BYTES" ]; then
  echo "image is over 250 MB"
  exit 1
fi

stage="generate env"
POSTGRES_PASSWORD="$(rand)"
export POSTGRES_PASSWORD
METRICS_TOKEN="$(rand)"
cat > .env.smoke <<EOF
NODE_ENV=production
PORT=3001
LOG_LEVEL=info
DATABASE_URL=postgres://system_self:${POSTGRES_PASSWORD}@postgres:5432/system_self
DB_POOL_MAX=5
JWT_SECRET=$(rand)
CORS_ORIGIN=https://smoke.invalid
TRUST_PROXY=1
MAILER=log
REVENUECAT_WEBHOOK_SECRET=$(rand)
METRICS_TOKEN=${METRICS_TOKEN}
WORKER_METRICS_PORT=9464
WORKER_TICK_MS=5000
EOF

stage="compose up"
compose down -v --remove-orphans >/dev/null 2>&1 || true
compose up -d --no-build

stage="wait for readyz through nginx"
ready=""
for _ in $(seq 1 90); do
  if ready=$(curl -fsS "$BASE_URL/api/readyz" 2>/dev/null); then break; fi
  ready=""
  sleep 2
done
if [ -z "$ready" ]; then
  echo "readyz did not answer 200 through nginx within 180 s"
  exit 1
fi
echo "readyz: $ready"
case "$ready" in *'"ai":"template"'*) ;; *) echo "expected template mode (no GEMINI_API_KEY)"; exit 1 ;; esac

stage="migrate exited 0"
migrate_id=$(compose ps -a -q migrate)
migrate_exit=$(docker inspect -f '{{.State.ExitCode}}' "$migrate_id")
[ "$migrate_exit" = "0" ] || { echo "migrate exited $migrate_exit"; exit 1; }

stage="metrics"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/metrics")
[ "$code" = "401" ] || { echo "/metrics without a token answered $code, expected 401"; exit 1; }
metrics=$(curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" "$BASE_URL/metrics")
case "$metrics" in *http_request_duration_seconds*) ;; *) echo "/metrics did not serve http_request_duration_seconds"; exit 1 ;; esac
echo "metrics: 401 without the token, http_request_duration_seconds with it"

stage="smoke"
SMOKE_BASE_URL="$BASE_URL" pnpm --filter @workspace/scripts run smoke

stage="worker still running"
worker_id=$(compose ps -q worker)
state=$(docker inspect -f '{{.State.Status}} restarts={{.RestartCount}}' "$worker_id")
echo "worker: $state"
case "$state" in "running restarts=0") ;; *) echo "worker is not healthy"; exit 1 ;; esac
compose exec -T worker node -e "fetch('http://127.0.0.1:9464/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(async r=>{const t=await r.text();if(!r.ok||!t.includes('job_duration_seconds'))process.exit(1);console.log('worker metrics: ok')},()=>process.exit(1))"

stage="done"
echo "DOCKER SMOKE PASSED"

#!/bin/sh
# Selects the process by ROLE: api (default) | worker | migrate.
set -eu
cd /app
case "${ROLE:-api}" in
  api)     exec node --enable-source-maps dist/index.mjs ;;
  worker)  exec node --enable-source-maps dist/worker.mjs ;;
  migrate) exec node dist/migrate.mjs ;;
  *) echo "Unknown ROLE '${ROLE}': expected api, worker or migrate" >&2; exit 64 ;;
esac

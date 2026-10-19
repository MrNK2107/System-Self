#!/bin/sh
# Starts one process of the image. The role comes from the first argument (api | worker | migrate) or, without one,
# from ROLE (default api):
#   docker run IMAGE                    -> api (ROLE unset)
#   docker run -e ROLE=worker IMAGE     -> worker
#   docker run IMAGE migrate            -> migrate (Render preDeployCommand: docker-entrypoint.sh migrate)
# Any other arguments are an explicit command and run as given (docker run IMAGE sh, node -e ..., etc.).
# Tested by scripts/docker-entrypoint.test.sh (APP_DIR is a test seam).
set -eu
role="${ROLE:-api}"
case "${1:-}" in
  api|worker|migrate)
    role="$1"
    shift
    if [ "$#" -gt 0 ]; then
      echo "docker-entrypoint.sh: role '$role' takes no arguments (got: $*)" >&2
      exit 64
    fi
    ;;
esac
if [ "$#" -gt 0 ]; then exec "$@"; fi
cd "${APP_DIR:-/app}"
case "$role" in
  api)     exec node --enable-source-maps dist/index.mjs ;;
  worker)  exec node --enable-source-maps dist/worker.mjs ;;
  migrate) exec node dist/migrate.mjs ;;
  *) echo "Unknown ROLE '${role}': expected api, worker or migrate" >&2; exit 64 ;;
esac

#!/bin/sh
# Tests scripts/docker-entrypoint.sh without docker: a stub `node` on PATH echoes its arguments, APP_DIR points at a
# temp dir. Run: sh scripts/docker-entrypoint.test.sh (CI's validate job; also driven by deploy-config.test.ts).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
entry="$here/docker-entrypoint.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/app"
printf '#!/bin/sh\necho "node $*"\n' > "$tmp/bin/node"
chmod +x "$tmp/bin/node"

fail=0
check() { # check <description> <expected stdout> <expected status> -- <env and command...>
  desc=$1 want=$2 want_status=$3
  shift 4
  set +e
  got=$(env PATH="$tmp/bin:$PATH" APP_DIR="$tmp/app" "$@" 2>/dev/null)
  status=$?
  set -e
  if [ "$got" != "$want" ] || [ "$status" != "$want_status" ]; then
    echo "FAIL: $desc: got [$got] (exit $status), want [$want] (exit $want_status)"
    fail=1
  else
    echo "ok: $desc"
  fi
}

check "default role is api" "node --enable-source-maps dist/index.mjs" 0 -- sh "$entry"
check "ROLE=worker" "node --enable-source-maps dist/worker.mjs" 0 -- ROLE=worker sh "$entry"
check "ROLE=migrate" "node dist/migrate.mjs" 0 -- ROLE=migrate sh "$entry"
check "\$1 migrate (render preDeployCommand)" "node dist/migrate.mjs" 0 -- sh "$entry" migrate
check "\$1 overrides ROLE" "node dist/migrate.mjs" 0 -- ROLE=api sh "$entry" migrate
check "\$1 worker" "node --enable-source-maps dist/worker.mjs" 0 -- sh "$entry" worker
check "\$1 api" "node --enable-source-maps dist/index.mjs" 0 -- ROLE=worker sh "$entry" api
check "explicit command runs as given" "hello from sh" 0 -- sh "$entry" sh -c 'echo hello from sh'
check "explicit command ignores ROLE" "node -e 1" 0 -- ROLE=worker sh "$entry" node -e 1
check "a role with extra arguments is refused" "" 64 -- sh "$entry" migrate --extra
check "unknown ROLE is refused" "" 64 -- ROLE=nope sh "$entry"

[ "$fail" = 0 ] || exit 1
echo "entrypoint tests passed"

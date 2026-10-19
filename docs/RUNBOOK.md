# Runbook

Procedures for operating SYSTEM // SELF in production. The setup itself (environment, image, compose, Render, scaling,
metrics) is in [DEPLOYMENT.md](DEPLOYMENT.md). The hosting provider is not chosen yet (HOLD H-02,
[HOLD.md](HOLD.md)), so each procedure gives the production compose commands and the Render equivalent.

Shorthand used below:

```sh
DC="docker compose -f docker-compose.prod.yml"   # production compose, from the repo root
API=https://api.example.com                       # the public API origin (compose: http://localhost:8080)
```

`psql "$DATABASE_URL"` means a psql session against the production database. On compose, use
`$DC exec postgres psql -U system_self -d system_self`. On Render, use `render psql system-self-db` or the dashboard's
external connection string.

## Contents
- [Deploy](#deploy)
- [Rollback](#rollback)
- [Rotate the JWT secret](#rotate-the-jwt-secret)
- [Rotate other secrets](#rotate-other-secrets)
- [Restore a backup](#restore-a-backup)
- [AI outage (template mode)](#ai-outage-template-mode)
- [Scale workers](#scale-workers)
- [Stuck worker or lease](#stuck-worker-or-lease)
- [Push outage](#push-outage)
- [Email provider down](#email-provider-down)
- [User data export or deletion request](#user-data-export-or-deletion-request)
- [Grant PRO for support](#grant-pro-for-support)
- [Reproduce the load test](#reproduce-the-load-test)
- [Appendix: deletion by SQL (last resort)](#appendix-deletion-by-sql-last-resort)

## Deploy

Order: build, migrate, roll the APIs one at a time, then the worker, then smoke.

Compose:

```sh
git pull
TAG=$(git rev-parse --short HEAD)
docker build -f artifacts/api-server/Dockerfile -t system-self-api:$TAG .
export API_IMAGE=system-self-api:$TAG

$DC run --rm migrate                        # one-shot, advisory-locked; must exit 0 before anything else
$DC up -d --no-deps api1                     # nginx retries a 503 on api2 while api1 restarts
until curl -fsS http://localhost:3011/api/readyz; do sleep 2; done
$DC up -d --no-deps api2
until curl -fsS http://localhost:3012/api/readyz; do sleep 2; done
$DC up -d --no-deps worker                   # finishes its current user, releases the rest of its batch

SMOKE_BASE_URL=http://localhost:8080 SMOKE_EMAIL_DOMAIN=<a domain you own> pnpm --filter @workspace/scripts smoke
```

`SMOKE_EMAIL_DOMAIN` (default `example.com`) is the domain of the smoke's throwaway account. Registration mails a
verification code to that address, so against a production API with a real mail provider set it to a domain you own
or a mailbox sink (a catch-all or test inbox). Mail to `example.com` and other non-existent mailboxes bounces, and
bounces count against the sending domain's reputation with the provider and with receiving mail servers, which pushes
real users' verification and reset mails toward spam. With `MAILER=log` (CI, local) the default is fine.

The direct API ports (3011, 3012) are bound to `127.0.0.1`: the `curl` checks above work on the host only, and nginx
(8080) is the only port reachable from outside.

Keep the previous tag (`docker image ls system-self-api`) for a rollback. Write down each deployed tag, for example in
the release notes or the git tag.

Render: push to the deployed branch, or Dashboard > `system-self-api` > Manual Deploy. The `preDeployCommand` runs the
migrator (`docker-entrypoint.sh migrate`), and the deploy stops if it fails. Deploy `system-self-worker` after the API is
live; it runs the same pre-deploy migrator (idempotent and advisory-locked), so a worker deployed first never runs on an
old schema. Then run the smoke with `SMOKE_BASE_URL=$API SMOKE_EMAIL_DOMAIN=<a domain you own>`.

After any deploy, watch the following for 15 minutes:
- the 5xx rate: `http_request_duration_seconds_count{status=~"5.."}`
- `ai_fallbacks_total`
- the worker log's `Worker tick` lines, and `worker_last_tick_timestamp_seconds` advancing

## Rollback

Migrations are forward-only and additive, so a rollback is code only: redeploy the previous image and **do not**
undo migrations. The previous release runs on the newer schema. Never hand-edit `drizzle.__drizzle_migrations` or drop
the new columns or tables.

Compose:

```sh
export API_IMAGE=system-self-api:<previous-tag>
$DC up -d --no-deps api1 && until curl -fsS http://localhost:3011/api/readyz; do sleep 2; done
$DC up -d --no-deps api2 && until curl -fsS http://localhost:3012/api/readyz; do sleep 2; done
$DC up -d --no-deps worker
SMOKE_BASE_URL=http://localhost:8080 pnpm --filter @workspace/scripts smoke
```

Do not run `migrate` from the old image. It would be a no-op, but there is no reason to run it.

Render: Dashboard > service > Events, pick the last good deploy, then Rollback. Do this for both the API and the worker.

If a migration itself is broken and blocks a deploy, write a new forward migration that fixes it. Do not edit or
delete a migration that has already run anywhere.

## Rotate the JWT secret

Access tokens are JWTs signed with `JWT_SECRET` (TTL `ACCESS_TOKEN_TTL_SEC`, 900 s by default). Refresh tokens are
opaque database rows that are not signed with it. During a rotation the API verifies with `JWT_SECRET` first, then
`JWT_SECRET_PREVIOUS`, and always signs with `JWT_SECRET`. Nobody is signed out.

1. Generate the new secret: `openssl rand -base64 48`.
2. On the API **and** the worker, set `JWT_SECRET_PREVIOUS=<current secret>` and `JWT_SECRET=<new secret>`. On compose,
   edit `.env.prod`. On Render, edit both services' environment.
3. Deploy (see [Deploy](#deploy); no migration). While the rollout runs, an old instance can reject a token that a new
   instance signed. The client then refreshes, so the cost is one extra refresh and no sign-out.
4. Wait at least one access-token TTL plus a refresh cycle **after the last instance runs the new secret**. With the
   defaults, wait 15 min plus the rollout time; 30 min is a comfortable margin. By then every live access token was
   signed with the new secret.
5. Remove `JWT_SECRET_PREVIOUS` and deploy again.

Side effect: email verification and password-reset codes are HMAC-keyed with `JWT_SECRET`, so codes issued before the
rotation stop working. They expire within 15 minutes anyway, and users can request a new one.

**Leaked secret:** skip `JWT_SECRET_PREVIOUS`. Set only the new `JWT_SECRET` and deploy. Every access token dies at
once, and clients recover through refresh with no sign-out. If refresh tokens may have leaked too (a database leak),
revoke every session:
`update refresh_tokens set revoked_at = now(), revoked_reason = 'revoked_all' where revoked_at is null;`. Everyone then
signs in again.

## Rotate other secrets

Each one is: change the value, then deploy the API (and the worker where noted). None needs a migration.

| Secret | Steps |
| --- | --- |
| `REVENUECAT_WEBHOOK_SECRET` | The server accepts one value. 1. `openssl rand -base64 32`. 2. Set it on the API and deploy. 3. Straight away, set the RevenueCat dashboard webhook Authorization header to `Bearer <new>`. Deliveries in the gap get 401 and RevenueCat retries them. Afterwards check the dashboard's webhook history for failed events and resend them. Replays are safe because events are deduplicated by id. |
| `METRICS_TOKEN` | Set it on the API and worker, deploy, and update Prometheus's `credentials_file`. Scrapes fail with 401 until both sides match. |
| `REVENUECAT_API_KEY` | Create a new secret key in RevenueCat, set it on the API, deploy, then revoke the old key. |
| `RESEND_API_KEY` | Create a key in Resend, set it on the API, deploy, then delete the old key. |
| `GEMINI_API_KEY` | Create a key, set it on the API and worker, deploy, then delete the old key. In the gap the app runs in template mode. |
| `EXPO_ACCESS_TOKEN` | Create a token in Expo, set it on the worker, deploy, then revoke the old one. |
| Database password | Add a second role or set a new password (`alter role system_self password '...'`). Update `DATABASE_URL` everywhere, plus `POSTGRES_PASSWORD` on compose, then deploy. Existing connections keep working until they reconnect. |

## Restore a backup

1. **Stop writes.** Compose: `$DC stop worker api1 api2`. Render: suspend both services. Note the time.
2. **Restore into a new database.** Never restore over the live one.
   - With PITR (preferred): in the provider console, restore to a point just before the incident. This creates a new
     instance; take its connection string.
   - With a dump:
     ```sh
     createdb --maintenance-db "$ADMIN_URL" system_self_restore
     pg_restore --no-owner --no-privileges --exit-on-error --dbname "$RESTORE_URL" system-self-<stamp>.dump
     ```
3. **Bring the schema forward.** The backup may predate recent migrations:
   `$DC run --rm -e DATABASE_URL="$RESTORE_URL" migrate`, or `DATABASE_URL=$RESTORE_URL pnpm --filter @workspace/db migrate`
   from a checkout.
4. **Re-apply deletions.** Account deletions made after the backup point are back in the restored copy. Find them in
   the API logs (`"event":"account_deleted"` with `userId`, from the backup time onward) and delete those users again
   with `POST /api/admin/users/:id/delete` ([User data export or deletion request](#user-data-export-or-deletion-request)).
5. **Switch.** Point `DATABASE_URL` at the restored database on the API and worker, start them, and run the smoke.
6. Keep the old database read-only for a week before you drop it.

Expect the following after a restore:
- Users who signed in after the backup point must sign in again, because their refresh tokens are gone.
- Logs made after the backup point are lost. Say so in the incident notice.

## AI outage (template mode)

Nothing to switch: when Gemini errors, times out or returns invalid output, the API retries (`GEMINI_RETRY_COUNT`),
tries `GEMINI_FALLBACK_MODEL`, and then serves deterministic template text (`meta.model = "template"`). Quests,
debriefs and messages keep working. Voice logging answers 503 `ai_unavailable` and the user's daily voice allowance is
refunded.

How to verify:
- `curl $API/api/readyz` shows `"ai":"gemini"` whenever a key is **configured** and `"template"` when none is. It does
  not probe Gemini, so during an outage it still says `gemini`.
- Use the metrics. `ai_fallbacks_total` climbs while Gemini is down, and `ai_calls_total{outcome!="ok"}` shows the
  error type (`error`, `timeout`, `invalid`):
  ```sh
  curl -s -H "Authorization: Bearer $METRICS_TOKEN" $API/metrics | grep -E '^ai_(calls|fallbacks)_total'
  ```
  Alert on `rate(ai_fallbacks_total[5m]) > 0` for 10 minutes with a key configured.
- To force template mode on purpose (for example a runaway bill), unset `GEMINI_API_KEY` and deploy. `readyz` then
  shows `"ai":"template"`.

When Gemini recovers, nothing needs to be done. Content generated in the meantime stays templated, because generated
quests and debriefs are stored.

## Scale workers

More than one worker is safe: users are claimed with `FOR UPDATE SKIP LOCKED` and a 10-minute lease
([DEPLOYMENT.md](DEPLOYMENT.md#4-scaling)).

```sh
$DC up -d --no-recreate --scale worker=3     # compose; the worker has no published ports
```

Render: Dashboard > `system-self-worker` > Scaling, or set `numInstances` on the worker in `render.yaml`. Add each
worker's `DB_POOL_MAX` to the connection budget first. Scale up when `job_duration_seconds{job="rollover"}` approaches
`WORKER_TICK_MS`, or when overdue users build up (next section).

## Stuck worker or lease

Symptoms: day rollover, deadlines or pushes stop. Users see yesterday's quests, or debriefs do not close.

```sql
-- Users whose rollover is overdue (a healthy system keeps this near 0)
select count(*), min(next_rollover_at) from user_day_state where next_rollover_at < now() - interval '15 minutes';
-- Advisory locks held right now (a migrator holds key 7265390417; per-user locks are transaction-scoped)
select pid, locktype, objid, granted, now() - query_start as age, state, left(query, 80)
from pg_locks join pg_stat_activity using (pid) where locktype = 'advisory';
-- Long-running transactions
select pid, now() - xact_start as age, state, left(query, 120) from pg_stat_activity
where xact_start < now() - interval '2 minutes' order by xact_start;
```

1. Check the worker is alive. Its log prints `Worker tick` every `WORKER_TICK_MS`, and `$DC ps worker` shows it
   (`unhealthy` there means no tick completed for 5 minutes: the healthcheck reads the mtime of its heartbeat file,
   `/tmp/worker-heartbeat`). Look for repeated `Rollover failed` errors with a `userId`.
2. A crashed or killed worker needs no cleanup. The users it had claimed become due again when their 10-minute lease
   runs out, and the next tick picks them up.
3. A hung worker (alive, no ticks): restart it with `$DC restart worker`, or restart the Render service. SIGTERM lets it
   finish its current user and release the rest of its batch. Its exit backstop is 60 s.
4. A stuck database session (a long `idle in transaction` holding a user's lock): end it with
   `select pg_terminate_backend(<pid>);`. Its transaction rolls back and the user is retried.
5. To retry one user now instead of waiting out the lease:
   `update user_day_state set next_rollover_at = now() where user_id = '<id>';`
6. A user who fails every tick (the same `Rollover failed` `userId` again and again) is a bug: capture the error and
   the user id for a fix. Other users are not blocked.

Alert on a stale tick before users notice. With the worker scraped (`WORKER_METRICS_PORT`, [DEPLOYMENT.md](DEPLOYMENT.md#7-metrics)),
`worker_last_tick_timestamp_seconds` is the Unix time of the last completed tick; a tick that throws (for example the
database is unreachable) does not advance it. Example Prometheus rules:

```yaml
groups:
  - name: system-self-worker
    rules:
      - alert: WorkerTickStale
        # No completed tick for 5 minutes (WORKER_TICK_MS is 60 s). With several workers, max() means "all stalled".
        expr: time() - max(worker_last_tick_timestamp_seconds{job="system-self-worker"}) > 300
        for: 2m
        labels: { severity: page }
        annotations:
          summary: "Worker has not completed a tick for over 5 minutes"
          runbook: "docs/RUNBOOK.md#stuck-worker-or-lease"
      - alert: WorkerMetricsMissing
        expr: absent(worker_last_tick_timestamp_seconds{job="system-self-worker"})
        for: 10m
        labels: { severity: page }
```

## Push outage

The worker sends pushes through the Expo Push API. Pushes are at most once: a batch that Expo rejects, or that misses
the send budget, is logged and **not** resent. The in-app notices are still created, so users see them on their next
open.

- Signs: worker log `Expo push request failed`, `Push batch failed`, `push_error_tickets` (with `errorCodes`), or
  `push_send_budget`. Check https://status.expo.dev.
- Expo down: nothing to do. Pushes resume on the next tick after Expo recovers. Do not restart workers in a loop.
- `InvalidCredentials` or `MismatchSenderId` tickets: the FCM or APNs credentials in EAS are wrong or expired. Fix them
  with `eas credentials` ([RELEASE.md](RELEASE.md#one-time-setup)). No server change is needed.
- 401 from Expo: Enhanced Push Security is on, and `EXPO_ACCESS_TOKEN` is missing or revoked on the worker.
- `DeviceNotRegistered` tokens are deleted automatically. That is normal churn, not an outage.

## Email provider down

Mail is sent fire-and-forget after the response, so register, verify-request and forgot-password still answer
normally. The send failure is logged as `Failed to send email` (`Resend responded <status>`).

- Check https://resend-status.com and the Resend dashboard. Look for a revoked key, an unverified domain or a hit quota.
- Codes are capped at 5 per account and purpose per hour, and expire after 15 minutes. Once mail recovers, users
  request a new code. Nothing queued needs replaying.
- Only Resend has a transport. Setting `MAILER=log` keeps the API up but sends nothing (codes are redacted in the logs),
  so do it only if Resend errors take the API down, which they should not.
- A user locked out while mail is down waits for mail and then uses the reset flow. Production redacts codes in the
  logs, so support cannot read them there.

## User data export or deletion request

**In app (preferred):**
- Export: Settings > Export my data calls `GET /api/account/export`, which returns a JSON file of everything stored
  about the user, without password hashes or other users' data. The limit is 3 per hour per user.
- Delete: Settings > Account > Delete account calls `DELETE /api/auth/account` with the password. It is immediate and
  irreversible. Other players' notices show the user as FORMER OPERATOR, and reports about them are kept for review.

The same calls work with curl for a user who asks for help (they sign in themselves):

```sh
TOKEN=$(curl -s -X POST $API/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"<email>","password":"<password>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -s -H "Authorization: Bearer $TOKEN" $API/api/account/export -o export.json
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"password":"<password>"}' $API/api/auth/account -w '%{http_code}\n'   # 204
```

**By an admin** (the user cannot sign in, or a legal request arrives by email). Verify identity first, for example a
reply from the account's email address. Both routes need an admin access token, log an `admin_action` line (actor,
action, target id and status; never the request body or the data) and answer 400 for a malformed id and 404 for an
unknown one.

```sh
ADMIN_TOKEN=$(curl -s -X POST $API/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"<admin email>","password":"<password>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
# user id and username: psql "$DATABASE_URL" -c "select id, username from users where lower(email) = lower('<email>');"

# Export: the same JSON document and attachment the user gets from Settings > Export my data.
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" $API/api/admin/users/<user-uuid>/export -o export-<user-uuid>.json

# Delete: confirm must be the user's username (409 confirm_mismatch otherwise). Same effect as the in-app delete:
# deleteAccount under the user's lock. An admin cannot delete their own account here (409 self_delete).
curl -s -X POST $API/api/admin/users/<user-uuid>/delete \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'Idempotency-Key: deletion-<ticket-id>' \
  -d '{"confirm":"<username>"}'                  # 200 {"deleted":true,"id":"<user-uuid>"}
```

The Idempotency-Key makes the delete safe to retry: a repeat with the same key replays the 200. Without a key a repeat
answers 404, because the account is gone. Send the export to the requester over a channel tied to their verified
identity, then delete your local copy. Record the request, the ticket and the date it was done. If a backup is
restored later, re-apply the deletion ([Restore a backup](#restore-a-backup)).

If the API is down and a deletion cannot wait, use the SQL in
[Appendix: deletion by SQL](#appendix-deletion-by-sql-last-resort).

## Grant PRO for support

`POST /api/admin/users/:id/entitlement` (admin role) sets the tier with `source = "admin"`. An unexpired admin PRO
grant wins over RevenueCat events for that user.

```sh
ADMIN_TOKEN=$(curl -s -X POST $API/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"<admin email>","password":"<password>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
# user id: psql "$DATABASE_URL" -c "select id from users where lower(email) = lower('<email>');"
curl -s -X POST $API/api/admin/users/<user-uuid>/entitlement \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"tier":"pro","expiresAt":"2026-12-31T23:59:59Z"}'      # expiresAt null = no expiry
# take it back:  -d '{"tier":"free"}'
```

The first admin is created with `pnpm --filter @workspace/api-server admin:grant <email>` from a checkout, or
`update users set role = 'admin' where lower(email) = lower('<email>');`
([DEPLOYMENT.md](DEPLOYMENT.md#10-auth-operations)). Admin tokens are ordinary 15-minute access tokens. Do not store
them.

## Reproduce the load test

Seed, start a production-mode API with `LOAD_TEST=1 RATE_LIMIT_DISABLED=1` against the dedicated `system_self_load`
database, then run the scenarios. The commands, the targets (`GET /api/state` p95 < 250 ms at 100 req/s, `POST
/api/logs` p95 < 300 ms at 50 req/s, zero 5xx) and the last results are in
[PERFORMANCE.md](PERFORMANCE.md#reproduce). Never point the load test, or `RATE_LIMIT_DISABLED`, at production.

## Appendix: deletion by SQL (last resort)

Only when the API cannot serve `POST /api/admin/users/:id/delete`. **This must mirror `deleteAccount` in
`artifacts/api-server/src/services/account.ts`.** Check that function before running this; if it has changed, update
this block first. Run it in one transaction:

```sql
\set uid '<user-uuid>'
begin;
select pg_advisory_xact_lock(hashtext(:'uid'));
update notices set payload = jsonb_set(payload, '{handle}', to_jsonb('FORMER OPERATOR'::text))
 where user_id <> :'uid'
   and kind in ('shame', 'duo_checkin', 'challenge_received', 'challenge_result')
   and payload->>'handle' in (select username from users where id = :'uid'
                              union select public_codename from profiles where user_id = :'uid');
update user_reports set subject_handle = (select username from users where id = :'uid')
 where subject_id = :'uid' and subject_handle is null;
update billing_events set payload = '{}' where user_id = :'uid';
delete from users where id = :'uid';   -- everything the user owns cascades
commit;
```

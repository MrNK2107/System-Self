// Smoke: named challenges against a running API.
// A free player cannot challenge (402) -> both players are made PRO straight in the database (the P5 entitlement stub
// has no self-serve path) -> a stranger is refused (403 not_eligible) -> after a follow the challenge is created (201)
// -> the opponent sees it incoming and accepts -> both see the live gain comparison (domain gains only, no hidden score)
// -> a second challenge is ignored and the challenger reads "Challenge ignored. Logged.".
// Registers 3 accounts (the register limiter allows 10 per 15 minutes per IP).
// Usage: SMOKE_API_URL=http://localhost:3001 SMOKE_DATABASE_URL=postgres://system_self:system_self@localhost:5432/system_self \
//        pnpm exec tsx scripts/smoke/challenges.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiClient, ApiError, type ApiClient } from "../../lib/api/client";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import { acceptChallenge, createChallenge, fetchChallenges, groupChallenges, ignoreChallenge, standingLine } from "../../lib/challenges/challenges";
import { newClientId } from "../../lib/game/actions";
import { submitOnboarding } from "../../lib/onboarding/actions";
import { buildOnboardingPayload, draftFromParams, type IdentitySetting } from "../../lib/onboarding/payload";
import { followPlayer } from "../../lib/social/social";

const baseUrl = process.env.SMOKE_API_URL;
const dbUrl = process.env.SMOKE_DATABASE_URL ?? "";
if (!baseUrl || !dbUrl) {
  console.error("SMOKE_API_URL and SMOKE_DATABASE_URL are required");
  process.exit(2);
}

// `pg` is a dependency of lib/db, not of the app: resolve it from there (a dev-only smoke).
const here = path.dirname(fileURLToPath(import.meta.url));
const requireFromDb = createRequire(path.resolve(here, "../../../../lib/db/package.json"));
interface PgClient {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}
const { Client } = requireFromDb("pg") as { Client: new (opts: { connectionString: string }) => PgClient };

const synced = { flushBeforeMutation: async () => true };
const step = (name: string, detail?: unknown) => console.log(`ok  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);

interface Player {
  api: ApiClient;
  id: string;
  username: string;
}

async function makePlayer(prefix: string, label: string, identity: IdentitySetting): Promise<Player> {
  let stored: Session | null = null;
  const tokens: TokenStore = { get: async () => stored, set: async (s) => void (stored = s) };
  const api = createApiClient({ fetch: (i, init) => fetch(i, init), tokens, baseUrl: baseUrl!, onSessionExpired: () => {} });
  const auth = createAuthActions({ api, tokens, handleSignIn: async () => {}, clearLocalData: async () => {} });
  const username = `${prefix}_${label}`;
  const user = await auth.signUp({
    email: `smoke-ch-${prefix}-${label}@example.com`,
    password: "correct horse battery",
    username,
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 4, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Build a disciplined life",
      weakness: "MIND",
      identity,
    },
    "UTC",
  );
  assert.ok(draft);
  await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-onb-${prefix}-${label}`));
  return { api, id: user.id, username };
}

async function rejectedWith(run: () => Promise<unknown>, status: number, code: string) {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof ApiError, "an ApiError was expected");
    assert.equal(e.status, status);
    assert.equal(e.code, code);
    return;
  }
  assert.fail(`expected ${status} ${code}`);
}

async function main() {
  const prefix = `sh${Date.now().toString(36).slice(-6)}`;
  const challenger = await makePlayer(prefix, "a", "public");
  const opponent = await makePlayer(prefix, "b", "public");
  const second = await makePlayer(prefix, "c", "public");
  step("register + onboard three players", { prefix });

  const draft = { opponent: opponent.username, domain: "MIND" as const, days: 3 as const };
  await rejectedWith(() => createChallenge(challenger.api, synced, draft, newClientId("ch")), 402, "pro_required");
  step("a free player cannot challenge -> 402 pro_required");

  const pg = new Client({ connectionString: dbUrl });
  await pg.connect();
  try {
    for (const p of [challenger, opponent, second]) {
      await pg.query(
        `insert into entitlements (user_id, tier, source, expires_at, updated_at) values ($1, 'pro', 'admin', null, now())
         on conflict (user_id) do update set tier = 'pro', source = 'admin', expires_at = null, updated_at = now()`,
        [p.id],
      );
    }
  } finally {
    await pg.end();
  }

  await rejectedWith(() => createChallenge(challenger.api, synced, draft, newClientId("ch")), 403, "not_eligible");
  step("a stranger is refused -> 403 not_eligible");

  assert.ok((await followPlayer(challenger.api, synced, opponent.username, newClientId("f"))).ok);
  assert.ok((await followPlayer(challenger.api, synced, second.username, newClientId("f"))).ok);
  const made = await createChallenge(challenger.api, synced, draft, newClientId("ch"));
  assert.ok(made.ok);
  assert.equal(made.value.status, "pending");
  assert.equal(made.value.opponent.handle, opponent.username);
  step("a followed player can be challenged", { id: made.value.id });

  const incoming = groupChallenges(await fetchChallenges(opponent.api)).incoming;
  assert.deepEqual(incoming.map((c) => c.id), [made.value.id]);
  const accepted = await acceptChallenge(opponent.api, synced, made.value.id, newClientId("acc"));
  assert.ok(accepted.ok);
  assert.equal(accepted.value.status, "active");
  step("the opponent sees it incoming and accepts", { endDate: accepted.value.endDate });

  for (const p of [challenger, opponent]) {
    const active = groupChallenges(await fetchChallenges(p.api)).active;
    assert.equal(active.length, 1);
    assert.equal(typeof active[0]!.myGain, "number");
    assert.equal(typeof active[0]!.theirGain, "number");
    assert.ok(["TIED", ""].includes(standingLine(active[0]!)) || /^(LEADING|TRAILING) BY /.test(standingLine(active[0]!)));
    assert.ok(!/hidden|userId/i.test(JSON.stringify(active)));
  }
  step("both sides see the live gain comparison (domain gains only)");

  const toIgnore = await createChallenge(challenger.api, synced, { opponent: second.username, domain: "BODY", days: 7 }, newClientId("ch"));
  assert.ok(toIgnore.ok);
  assert.ok((await ignoreChallenge(second.api, synced, toIgnore.value.id, newClientId("ign"))).ok);
  const seen = (await fetchChallenges(challenger.api)).find((c) => c.id === toIgnore.value.id)!;
  assert.equal(seen.status, "ignored");
  assert.equal(seen.line, "Challenge ignored. Logged.");
  step("an ignored challenge reads 'Challenge ignored. Logged.' to the challenger");

  console.log("smoke: challenges OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

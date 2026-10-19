// Smoke: clans against a running API.
// A free leader cannot found a clan (402) -> the leader is made PRO + verified straight in the database (the P5
// entitlement stub has no self-serve path; email codes only reach the API log) -> found a clan (forming, 1/8) ->
// 7 players join by invite code -> active at 8 -> the leader leaving -> 409 leader_must_transfer -> transfer ->
// the old leader leaves -> back to forming at 7; the members payload shows usernames.
// Registers 8 accounts: the API's register limiter allows 10 per 15 minutes per IP, so run it once per window.
// Usage: SMOKE_API_URL=http://localhost:3001 SMOKE_DATABASE_URL=postgres://system_self:system_self@localhost:5432/system_self \
//        pnpm exec tsx scripts/smoke/clans.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiClient, ApiError, type ApiClient } from "../../lib/api/client";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import { newClientId } from "../../lib/game/actions";
import { submitOnboarding } from "../../lib/onboarding/actions";
import { buildOnboardingPayload, draftFromParams, type IdentitySetting } from "../../lib/onboarding/payload";
import { createClan, fetchMyClan, joinClanByCode, leaveClan, searchClans, transferClanLeader } from "../../lib/clan/clan";

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
    email: `smoke-clans-${prefix}-${label}@example.com`,
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
  const prefix = `sc${Date.now().toString(36).slice(-6)}`;
  const leader = await makePlayer(prefix, "lead", "semi-public");
  step("register + onboard the leader", { prefix });

  const draft = { name: `Smoke ${prefix}`, tag: "SMK", description: "Smoke clan." };
  await rejectedWith(() => createClan(leader.api, synced, draft, newClientId("clan")), 402, "pro_required");
  step("a free player cannot found a clan -> 402 pro_required");

  const pg = new Client({ connectionString: dbUrl });
  await pg.connect();
  try {
    await pg.query(
      `insert into entitlements (user_id, tier, source, expires_at, updated_at) values ($1, 'pro', 'admin', null, now())
       on conflict (user_id) do update set tier = 'pro', source = 'admin', expires_at = null, updated_at = now()`,
      [leader.id],
    );
    await rejectedWith(() => createClan(leader.api, synced, draft, newClientId("clan")), 403, "email_unverified");
    step("PRO without a verified email -> 403 email_unverified");
    await pg.query("update users set email_verified_at = now() where id = $1", [leader.id]);
  } finally {
    await pg.end();
  }

  const made = await createClan(leader.api, synced, draft, newClientId("clan"));
  assert.ok(made.ok);
  const clan = made.value;
  assert.equal(clan.status, "forming");
  assert.equal(clan.memberCount, 1);
  assert.equal(clan.myRole, "leader");
  step("PRO + verified founds a forming clan", { tag: clan.tag, inviteCode: clan.inviteCode });

  const found = await searchClans(leader.api, prefix);
  assert.deepEqual(found.map((c) => c.id), [clan.id]);
  step("the clan is found by name");

  const members: Player[] = [];
  for (let i = 1; i <= 7; i++) {
    const p = await makePlayer(prefix, `m${i}`, i % 2 ? "anonymous" : "semi-public");
    const joined = await joinClanByCode(p.api, synced, clan.inviteCode.toLowerCase(), newClientId("join"));
    assert.ok(joined.ok);
    members.push(p);
    const mine = await fetchMyClan(p.api);
    assert.equal(mine.clan!.status, i + 1 >= 8 ? "active" : "forming");
  }
  const full = await fetchMyClan(leader.api);
  assert.equal(full.clan!.memberCount, 8);
  assert.equal(full.clan!.status, "active");
  assert.deepEqual(new Set(full.members.map((m) => m.profile.handle)), new Set([leader.username, ...members.map((m) => m.username)]));
  assert.ok(full.members.every((m) => !m.profile.isCodename));
  assert.ok(!/hidden/i.test(JSON.stringify(full)));
  step("7 players join by invite code -> active at 8; members shown by username", { dispatches: full.dispatches.length });

  await rejectedWith(() => joinClanByCode(members[0]!.api, synced, clan.inviteCode, newClientId("join")), 409, "already_in_clan");
  step("joining a second time -> 409 already_in_clan");

  await rejectedWith(() => leaveClan(leader.api, synced, newClientId("leave")), 409, "leader_must_transfer");
  step("the leader leaving with members -> 409 leader_must_transfer");

  const heir = members[0]!;
  assert.ok((await transferClanLeader(leader.api, synced, heir.id, newClientId("lead"))).ok);
  assert.equal((await fetchMyClan(heir.api)).clan!.myRole, "leader");
  step("leadership transferred", { to: heir.username });

  assert.ok((await leaveClan(leader.api, synced, newClientId("leave"))).ok);
  assert.equal((await fetchMyClan(leader.api)).clan, null);
  const after = await fetchMyClan(heir.api);
  assert.equal(after.clan!.memberCount, 7);
  assert.equal(after.clan!.status, "forming");
  step("the old leader leaves -> 7 members, forming again");

  console.log("SMOKE clans PASSED");
}

main().catch((err) => {
  console.error("SMOKE clans FAILED", err);
  process.exit(1);
});

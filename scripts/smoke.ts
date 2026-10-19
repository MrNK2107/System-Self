// End-to-end smoke test against a running API (local dev server, the prod compose stack, CI, staging).
// One run, one fresh account:
//   register -> onboard -> log -> generate quests -> complete one -> refuse one -> debrief -> export -> delete
//   -> the deleted account's login fails.
// Works with MAILER=log (nothing it touches is gated on email verification) and with no GEMINI_API_KEY
// (template mode). Exits 1 on the first failed step, naming it.
//
// Usage: SMOKE_BASE_URL=http://localhost:8080 pnpm --filter @workspace/scripts smoke
//   SMOKE_BASE_URL  the API origin, without /api (default http://localhost:3001)
//   SMOKE_TIMEOUT_MS per-request timeout (default 15000)
//   SMOKE_EMAIL_DOMAIN domain of the throwaway account's email (default example.com). Registration mails a
//                    verification code to it: against a production API with real mail, use a domain you own or a
//                    mailbox sink, never example.com (bounces hurt the sending domain's reputation). docs/RUNBOOK.md
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

const baseUrl = (process.env.SMOKE_BASE_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 15_000);
const emailDomain = (process.env.SMOKE_EMAIL_DOMAIN ?? "").trim().replace(/^@/, "") || "example.com";
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(emailDomain)) {
  console.error(`SMOKE_EMAIL_DOMAIN "${emailDomain}" is not a domain`);
  process.exit(1);
}

type Json = Record<string, unknown>;
interface Reply {
  status: number;
  headers: Headers;
  text: string;
  body: Json;
}

let accessToken: string | null = null;

async function call(method: string, path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<Reply> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (opts.auth !== false && accessToken) headers.authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let parsed: Json = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Json;
    } catch {
      parsed = {};
    }
  }
  return { status: res.status, headers: res.headers, text, body: parsed };
}

/** Asserts the status, with the response body in the message so a failure explains itself. */
function expectStatus(r: Reply, expected: number, what: string): void {
  if (r.status !== expected) {
    const id = r.headers.get("x-request-id");
    throw new Error(`${what}: expected HTTP ${expected}, got ${r.status}${id ? ` (x-request-id ${id})` : ""}: ${r.text.slice(0, 500)}`);
  }
}

let current = "startup";
const started = Date.now();
/** Runs one named step; its return value is printed as the step's detail. */
async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  current = name;
  const t0 = Date.now();
  const out = await fn();
  console.log(`ok   ${name.padEnd(20)} ${String(Date.now() - t0).padStart(5)} ms${out === undefined ? "" : `  ${JSON.stringify(out)}`}`);
}

/** Collects every object key in a JSON value (recursively). */
function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) allKeys(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

interface Quest {
  id: string;
  type: string;
  domain: string;
  status: string;
}

async function main(): Promise<void> {
  console.log(`smoke against ${baseUrl}`);
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const email = `smoke-${suffix}@${emailDomain}`;
  const password = `smoke-${randomBytes(12).toString("base64url")}`;
  let userId = "";
  let quests: Quest[] = [];
  let debriefDate = "";

  await step("readyz", async () => {
    const r = await call("GET", "/readyz", undefined, { auth: false });
    expectStatus(r, 200, "GET /api/readyz");
    assert.equal(r.body.status, "ready");
    return { db: r.body.db, ai: r.body.ai };
  });

  await step("register", async () => {
    const r = await call(
      "POST",
      "/auth/register",
      { email, password, username: `smoke_${suffix}`.slice(0, 20), birthYear: 1995, acceptTerms: true, timezone: "UTC" },
      { auth: false },
    );
    expectStatus(r, 201, "POST /api/auth/register");
    assert.equal(typeof r.body.accessToken, "string", "register returns an access token");
    accessToken = r.body.accessToken as string;
    const user = r.body.user as Json;
    userId = String(user.id);
    // Nothing below needs a verified email (MAILER=log redacts the code in production mode).
    return { userId, emailVerified: user.emailVerified ?? null };
  });

  await step("onboard", async () => {
    const r = await call("POST", "/onboarding", {
      ratings: { BODY: 5, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 },
      primaryGoal: "Build an unbreakable daily routine",
      biggestWeakness: "DISCIPLINE",
      identitySetting: "semi-public",
      morningTime: "07:00",
      // 00:00 opens today's debrief at local midnight, so the debrief step below is always available.
      nightlyTime: "00:00",
      timezone: "UTC",
      clientId: `smoke-onboarding-${suffix}`,
    });
    expectStatus(r, 201, "POST /api/onboarding");
    const profile = r.body.profile as Json;
    assert.equal(profile.onboarded, true, "profile is onboarded");
    return { rank: profile.rank };
  });

  await step("log", async () => {
    const r = await call("POST", "/logs", {
      clientId: `smoke-log-${randomUUID()}`,
      domain: "BODY",
      logType: "workout",
      data: { minutes: 30, intensity: 3 },
    });
    expectStatus(r, 201, "POST /api/logs");
    const results = r.body.results as Array<{ domain: string; actualDelta: number }>;
    assert.ok(Array.isArray(results) && results.length > 0, "the log scored");
    return { results: results.map((x) => `${x.domain} ${x.actualDelta >= 0 ? "+" : ""}${x.actualDelta}`) };
  });

  await step("generate quests", async () => {
    const r = await call("POST", "/quests/generate", { clientId: `smoke-gen-${randomUUID()}` });
    expectStatus(r, 200, "POST /api/quests/generate");
    quests = r.body.active as Quest[];
    assert.equal(r.body.generated, true, "quests were generated");
    assert.ok(quests.filter((q) => q.type === "daily").length >= 2, "at least two daily quests");
    return { active: quests.length, types: quests.map((q) => q.type) };
  });

  await step("complete quest", async () => {
    const q = quests.find((x) => x.type === "daily")!;
    const r = await call("POST", `/quests/${q.id}/complete`, { clientId: `smoke-qc-${randomUUID()}` });
    expectStatus(r, 200, "POST /api/quests/:id/complete");
    assert.equal((r.body.quest as Quest).status, "complete");
    return { id: q.id, domain: q.domain };
  });

  await step("refuse quest", async () => {
    const q = quests.filter((x) => x.type === "daily")[1]!;
    const r = await call("POST", `/quests/${q.id}/refuse`, { reason: "smoke test refusal", clientId: `smoke-qr-${randomUUID()}` });
    expectStatus(r, 200, "POST /api/quests/:id/refuse");
    assert.equal((r.body.quest as Quest).status, "refused");
    return { id: q.id, penalty: r.body.penalty };
  });

  await step("debrief", async () => {
    const r = await call("GET", "/debrief/today");
    expectStatus(r, 200, "GET /api/debrief/today");
    assert.equal(r.body.available, true, `debrief available (got ${r.text.slice(0, 200)})`);
    const d = r.body.debrief as Json;
    assert.ok(typeof d.text === "string" && d.text.length > 0, "debrief has text");
    debriefDate = String(d.date);
    const ack = await call("POST", `/debrief/${debriefDate}/ack`, { clientId: `smoke-ack-${randomUUID()}` });
    expectStatus(ack, 204, "POST /api/debrief/:date/ack");
    return { date: debriefDate, verdict: d.verdict, questCompleted: d.questCompleted, questTotal: d.questTotal };
  });

  await step("export", async () => {
    const r = await call("GET", "/account/export");
    expectStatus(r, 200, "GET /api/account/export");
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/, "export is JSON");
    const doc = JSON.parse(r.text) as unknown; // throws (and fails the step) if it is not JSON
    const keys = [...allKeys(doc)];
    const leaked = keys.filter((k) => /password|hash/i.test(k));
    assert.deepEqual(leaked, [], `export carries no password fields (found ${leaked.join(", ")})`);
    assert.ok(!r.text.includes("$argon2"), "export carries no argon2 hash");
    assert.ok(!r.text.includes(password), "export carries no plaintext password");
    assert.ok(r.text.includes(userId), "export is about this user");
    return { bytes: Buffer.byteLength(r.text), topLevel: Object.keys(doc as Json).length };
  });

  await step("delete account", async () => {
    const r = await call("DELETE", "/auth/account", { password });
    expectStatus(r, 204, "DELETE /api/auth/account");
  });

  await step("login after delete", async () => {
    const r = await call("POST", "/auth/login", { email, password }, { auth: false });
    expectStatus(r, 401, "POST /api/auth/login (deleted account)");
    return { status: r.status };
  });

  console.log(`SMOKE PASSED in ${Date.now() - started} ms`);
}

main().catch((err: unknown) => {
  console.error(`FAIL ${current}: ${err instanceof Error ? err.message : String(err)}`);
  console.error("SMOKE FAILED");
  process.exit(1);
});

/**
 * Load runner (autocannon) against a running API seeded by seed.ts:
 *   - state: GET /api/state at 100 req/s for 60 s (target p95 < 250 ms)
 *   - logs:  POST /api/logs at 50 req/s for 60 s (target p95 < 300 ms), unique clientId + Idempotency-Key each
 * Requests rotate over the seeded users' tokens. Prints p50/p95/p99, error and status counts, and writes JSON
 * results to scripts/load/results/.
 *
 *   LOAD_BASE_URL=http://127.0.0.1:3001 pnpm --filter @workspace/scripts load:run [--scenario state|logs|all]
 *     [--duration 60] [--state-rate 100] [--logs-rate 50] [--connections 32] [--label baseline]
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import autocannon from "autocannon";
import { RESULTS_DIR, TOKENS_FILE, argValue, randomLog, type TokensFile } from "./common";

const BASE = (process.env.LOAD_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const DURATION = Number(argValue("duration") ?? 60);
const CONNECTIONS = Number(argValue("connections") ?? 32);
const SCENARIO = argValue("scenario") ?? "all";
const LABEL = argValue("label") ?? "run";
const WARMUP = Number(argValue("warmup") ?? 5);

type Scenario = { name: "state" | "logs"; rate: number; targetP95: number };
const SCENARIOS: Scenario[] = [
  { name: "state", rate: Number(argValue("state-rate") ?? 100), targetP95: 250 },
  { name: "logs", rate: Number(argValue("logs-rate") ?? 50), targetP95: 300 },
];

const tokens = (JSON.parse(readFileSync(TOKENS_FILE, "utf8")) as TokensFile).users.map((u) => u.token);
if (tokens.length === 0) throw new Error(`no tokens in ${TOKENS_FILE}: run seed.ts first`);
let turn = 0;
const nextToken = () => tokens[turn++ % tokens.length]!;

function request(name: Scenario["name"]): autocannon.Request {
  if (name === "state") {
    return {
      method: "GET",
      path: "/api/state",
      setupRequest: (req) => ({ ...req, headers: { ...req.headers, authorization: `Bearer ${nextToken()}` } }),
    };
  }
  return {
    method: "POST",
    path: "/api/logs",
    setupRequest: (req) => {
      const clientId = `load-${randomUUID()}`;
      return {
        ...req,
        headers: {
          ...req.headers,
          authorization: `Bearer ${nextToken()}`,
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        body: JSON.stringify({ clientId, ...randomLog() }),
      };
    },
  };
}

const pct = (sorted: number[], p: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!);
const round = (n: number) => Math.round(n * 10) / 10;

async function fire(s: Scenario, duration: number, rate: number) {
  const latencies: number[] = [];
  const statuses: Record<string, number> = {};
  let done!: (r: autocannon.Result) => void;
  let fail!: (e: unknown) => void;
  const finished = new Promise<autocannon.Result>((resolve, reject) => ((done = resolve), (fail = reject)));
  const instance = autocannon(
    { url: BASE, connections: CONNECTIONS, overallRate: rate, duration, timeout: 10, requests: [request(s.name)] },
    (err, res) => (err ? fail(err) : done(res)),
  );
  instance.on("response", (_client, statusCode, _bytes, responseTime) => {
    latencies.push(responseTime);
    statuses[statusCode] = (statuses[statusCode] ?? 0) + 1;
  });
  const result = await finished;
  latencies.sort((a, b) => a - b);
  return { result, latencies, statuses };
}

async function runScenario(s: Scenario) {
  if (WARMUP > 0) await fire(s, WARMUP, Math.max(5, Math.round(s.rate / 4)));
  const { result, latencies, statuses } = await fire(s, DURATION, s.rate);
  const fivexx = Object.entries(statuses).filter(([code]) => code.startsWith("5")).reduce((n, [, c]) => n + c, 0);
  const p95 = round(pct(latencies, 95));
  const summary = {
    scenario: s.name,
    targetRate: s.rate,
    achievedRate: round(latencies.length / DURATION),
    durationSec: DURATION,
    connections: CONNECTIONS,
    requests: latencies.length,
    latencyMs: {
      p50: round(pct(latencies, 50)),
      p95,
      p99: round(pct(latencies, 99)),
      max: round(latencies[latencies.length - 1] ?? 0),
      mean: round(latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length)),
    },
    statuses,
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
    fivexx,
    targetP95Ms: s.targetP95,
    pass: p95 < s.targetP95 && fivexx === 0 && result.errors === 0,
  };
  const l = summary.latencyMs;
  console.log(
    `${s.name.padEnd(5)} ${summary.achievedRate}/${s.rate} req/s  p50 ${l.p50} ms  p95 ${l.p95} ms  p99 ${l.p99} ms  max ${l.max} ms  ` +
      `statuses ${JSON.stringify(statuses)}  errors ${result.errors}  timeouts ${result.timeouts}  ` +
      `${summary.pass ? "PASS" : "FAIL"} (p95 < ${s.targetP95} ms, zero 5xx)`,
  );
  return summary;
}

const picked = SCENARIOS.filter((s) => SCENARIO === "all" || s.name === SCENARIO);
if (picked.length === 0) throw new Error(`unknown --scenario ${SCENARIO} (state | logs | all)`);
console.log(`target ${BASE}, ${tokens.length} users, ${CONNECTIONS} connections, ${DURATION}s per scenario (+${WARMUP}s warmup)`);
const results = [];
for (const s of picked) results.push(await runScenario(s));

mkdirSync(RESULTS_DIR, { recursive: true });
const file = path.join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${LABEL}.json`);
writeFileSync(file, JSON.stringify({ label: LABEL, base: BASE, at: new Date().toISOString(), results }, null, 2));
console.log(`results: ${file}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);

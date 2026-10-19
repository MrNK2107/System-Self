import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("nginx lets the 5 MB voice upload through (client_max_body_size >= 6m; nginx's default 1m would 413 it)", () => {
  const conf = readFileSync(path.join(repo, "deploy/nginx.conf"), "utf8");
  const m = /client_max_body_size\s+(\d+)([km]?)\s*;/i.exec(conf);
  assert.ok(m, "client_max_body_size is set");
  const unit = { "": 1, k: 1024, m: 1024 * 1024 }[m[2]!.toLowerCase() as "" | "k" | "m"];
  assert.ok(Number(m[1]) * unit >= 6 * 1024 * 1024);
});

// --- P8 final review: CI coverage, compose binding, entrypoint, Render, shutdown budgets ---
import { spawnSync } from "node:child_process";

const read = (p: string) => readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
/** The YAML block of one compose service (from `  name:` to the next 2-space key). */
const composeService = (yaml: string, name: string) => {
  const m = new RegExp(`\n  ${name}:[^\n]*\n((?:    [^\n]*\n|\s*\n)*)`).exec(yaml);
  assert.ok(m, `service ${name}`);
  return m[1]!;
};
/** The YAML block of one render.yaml service (from `- type:` ... `name: <name>` to the next `- type:`). */
const renderService = (yaml: string, name: string) => {
  const blocks = yaml.split(/\n  - type: /);
  const b = blocks.find((x) => new RegExp(`\n    name: ${name}\n`).test(x));
  assert.ok(b, `render service ${name}`);
  return b;
};

test("CI validate runs every workspace package's tests (engine included) and the drizzle drift check", () => {
  const ci = read(".github/workflows/ci.yml");
  const validate = ci.slice(ci.indexOf("  validate:"), ci.indexOf("\n  app-export:"));
  for (const pkg of ["db", "engine", "api-server", "system-self"]) {
    assert.match(validate, new RegExp(`pnpm --filter @workspace/${pkg} test`), pkg);
  }
  for (const dir of ["lib", "artifacts"]) {
    for (const name of readdirSync(path.join(repo, dir))) {
      let pkg: { name?: string; scripts?: { test?: string } };
      try {
        pkg = JSON.parse(read(`${dir}/${name}/package.json`));
      } catch {
        continue;
      }
      if (pkg.scripts?.test) assert.ok(validate.includes(`pnpm --filter ${pkg.name} test`), `${pkg.name} has tests but CI skips them`);
    }
  }
  assert.match(validate, /drizzle-kit generate/);
  assert.match(validate, /git diff --exit-code[^\n]*lib\/db\/migrations/);
  assert.match(validate, /git status --porcelain[^\n]*lib\/db\/migrations/);
  assert.match(validate, /sh scripts\/docker-entrypoint\.test\.sh/);
});

test("compose: direct API ports bind to loopback only; nginx is the public door", () => {
  const compose = read("docker-compose.prod.yml");
  assert.match(composeService(compose, "api1"), /- "127\.0\.0\.1:3011:3001"/);
  assert.match(composeService(compose, "api2"), /- "127\.0\.0\.1:3012:3001"/);
  assert.doesNotMatch(compose, /- "301[12]:3001"/);
});

test("compose: worker healthcheck on its heartbeat file; stop grace periods cover the in-process budgets", () => {
  const compose = read("docker-compose.prod.yml");
  const worker = composeService(compose, "worker");
  assert.match(worker, /WORKER_HEARTBEAT_FILE: \/tmp\/worker-heartbeat/);
  assert.match(worker, /healthcheck:[\s\S]*find \/tmp\/worker-heartbeat -mmin -5/);
  assert.match(worker, /stop_grace_period: 75s/);
  const index = read("artifacts/api-server/src/index.ts");
  const hard = Number(/HARD_TIMEOUT_MS = ([\d_]+)/.exec(index)![1]!.replace(/_/g, ""));
  const exit = Number(/EXIT_BUDGET_MS = ([\d_]+)/.exec(index)![1]!.replace(/_/g, ""));
  assert.equal(hard, 20_000);
  // Production drain (5 s) + the process backstop must land inside the 30 s grace (compose and Render).
  assert.match(compose, /x-app: &app[\s\S]*?stop_grace_period: 30s/);
  assert.ok(5_000 + hard <= 30_000 && 5_000 + exit < 30_000, `5000 + ${exit} < 30000`);
  const workerSrc = read("artifacts/api-server/src/worker.ts");
  const workerExit = Number(/WORKER_EXIT_BUDGET_MS = ([\d_]+)/.exec(workerSrc)![1]!.replace(/_/g, ""));
  assert.ok(workerExit < 75_000, "worker backstop fires before compose/Render SIGKILL");
});

test("compose and .env.prod.example default DB passwords are placeholders the production env guard refuses", async () => {
  const { parseEnv } = await import("./lib/env");
  const compose = read("docker-compose.prod.yml");
  const def = /POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:-([^}]+)\}/.exec(compose)![1]!;
  const example = /^DATABASE_URL=(.+)$/m.exec(read(".env.prod.example"))![1]!;
  assert.ok(example.includes(`:${def}@`), "example DATABASE_URL uses the compose default password");
  const base = { NODE_ENV: "production", JWT_SECRET: "x".repeat(40), CORS_ORIGIN: "https://a.b", MAILER: "log" };
  assert.throws(() => parseEnv({ ...base, DATABASE_URL: example }), /DATABASE_URL/);
  assert.match(read(".env.prod.example"), /2 if a TLS proxy\/LB sits in front of nginx[^\n]*\nTRUST_PROXY=1\n/);
  // docker-smoke generates a hex password (never a placeholder) and keeps it in sync with DATABASE_URL.
  const smoke = read("scripts/docker-smoke.sh");
  assert.match(smoke, /POSTGRES_PASSWORD="\$\(rand\)"/);
  assert.match(smoke, /DATABASE_URL=postgres:\/\/system_self:\$\{POSTGRES_PASSWORD\}@/);
});

test("render.yaml: both services migrate pre-deploy via the entrypoint's role argument; shutdown delays set", () => {
  const render = read("render.yaml");
  const api = renderService(render, "system-self-api");
  const worker = renderService(render, "system-self-worker");
  for (const svc of [api, worker]) assert.match(svc, /\n    preDeployCommand: docker-entrypoint\.sh migrate\n/);
  assert.match(api, /\n    maxShutdownDelaySeconds: 30\n/);
  assert.match(worker, /\n    maxShutdownDelaySeconds: 75\n/);
  // MAIL_FROM has a working default in env.ts; it is not a prompted secret.
  assert.doesNotMatch(render, /key: MAIL_FROM\n\s+sync: false/);
});

test("docker-entrypoint.sh: role from ROLE or $1, explicit commands run as given (shell test)", () => {
  const r = spawnSync("sh", [path.join(repo, "scripts/docker-entrypoint.test.sh")], { encoding: "utf8" });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /entrypoint tests passed/);
});

test("every documented `expo start` passes --go (expo-dev-client would otherwise start in dev-client mode)", () => {
  const files = ["README.md", "artifacts/system-self/package.json"];
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(repo, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith(".md") && rel !== "docs/DECISIONS.md") files.push(rel);
    }
  };
  walk("docs");
  let seen = 0;
  for (const f of files) {
    for (const line of read(f).split("\n")) {
      if (!/expo start/.test(line)) continue;
      seen++;
      for (const cmd of line.match(/expo start[^`"\n]*/g) ?? []) assert.match(cmd, /--go\b/, `${f}: ${line.trim()}`);
    }
  }
  assert.ok(seen >= 3, "README, the dev script and HOLD H-10 mention expo start");
  assert.match(read("docs/RELEASE.md"), /Expo Go keeps working[^\n]*--go/);
});

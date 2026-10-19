import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatEnvError, parseEnv } from "./env";

const STRONG = "k3Jx9vQ2mP7rT5wZ8nB4cF6hL1sD0aGyE";
const PROD_REQUIRED = { DATABASE_URL: "postgres://u:p@db:5432/x", CORS_ORIGIN: "https://app.systemself.app" };
const PROD_BASE = { NODE_ENV: "production", JWT_SECRET: STRONG, RESEND_API_KEY: "re_live_key", ...PROD_REQUIRED };

function exampleValue(name: string): string {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env.example");
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  assert.ok(line, `${name} missing from .env.example`);
  return line.slice(name.length + 1).trim();
}

test("NODE_ENV unset and no JWT_SECRET -> throws", () => {
  assert.throws(() => parseEnv({}), /JWT_SECRET/);
});

test("dev default JWT_SECRET only with explicit development or test", () => {
  assert.equal(typeof parseEnv({ NODE_ENV: "development" }).JWT_SECRET, "string");
  assert.equal(typeof parseEnv({ NODE_ENV: "test" }).JWT_SECRET, "string");
  assert.throws(() => parseEnv({ NODE_ENV: "production", RESEND_API_KEY: "re_x" }), /JWT_SECRET/);
});

test("production with the .env.example JWT_SECRET -> throws", () => {
  const value = exampleValue("JWT_SECRET");
  assert.match(value, /change-me/);
  assert.throws(() => parseEnv({ ...PROD_BASE, JWT_SECRET: value }), /JWT_SECRET/);
});

test("non-dev JWT_SECRET must be >= 32 chars and not contain change-me", () => {
  assert.throws(() => parseEnv({ ...PROD_BASE, JWT_SECRET: "short" }), /JWT_SECRET/);
  assert.throws(() => parseEnv({ ...PROD_BASE, JWT_SECRET: `my-secret-CHANGE-ME-${STRONG}` }), /JWT_SECRET/);
  assert.throws(() => parseEnv({ JWT_SECRET: "dev-insecure-secret-change-me-0123456789" }), /JWT_SECRET/);
  assert.equal(parseEnv(PROD_BASE).JWT_SECRET, STRONG);
  assert.equal(parseEnv({ JWT_SECRET: STRONG, RESEND_API_KEY: "re_x", ...PROD_REQUIRED }).JWT_SECRET, STRONG);
});

test("production requires RESEND_API_KEY unless MAILER=log", () => {
  assert.throws(() => parseEnv({ NODE_ENV: "production", JWT_SECRET: STRONG, ...PROD_REQUIRED }), /RESEND_API_KEY/);
  assert.equal(parseEnv({ NODE_ENV: "production", JWT_SECRET: STRONG, MAILER: "log", ...PROD_REQUIRED }).MAILER, "log");
  assert.doesNotThrow(() => parseEnv(PROD_BASE));
  assert.doesNotThrow(() => parseEnv({ NODE_ENV: "development" }));
});

test("TRUST_PROXY: unset=false, true/false, integer hop count; garbage rejected", () => {
  assert.equal(parseEnv({ NODE_ENV: "test" }).TRUST_PROXY, false);
  assert.equal(parseEnv({ NODE_ENV: "test", TRUST_PROXY: "true" }).TRUST_PROXY, true);
  assert.equal(parseEnv({ NODE_ENV: "test", TRUST_PROXY: "false" }).TRUST_PROXY, false);
  assert.equal(parseEnv({ NODE_ENV: "test", TRUST_PROXY: "1" }).TRUST_PROXY, 1);
  assert.equal(parseEnv({ NODE_ENV: "test", TRUST_PROXY: "2" }).TRUST_PROXY, 2);
  assert.throws(() => parseEnv({ NODE_ENV: "test", TRUST_PROXY: "yes" }), /TRUST_PROXY/);
  assert.throws(() => parseEnv({ NODE_ENV: "test", TRUST_PROXY: "-1" }), /TRUST_PROXY/);
});

test("production rejects placeholder secrets (REPLACE / CHANGE / example, any case)", () => {
  for (const bad of ["k3Jx9vQ2mP7rT5wZ8nB4cF6hL1sD0aGy-REPLACE", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxCHANGEme", "my-Example-secret-with-enough-length-1234"]) {
    assert.throws(() => parseEnv({ ...PROD_BASE, JWT_SECRET: bad }), /JWT_SECRET/, bad);
  }
  assert.throws(() => parseEnv({ ...PROD_BASE, REVENUECAT_WEBHOOK_SECRET: "example-webhook-secret" }), /REVENUECAT_WEBHOOK_SECRET/);
  assert.throws(() => parseEnv({ ...PROD_BASE, METRICS_TOKEN: "please-CHANGE-this" }), /METRICS_TOKEN/);
  assert.doesNotThrow(() => parseEnv({ ...PROD_BASE, REVENUECAT_WEBHOOK_SECRET: STRONG, METRICS_TOKEN: STRONG }));
  // development stays relaxed
  assert.doesNotThrow(() => parseEnv({ NODE_ENV: "development", REVENUECAT_WEBHOOK_SECRET: "example" }));
});

test(".env.prod.example secrets trip the production guard", () => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.env.prod.example");
  const vars: Record<string, string> = {};
  for (const l of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(l);
    if (m) vars[m[1]!] = m[2]!.replace(/^"|"$/g, "");
  }
  assert.throws(() => parseEnv(vars), /placeholder/);
});

test("production requires CORS_ORIGIN, without any wildcard; a comma-separated list is fine", () => {
  const { CORS_ORIGIN: _omit, ...noCors } = PROD_BASE;
  assert.throws(() => parseEnv(noCors), /CORS_ORIGIN/);
  assert.throws(() => parseEnv({ ...PROD_BASE, CORS_ORIGIN: "" }), /CORS_ORIGIN/);
  assert.throws(() => parseEnv({ ...PROD_BASE, CORS_ORIGIN: "*" }), /CORS_ORIGIN/);
  assert.throws(() => parseEnv({ ...PROD_BASE, CORS_ORIGIN: "https://a.app, *" }), /CORS_ORIGIN/);
  assert.equal(parseEnv({ ...PROD_BASE, CORS_ORIGIN: "https://a.app, https://b.app" }).CORS_ORIGIN, "https://a.app, https://b.app");
  // development stays relaxed: unset means "*"
  assert.doesNotThrow(() => parseEnv({ NODE_ENV: "development" }));
});

test("production requires DATABASE_URL", () => {
  const { DATABASE_URL: _omit, ...noDb } = PROD_BASE;
  assert.throws(() => parseEnv(noDb), /DATABASE_URL/);
  assert.doesNotThrow(() => parseEnv({ NODE_ENV: "test" }));
});

test("JWT_SECRET_PREVIOUS: optional, >= 32 chars and no placeholder in production", () => {
  assert.equal(parseEnv(PROD_BASE).JWT_SECRET_PREVIOUS, undefined);
  assert.equal(parseEnv({ ...PROD_BASE, JWT_SECRET_PREVIOUS: `${STRONG}-old` }).JWT_SECRET_PREVIOUS, `${STRONG}-old`);
  assert.throws(() => parseEnv({ ...PROD_BASE, JWT_SECRET_PREVIOUS: "short" }), /JWT_SECRET_PREVIOUS/);
  assert.throws(() => parseEnv({ ...PROD_BASE, JWT_SECRET_PREVIOUS: `REPLACE-${STRONG}` }), /JWT_SECRET_PREVIOUS/);
});

test("DB_POOL_MAX defaults to 10 and must be a positive integer", () => {
  assert.equal(parseEnv({ NODE_ENV: "test" }).DB_POOL_MAX, 10);
  assert.equal(parseEnv({ NODE_ENV: "test", DB_POOL_MAX: "25" }).DB_POOL_MAX, 25);
  assert.throws(() => parseEnv({ NODE_ENV: "test", DB_POOL_MAX: "0" }), /DB_POOL_MAX/);
});

test("RATE_LIMIT_DISABLED: refused in production unless LOAD_TEST=1; allowed in development/test; typos rejected", () => {
  assert.throws(() => parseEnv({ ...PROD_BASE, RATE_LIMIT_DISABLED: "1" }), /RATE_LIMIT_DISABLED/);
  // NODE_ENV unset is production-like.
  const { NODE_ENV: _unset, ...noNodeEnv } = PROD_BASE;
  assert.throws(() => parseEnv({ ...noNodeEnv, RATE_LIMIT_DISABLED: "1" }), /RATE_LIMIT_DISABLED/);
  assert.throws(() => parseEnv({ ...PROD_BASE, RATE_LIMIT_DISABLED: "1", LOAD_TEST: "0" }), /RATE_LIMIT_DISABLED/);
  assert.throws(() => parseEnv({ ...PROD_BASE, RATE_LIMIT_DISABLED: "1", LOAD_TEST: "true" }), /LOAD_TEST/);
  assert.throws(() => parseEnv({ ...PROD_BASE, RATE_LIMIT_DISABLED: "yes", LOAD_TEST: "1" }), /RATE_LIMIT_DISABLED/);
  const load = parseEnv({ ...PROD_BASE, RATE_LIMIT_DISABLED: "1", LOAD_TEST: "1" });
  assert.equal(load.RATE_LIMIT_DISABLED, true);
  assert.equal(load.LOAD_TEST, true);
  assert.equal(parseEnv(PROD_BASE).RATE_LIMIT_DISABLED, false);
  assert.equal(parseEnv({ ...PROD_BASE, LOAD_TEST: "1" }).RATE_LIMIT_DISABLED, false, "LOAD_TEST alone changes nothing");
  assert.equal(parseEnv({ NODE_ENV: "development", RATE_LIMIT_DISABLED: "1" }).RATE_LIMIT_DISABLED, true);
  assert.equal(parseEnv({ NODE_ENV: "test", RATE_LIMIT_DISABLED: "1" }).RATE_LIMIT_DISABLED, true);
});

test("formatEnvError names every offending variable on one line each", () => {
  let message = "";
  try {
    parseEnv({ NODE_ENV: "production", JWT_SECRET: "short", MAILER: "log" });
  } catch (err) {
    message = formatEnvError(err);
  }
  assert.match(message, /^Invalid environment/);
  assert.match(message, /JWT_SECRET: .*32/);
  assert.match(message, /CORS_ORIGIN: /);
  assert.match(message, /DATABASE_URL: /);
});

test("production boot without CORS_ORIGIN exits 1 with a clear message", () => {
  const { CORS_ORIGIN: _omit, ...noCors } = PROD_BASE;
  const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "env.ts");
  const r = spawnSync(process.execPath, ["--import", "tsx", "-e", `await import(${JSON.stringify(pathToFileURL(envFile).href)})`], {
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ...noCors },
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /Invalid environment/);
  assert.match(r.stderr, /CORS_ORIGIN: CORS_ORIGIN is required in production/);
  assert.doesNotMatch(r.stderr, /at parseEnv|ZodError/);
});

test("production refuses a placeholder password in DATABASE_URL; real passwords and dev/test pass", () => {
  for (const pw of ["example-db-password", "REPLACE-me", "change-me", "ChangeMe123"]) {
    assert.throws(() => parseEnv({ ...PROD_BASE, DATABASE_URL: `postgres://system_self:${pw}@db:5432/system_self` }), /DATABASE_URL.*placeholder|placeholder/, pw);
  }
  // Only the password counts: a host or database name containing "example" is fine.
  assert.doesNotThrow(() => parseEnv({ ...PROD_BASE, DATABASE_URL: "postgres://u:9f2c4e1ab7@db.example.internal:5432/example_db" }));
  assert.doesNotThrow(() => parseEnv({ ...PROD_BASE, DATABASE_URL: "postgres://u@db:5432/x" }), "no password (e.g. peer/IAM auth)");
  assert.doesNotThrow(() => parseEnv({ NODE_ENV: "test", DATABASE_URL: "postgres://u:example@db/x" }));
});

test("an empty MAIL_FROM (e.g. a blank dashboard field) is treated as unset and gets the default", () => {
  assert.equal(parseEnv({ ...PROD_BASE, MAIL_FROM: "" }).MAIL_FROM, "SYSTEM // SELF <no-reply@systemself.app>");
  assert.equal(parseEnv({ ...PROD_BASE, MAIL_FROM: "  " }).MAIL_FROM, "SYSTEM // SELF <no-reply@systemself.app>");
  assert.equal(parseEnv({ ...PROD_BASE, MAIL_FROM: "Ops <ops@x.io>" }).MAIL_FROM, "Ops <ops@x.io>");
});

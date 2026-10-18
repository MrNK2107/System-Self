import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "./env";

const STRONG = "k3Jx9vQ2mP7rT5wZ8nB4cF6hL1sD0aGyE";
const PROD_BASE = { NODE_ENV: "production", JWT_SECRET: STRONG, RESEND_API_KEY: "re_live_key" };

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
  assert.equal(parseEnv({ JWT_SECRET: STRONG, RESEND_API_KEY: "re_x" }).JWT_SECRET, STRONG);
});

test("production requires RESEND_API_KEY unless MAILER=log", () => {
  assert.throws(() => parseEnv({ NODE_ENV: "production", JWT_SECRET: STRONG }), /RESEND_API_KEY/);
  assert.equal(parseEnv({ NODE_ENV: "production", JWT_SECRET: STRONG, MAILER: "log" }).MAILER, "log");
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

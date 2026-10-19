import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

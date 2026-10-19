import test from "node:test";
import assert from "node:assert/strict";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db/schema";
import { EXPORT_EXCLUDED, EXPORT_TABLES } from "./export";

const allTables = (): PgTable[] => Object.values(schema).filter((t) => t instanceof PgTable) as unknown as PgTable[];

/** Tables that have a column referencing users.id. A new one must be exported or excluded with a reason. */
function userOwnedTables(): string[] {
  const out: string[] = [];
  for (const t of allTables()) {
    const cfg = getTableConfig(t);
    if (cfg.name === "users") continue;
    if (cfg.foreignKeys.some((fk) => getTableConfig(fk.reference().foreignTable).name === "users")) out.push(cfg.name);
  }
  return out.sort();
}

test("every table that references users.id is exported or explicitly excluded with a reason", () => {
  const exported = new Set(Object.keys(EXPORT_TABLES));
  const unhandled = userOwnedTables().filter((n) => !exported.has(n) && !(n in EXPORT_EXCLUDED));
  assert.deepEqual(unhandled, [], `New user-owned table(s) need an entry in EXPORT_TABLES or EXPORT_EXCLUDED: ${unhandled.join(", ")}`);
});

test("export map and exclusion list are consistent", () => {
  const all = new Set(allTables().map((t) => getTableConfig(t).name));
  for (const n of [...Object.keys(EXPORT_TABLES), ...Object.keys(EXPORT_EXCLUDED)]) assert.ok(all.has(n), `${n} is not a table`);
  for (const n of Object.keys(EXPORT_EXCLUDED)) {
    assert.ok(!(n in EXPORT_TABLES), `${n} is both exported and excluded`);
    assert.ok(EXPORT_EXCLUDED[n]!.trim().length >= 10, `${n} needs a real reason`);
  }
  assert.ok("users" in EXPORT_TABLES);
});

test("session and device metadata are exported; only code hashes and the replay cache are excluded", () => {
  assert.ok("refresh_tokens" in EXPORT_TABLES);
  assert.ok("push_tokens" in EXPORT_TABLES);
  assert.deepEqual(Object.keys(EXPORT_EXCLUDED).sort(), ["email_codes", "idempotency_keys"]);
});

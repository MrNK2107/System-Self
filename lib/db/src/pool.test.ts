import test from "node:test";
import assert from "node:assert/strict";
import { createDb, poolMaxFromEnv } from "./index";

test("DB_POOL_MAX sizes the pool (default 10)", async () => {
  assert.equal(poolMaxFromEnv({}), 10);
  assert.equal(poolMaxFromEnv({ DB_POOL_MAX: "25" }), 25);
  assert.equal(poolMaxFromEnv({ DB_POOL_MAX: "nope" }), 10);
  assert.equal(poolMaxFromEnv({ DB_POOL_MAX: "0" }), 10);
  const { pool } = createDb("postgres://u:p@127.0.0.1:1/x", { max: 7 });
  assert.equal(pool.options.max, 7);
  await pool.end();
  const dflt = createDb("postgres://u:p@127.0.0.1:1/x");
  assert.equal(dflt.pool.options.max, poolMaxFromEnv(process.env));
  await dflt.pool.end();
});

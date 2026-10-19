import test, { after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { closeTestDb, getTestDb } from "@workspace/db/testing";
import { reads } from "./reads";

const db = getTestDb();
const skip = db ? false : "TEST_DATABASE_URL not set";
after(async () => {
  await closeTestDb();
});

/** Thunks that record how many of them were in flight at once. */
function probe(n: number) {
  let inFlight = 0;
  let peak = 0;
  const thunks = Array.from({ length: n }, (_, i) => async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
    return i;
  });
  return { thunks, peak: () => peak };
}

test("reads: concurrent on the pool, one at a time on a transaction, results in order either way", { skip }, async () => {
  const onPool = probe(4);
  assert.deepEqual(await reads(db!, onPool.thunks), [0, 1, 2, 3]);
  assert.equal(onPool.peak(), 4);

  await db!.transaction(async (tx) => {
    const inTx = probe(4);
    assert.deepEqual(await reads(tx, inTx.thunks), [0, 1, 2, 3]);
    assert.equal(inTx.peak(), 1);
    const [a, b] = await reads(tx, [() => tx.execute(sql`select 1 as n`), () => tx.execute(sql`select 2 as n`)]);
    assert.deepEqual([a.rows[0], b.rows[0]], [{ n: 1 }, { n: 2 }]);
  });
});

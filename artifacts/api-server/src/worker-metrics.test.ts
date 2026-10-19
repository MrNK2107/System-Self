import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { startWorkerMetricsServer } from "./worker-metrics";

test("worker metrics listener requires the token", async () => {
  const server = startWorkerMetricsServer(0, "worker-token");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/metrics`;
  try {
    assert.equal((await fetch(base)).status, 401);
    const ok = await fetch(base, { headers: { Authorization: "Bearer worker-token" } });
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /job_duration_seconds|process_cpu/);
  } finally {
    server.close();
  }
});

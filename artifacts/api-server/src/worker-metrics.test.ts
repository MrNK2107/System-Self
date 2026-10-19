import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { closeWorkerMetricsServer, startWorkerMetricsServer } from "./worker-metrics";

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

test("a listen error (port in use) is logged and does not crash the worker; close() resolves", async () => {
  const first = startWorkerMetricsServer(0, "worker-token");
  await new Promise((r) => first.once("listening", r));
  const port = (first.address() as AddressInfo).port;
  const logged: unknown[] = [];
  const second = startWorkerMetricsServer(port, "worker-token", { onError: (err) => void logged.push(err) });
  await new Promise<void>((resolve) => {
    const check = () => (logged.length > 0 ? resolve() : setImmediate(check));
    check();
  });
  assert.equal((logged[0] as NodeJS.ErrnoException).code, "EADDRINUSE");
  assert.equal(second.listenerCount("error") > 0, true, "an error listener is attached, so no uncaught exception");
  await closeWorkerMetricsServer(second);
  await closeWorkerMetricsServer(first);
  assert.equal(first.listening, false);
});

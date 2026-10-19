import assert from "node:assert/strict";
import { test } from "node:test";
import { shareExport, type ShareExportDeps } from "./export-share";

const payload = { filename: "system-self-export-2026-03-04.json", text: '{"a":1}' };

function deps(over: Partial<ShareExportDeps> = {}) {
  const calls: string[] = [];
  const d: ShareExportDeps = {
    writeFile: async (name, text) => {
      calls.push(`write:${name}:${text.length}`);
      return `file:///cache/${name}`;
    },
    canShareFile: async () => true,
    shareFile: async (uri) => void calls.push(`shareFile:${uri}`),
    shareText: async (text) => void calls.push(`shareText:${text.length}`),
    ...over,
  };
  return { d, calls };
}

test("writes the JSON to the cache and opens the share sheet for the file", async () => {
  const { d, calls } = deps();
  assert.equal(await shareExport(payload, d), "file");
  assert.deepEqual(calls, ["write:system-self-export-2026-03-04.json:7", "shareFile:file:///cache/system-self-export-2026-03-04.json"]);
});

test("falls back to sharing the text when file sharing is unavailable", async () => {
  const { d, calls } = deps({ canShareFile: async () => false });
  assert.equal(await shareExport(payload, d), "text");
  assert.deepEqual(calls, ["shareText:7"]);
});

test("falls back to text when writing or sharing the file throws", async () => {
  const { d, calls } = deps({ writeFile: async () => { throw new Error("no fs"); } });
  assert.equal(await shareExport(payload, d), "text");
  assert.deepEqual(calls, ["shareText:7"]);
  const second = deps({ shareFile: async () => { throw new Error("no sheet"); } });
  assert.equal(await shareExport(payload, second.d), "text");
});

test("a large export is not forced through the text share: the user is told instead", async () => {
  const { d, calls } = deps({ canShareFile: async () => false });
  const big = { filename: "x.json", text: "x".repeat(200_001) };
  assert.equal(await shareExport(big, d), "too-large");
  assert.deepEqual(calls, []);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { LEGAL_DOCS } from "./documents.generated";

const read = (name: string) => readFileSync(resolve(process.cwd(), "../../docs/legal", `${name}.md`), "utf8").replace(/\r\n?/g, "\n");

// Runs from the package directory (pnpm test). The generated module is what ships. If this fails, run `pnpm run gen:legal` and commit the result.
test("the bundled legal text matches docs/legal/*.md exactly", () => {
  assert.equal(LEGAL_DOCS.privacy, read("privacy"));
  assert.equal(LEGAL_DOCS.terms, read("terms"));
});

test("both documents are marked DRAFT at the top and carry the placeholders the holds promise", () => {
  for (const doc of [LEGAL_DOCS.privacy, LEGAL_DOCS.terms]) assert.match(doc.split("\n")[0]!, /DRAFT/);
  assert.match(LEGAL_DOCS.privacy, /privacy@systemself\.app/);
  assert.match(LEGAL_DOCS.privacy, /Gemini/);
  assert.match(LEGAL_DOCS.privacy, /90 days/);
  assert.match(LEGAL_DOCS.privacy, /30 days/);
  assert.match(LEGAL_DOCS.privacy, /180 days/);
  assert.match(LEGAL_DOCS.privacy, /16/);
  assert.match(LEGAL_DOCS.terms, /16/);
  assert.match(LEGAL_DOCS.terms, /RevenueCat/);
});

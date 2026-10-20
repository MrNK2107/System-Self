import { test } from "node:test";
import assert from "node:assert/strict";
import type { LogProposalDto } from "@workspace/contracts";
import { keywordProposals, mergeProposals } from "./ai-parse";

const sleep: LogProposalDto = { domain: "BODY", logType: "sleep", data: { hours: 7, quality: 3 }, confidence: 0.9 };

test("keyword proposals: one per clause, contract-checked", () => {
  assert.deepEqual(
    keywordProposals("slept 7 hours and ran 5km").map((p) => [p.domain, p.logType]),
    [["BODY", "sleep"], ["BODY", "workout"]],
  );
});

test("mergeProposals: an AI answer that missed a clause is topped up from the keyword parser", () => {
  const merged = mergeProposals([sleep], keywordProposals("slept 7 hours and ran 5km"));
  assert.deepEqual(merged.map((p) => p.logType), ["sleep", "workout"]);
  assert.equal(merged[0], sleep, "the AI's own proposal is kept, not replaced");
});

test("mergeProposals: no duplicates of a type the AI gave, at most 3", () => {
  assert.deepEqual(mergeProposals([sleep], [{ ...sleep, data: { hours: 6, quality: 3 } }]), [sleep]);
  const reading = (pages: number): LogProposalDto => ({ domain: "MIND", logType: "reading", data: { pages }, confidence: 1 });
  const kw = keywordProposals("spent 40 on lunch, called mom");
  assert.equal(mergeProposals([sleep, reading(1), reading(2)], kw).length, 3);
});

import test from "node:test";
import assert from "node:assert/strict";
import { CHAIN_TEMPLATES, chainStepQuest, findChainTemplate } from "./chains";

test("four templates with 3 steps each and stable keys", () => {
  assert.deepEqual(
    CHAIN_TEMPLATES.map((t) => t.templateKey),
    ["physical_protocol", "mind_sharpening", "wealth_accumulation", "discipline_forge"],
  );
  for (const t of CHAIN_TEMPLATES) assert.equal(t.steps.length, 3);
  assert.equal(CHAIN_TEMPLATES[0]!.name, "PHYSICAL PROTOCOL");
  assert.equal(CHAIN_TEMPLATES[3]!.domain, "DISCIPLINE");
});

test("chainStepQuest formats title, description and reward", () => {
  const q = chainStepQuest("physical_protocol", 0);
  assert.deepEqual(q, {
    title: "[PHYSICAL PROTOCOL] BASELINE ASSESSMENT",
    description:
      "Log a complete physical entry covering sleep, exercise, and nutrition in a single day.\n\nReward: +3 BODY",
    domain: "BODY",
    type: "arc",
  });
});

test("chainStepQuest and findChainTemplate reject unknown input", () => {
  assert.throws(() => chainStepQuest("physical_protocol", 3));
  assert.equal(findChainTemplate("nope"), undefined);
  assert.equal(findChainTemplate("mind_sharpening")?.name, "MIND SHARPENING ARC");
});

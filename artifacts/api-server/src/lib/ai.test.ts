import test from "node:test";
import assert from "node:assert/strict";
import { MESSAGE_TYPES } from "./schemas";
import { templateQuests, templateSystemMessage } from "./ai-fallback";
import { aiAvailable, generateOrTemplate, generateWithFallback } from "./ai";
import { env } from "./env";

const ctx = { rank: "C", dayNumber: 12, shadowGap: 7.5, trajectory: "down" as const };
const OPTIONS = { systemInstruction: "s", prompt: "p", maxOutputTokens: 10, temperature: 0.1 };

test("templateSystemMessage covers every message type, contains no '!' and no emoji", () => {
  const types = MESSAGE_TYPES;
  assert.ok(types.length > 0);
  for (const type of types) {
    for (const trajectory of ["up", "stable", "down"] as const) {
      for (const shadowGap of [-4, 0, 9]) {
        const text = templateSystemMessage(type, { ...ctx, trajectory, shadowGap });
        assert.ok(text.length > 0, `${type} produced no text`);
        assert.ok(!text.includes("!"), `${type} contains "!"`);
        assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${type} contains emoji`);
      }
    }
  }
  assert.equal(templateSystemMessage("shadow_self", ctx), templateSystemMessage("shadow_self", ctx));
});

test("templateQuests returns 3 dailies (weakest first), 1 weekly and 1 arc", () => {
  for (const weakestDomain of ["BODY", "MIND", "WEALTH", "SOCIAL", "DISCIPLINE"]) {
    const quests = templateQuests({ weakestDomain });
    assert.equal(quests.length, 5);
    const dailies = quests.filter((q) => q.type === "daily");
    assert.equal(dailies.length, 3);
    assert.equal(dailies[0]!.domain, weakestDomain);
    assert.equal(new Set(dailies.map((q) => q.domain)).size, 3);
    assert.equal(quests.filter((q) => q.type === "weekly").length, 1);
    assert.equal(quests.filter((q) => q.type === "arc").length, 1);
    assert.ok(quests.every((q) => q.title && q.description));
  }
  assert.equal(templateQuests({ weakestDomain: "NOPE" }).length, 5);
});

test("generateWithFallback without key returns model 'template' and never calls the model", async () => {
  const saved = env.GEMINI_API_KEY;
  env.GEMINI_API_KEY = undefined;
  try {
    assert.equal(aiAvailable(), false);
    const result = await generateWithFallback(OPTIONS, async () => {
      throw new Error("must not be called");
    });
    assert.equal(result.model, "template");
  } finally {
    env.GEMINI_API_KEY = saved;
  }
});

test("generateWithFallback with a key uses the injected caller and falls back to the second model", async () => {
  const saved = env.GEMINI_API_KEY;
  env.GEMINI_API_KEY = "test-key";
  const models: string[] = [];
  try {
    assert.equal(aiAvailable(), true);
    const result = await generateWithFallback(OPTIONS, async (model) => {
      models.push(model);
      if (models.length === 1) throw new Error("400 bad request");
      return "hello";
    });
    assert.equal(result.text, "hello");
    assert.equal(result.model, env.GEMINI_FALLBACK_MODEL);
    assert.equal(models.length, 2);
  } finally {
    env.GEMINI_API_KEY = saved;
  }
});

test("generateOrTemplate resolves with model 'template' when every model call fails", async () => {
  const saved = env.GEMINI_API_KEY;
  env.GEMINI_API_KEY = "test-key";
  const models: string[] = [];
  try {
    const result = await generateOrTemplate(OPTIONS, async (model) => {
      models.push(model);
      throw new Error("400 bad request");
    });
    assert.equal(result.model, "template");
    assert.equal(result.text, "");
    assert.equal(models.length, 2, "primary and fallback model were both tried");
  } finally {
    env.GEMINI_API_KEY = saved;
  }
});

test("generateOrTemplate passes through a successful model result", async () => {
  const saved = env.GEMINI_API_KEY;
  env.GEMINI_API_KEY = "test-key";
  try {
    const result = await generateOrTemplate(OPTIONS, async () => "hello");
    assert.equal(result.text, "hello");
    assert.equal(result.model, env.GEMINI_MODEL);
  } finally {
    env.GEMINI_API_KEY = saved;
  }
});

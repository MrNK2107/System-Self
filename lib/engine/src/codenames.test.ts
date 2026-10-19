import { test } from "node:test";
import assert from "node:assert/strict";
import { CODENAME_WORDS, USER_CODENAME_RE, generateRivalCodename, generateUserCodename } from "./codenames";

test("user codename is USER // WORD-N with N in 1..9", () => {
  for (let i = 0; i < 200; i++) {
    const c = generateUserCodename();
    assert.match(c, USER_CODENAME_RE);
    assert.match(c, /^USER \/\/ [A-Z]+-[1-9]$/);
  }
});

test("rival codename uses the RIVAL prefix", () => {
  assert.match(generateRivalCodename(), /^RIVAL \/\/ [A-Z]+-[1-9]$/);
});

test("deterministic for a seeded rng, covers the whole range", () => {
  assert.equal(generateUserCodename(() => 0), `USER // ${CODENAME_WORDS[0]}-1`);
  assert.equal(generateUserCodename(() => 0.9999999), `USER // ${CODENAME_WORDS[CODENAME_WORDS.length - 1]}-9`);
});

test("word list is unique upper-case letters, large enough for the unique-retry budget", () => {
  assert.equal(new Set(CODENAME_WORDS).size, CODENAME_WORDS.length);
  assert.ok(CODENAME_WORDS.length >= 100);
  for (const w of CODENAME_WORDS) assert.match(w, /^[A-Z]{3,8}$/);
});

test("retry attempts past the budget add a second word so the namespace never exhausts", () => {
  assert.match(generateUserCodename(Math.random, 20), /^USER \/\/ [A-Z]+-[A-Z]+-[1-9]$/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { explainQuestion, keywordGrade, matchBankSubject, validateAiQuiz, verifyStudy, studyMinutesRequired } from "./quiz";

const study45 = { kind: "study" as const, metric: "minutes" as const, value: 45, unit: "min" as const };
const session = (min: number) => ({ startedAt: "2026-11-01T10:00:00.000Z", endedAt: new Date(Date.parse("2026-11-01T10:00:00.000Z") + min * 60000).toISOString(), mocked: false });

test("keywordGrade needs a real attempt that covers the key ideas", () => {
  const expected = "Entropy of an isolated system never decreases; heat flows from hot to cold spontaneously.";
  assert.equal(keywordGrade(expected, "Entropy in an isolated system never decreases, so heat flows from hot bodies to cold ones."), true);
  assert.equal(keywordGrade(expected, "entropy"), false, "too short");
  assert.equal(keywordGrade(expected, "I studied a lot of things today about many topics in my book"), false, "off topic");
});

test("matchBankSubject picks the subject with the most keyword hits; plurals match; unknown is null", () => {
  const subjects = [
    { key: "physics", keywords: ["physics", "thermodynamics", "entropy", "newton"] },
    { key: "chemistry", keywords: ["chemistry", "reaction", "acid"] },
  ];
  assert.equal(matchBankSubject("Thermodynamics, 2nd law and entropy", subjects), "physics");
  assert.equal(matchBankSubject("acid base reactions", subjects), "chemistry");
  assert.equal(matchBankSubject("Medieval poetry", subjects), null);
});

test("validateAiQuiz accepts five questions, MCQ with a valid index or short with an expected answer", () => {
  const raw = {
    questions: [
      { prompt: "What does the second law say?", options: ["Entropy rises", "Energy is lost", "Mass grows"], answerIndex: 0 },
      { prompt: "Define entropy in one line.", expected: "A measure of disorder." },
      { question: "Which flows hot to cold spontaneously?", options: ["Heat", "Work", "Mass", "Charge"], answerIndex: 0 },
      { prompt: "What is a reversible process?", answer: "One that can be undone without net change." },
      { prompt: "Carnot efficiency depends on?", options: ["Temperatures", "Fuel", "Size"], answerIndex: 0 },
      { prompt: "An extra question beyond five", options: ["a", "b", "c"], answerIndex: 1 },
    ],
  };
  const v = validateAiQuiz(raw)!;
  assert.equal(v.questions.length, 5);
  assert.deepEqual(v.questions.map((q) => q.kind), ["mcq", "short", "mcq", "short", "mcq"]);
  assert.equal(v.keys[0]!.answerIndex, 0);
  assert.equal(v.keys[1]!.expected, "A measure of disorder.");
  assert.ok(v.questions.every((q) => !("answerIndex" in q)), "answers never reach the phone");
});

test("validateAiQuiz rejects too few, bad indexes fall back to short, junk is null", () => {
  assert.equal(validateAiQuiz({ questions: [{ prompt: "Only one question here?" }] }), null);
  assert.equal(validateAiQuiz("nonsense"), null);
  const badIdx = Array.from({ length: 5 }, (_, i) => ({ prompt: `Question number ${i}?`, options: ["a", "b", "c"], answerIndex: 9 }));
  assert.ok(validateAiQuiz(badIdx)!.questions.every((q) => q.kind === "short"));
});

test("explainQuestion is a single short question naming the topic", () => {
  const e = explainQuestion("Mughal history");
  assert.equal(e.questions.length, 1);
  assert.match(e.questions[0]!.prompt, /Mughal history/);
});

test("verifyStudy: long enough and 3 of 5 correct proves; short or failed quiz does not", () => {
  assert.equal(verifyStudy(session(50), study45, { correct: 3, total: 5 }, "Physics").ok, true);
  assert.match(verifyStudy(session(30), study45, { correct: 5, total: 5 }, "Physics").reason, /30 of 45 minutes/);
  assert.match(verifyStudy(session(50), study45, { correct: 2, total: 5 }, "Physics").reason, /2 of 5 correct/);
  assert.equal(verifyStudy(session(50), study45, { correct: 1, total: 1 }, "Physics").ok, true, "a passed explanation");
  assert.deepEqual(verifyStudy(session(50), study45, { correct: 4, total: 5 }, "Physics").evidence, ["50 min on Physics", "quiz 4/5"]);
});

test("weekly study targets split the minutes per session, never below 25", () => {
  assert.equal(studyMinutesRequired({ ...study45, value: 300, sessions: 5 }), 60);
  assert.equal(studyMinutesRequired({ ...study45, value: 60, sessions: 4 }), 25);
  assert.equal(studyMinutesRequired(study45), 45);
});

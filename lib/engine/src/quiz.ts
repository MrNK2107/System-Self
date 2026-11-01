import type { Verdict } from "./proof";
import type { QuestTarget } from "./quest-spec";

/** A study session ends with this many questions; this many correct proves it (spec 8.5). */
export const QUIZ_LENGTH = 5;
export const QUIZ_PASS = 3;

/** What the phone sees: never the answers. */
export interface QuizQuestion {
  id: string;
  kind: "mcq" | "short";
  prompt: string;
  options?: string[];
}

/** What the server keeps to grade: the right option, or the expected answer for a short question (may be absent). */
export interface QuizKey {
  id: string;
  answerIndex?: number;
  expected?: string;
}

export type QuizSource = "ai" | "bank" | "explain";

const STOP = new Set(
  "the a an and or but of to in on at for with by from is are was were be been being this that these those it its as into than then so such which who whom what when where why how can will would should could may might must not no do does did have has had your you their there here they them very more most also".split(
    " ",
  ),
);
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Fallback grading of a short answer against an expected one when the AI can't grade: the answer must be a real
 * attempt (at least 8 words) and cover at least 40% of the expected answer's meaningful words.
 */
export function keywordGrade(expected: string, answer: string): boolean {
  const got = words(answer);
  if (got.length < 8) return false;
  const key = [...new Set(words(expected).filter((w) => w.length >= 4 && !STOP.has(w)))];
  if (key.length === 0) return false;
  const have = new Set(got);
  return key.filter((w) => have.has(w)).length / key.length >= 0.4;
}

/** A subject in the stored question bank, found by keywords in the topic the user typed. */
export interface BankSubject {
  key: string;
  keywords: string[];
}

/** The bank subject whose keywords best match the topic (most keyword hits), or null. */
export function matchBankSubject(topic: string, subjects: BankSubject[]): string | null {
  const t = ` ${words(topic).join(" ")} `;
  let best: { key: string; hits: number } | null = null;
  for (const s of subjects) {
    const hits = s.keywords.filter((k) => t.includes(` ${k.toLowerCase()} `) || t.includes(` ${k.toLowerCase()}s `)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { key: s.key, hits };
  }
  return best?.key ?? null;
}

/** Validates AI quiz output: exactly QUIZ_LENGTH usable questions with keys, or null so the caller falls back. */
export function validateAiQuiz(raw: unknown): { questions: QuizQuestion[]; keys: QuizKey[] } | null {
  const list = Array.isArray(raw) ? raw : (raw as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) return null;
  const questions: QuizQuestion[] = [];
  const keys: QuizKey[] = [];
  for (const item of list) {
    const q = item as { prompt?: unknown; question?: unknown; options?: unknown; answerIndex?: unknown; answer?: unknown; expected?: unknown };
    const prompt = typeof q.prompt === "string" ? q.prompt : typeof q.question === "string" ? q.question : null;
    if (!prompt || prompt.trim().length < 8) continue;
    const id = `q${questions.length + 1}`;
    const opts = Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0) : [];
    const idx = typeof q.answerIndex === "number" ? q.answerIndex : null;
    if (opts.length >= 3 && opts.length <= 5 && idx !== null && Number.isInteger(idx) && idx >= 0 && idx < opts.length) {
      questions.push({ id, kind: "mcq", prompt: prompt.trim(), options: opts.map((o) => o.trim()) });
      keys.push({ id, answerIndex: idx });
    } else {
      const expected = typeof q.expected === "string" ? q.expected : typeof q.answer === "string" ? q.answer : undefined;
      questions.push({ id, kind: "short", prompt: prompt.trim() });
      keys.push({ id, ...(expected ? { expected } : {}) });
    }
    if (questions.length === QUIZ_LENGTH) break;
  }
  return questions.length === QUIZ_LENGTH ? { questions, keys } : null;
}

/** The last-resort question when neither the AI nor the bank has the topic: explain it, graded when the AI returns. */
export function explainQuestion(topic: string): { questions: QuizQuestion[]; keys: QuizKey[] } {
  return {
    questions: [
      {
        id: "q1",
        kind: "short",
        prompt: `Explain "${topic}" in your own words: the main ideas you studied, and one example. At least four sentences.`,
      },
    ],
    keys: [{ id: "q1" }],
  };
}

const minutesBetween = (a: string, b: string) => Math.max(0, (Date.parse(b) - Date.parse(a)) / 60000);

/**
 * Does a study session prove a study target? It must last the target's minutes (weekly quests: per session) and
 * pass the quiz (QUIZ_PASS of QUIZ_LENGTH, or the single explain question).
 */
export function verifyStudy(
  s: { startedAt: string; endedAt: string; mocked: boolean },
  target: QuestTarget,
  quiz: { correct: number; total: number },
  topic: string,
): Verdict {
  const duration = minutesBetween(s.startedAt, s.endedAt);
  const perSession = target.sessions ? Math.min(target.value, Math.max(25, Math.round(target.value / target.sessions))) : target.value;
  const evidence = [`${Math.round(duration)} min on ${topic}`, `quiz ${quiz.correct}/${quiz.total}`];
  if (target.kind !== "study") return { ok: false, reason: "This session can't prove that quest.", evidence };
  if (s.mocked) return { ok: false, reason: "Your location was faked. THE SYSTEM does not accept it.", evidence };
  if (duration < perSession) {
    return { ok: false, reason: `${Math.round(duration)} of ${perSession} minutes. The session was too short.`, evidence };
  }
  const needed = quiz.total === 1 ? 1 : QUIZ_PASS;
  if (quiz.correct < needed) {
    return { ok: false, reason: `${quiz.correct} of ${quiz.total} correct. You did not retain enough of it.`, evidence };
  }
  return { ok: true, reason: "Study confirmed.", evidence };
}

/** Minutes a single study session must last before a quiz is worth asking (same rule as verifyStudy). */
export function studyMinutesRequired(target: QuestTarget): number {
  return target.sessions ? Math.min(target.value, Math.max(25, Math.round(target.value / target.sessions))) : target.value;
}

import {
  QUIZ_LENGTH,
  explainQuestion,
  keywordGrade,
  matchBankSubject,
  validateAiQuiz,
  type QuizKey,
  type QuizQuestion,
  type QuizSource,
} from "@workspace/engine";
import { generateOrTemplate, type AiDeps } from "../lib/ai";
import { QUESTION_BANK } from "../data/question-bank";
import { extractJson } from "./ai-parse";

interface BankQuestion {
  prompt: string;
  options: string[];
  answerIndex: number;
}
export interface QuestionBank {
  version: number;
  generatedBy: string;
  generatedAt: string;
  subjects: { key: string; label: string; keywords: string[]; questions: BankQuestion[] }[];
}

let bank: QuestionBank = QUESTION_BANK;
/** The stored question bank (src/data/question-bank.ts, from scripts/gen-question-bank.mjs). */
export const questionBank = (): QuestionBank => bank;

/** For tests: replace the bank (null restores the stored one). */
export function setQuestionBank(b: QuestionBank | null): void {
  bank = b ?? QUESTION_BANK;
}

export interface BuiltQuiz {
  source: QuizSource;
  questions: QuizQuestion[];
  keys: QuizKey[];
}

const QUIZ_SYSTEM = `You are THE SYSTEM, testing whether a student really studied a topic.
Write exactly ${QUIZ_LENGTH} questions on the topic: 3 multiple choice (4 options, one correct, vary the position) and 2 short-answer questions with a one or two sentence expected answer.
Questions must need understanding of the topic itself: nobody who skipped studying should pass by guessing.
Answer with JSON only: {"questions":[{"prompt":"...","options":["...","...","...","..."],"answerIndex":0},{"prompt":"...","expected":"..."}]}`;

const shuffle = <T>(xs: T[], rand: () => number): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

/** A quiz for `topic`: from the AI, else from the stored bank by subject, else one explain-in-your-own-words question. */
export async function buildQuiz(topic: string, ai: AiDeps, rand: () => number = Math.random): Promise<BuiltQuiz> {
  const result = await generateOrTemplate(
    { systemInstruction: QUIZ_SYSTEM, prompt: `Prompt-Version: quiz-1\nTopic: ${JSON.stringify(topic)}`, maxOutputTokens: 1400, temperature: 0.5 },
    ai.call,
  );
  if (result.model !== "template") {
    const v = validateAiQuiz(extractJson(result.text));
    if (v) return { source: "ai", ...v };
  }
  const b = questionBank();
  const key = matchBankSubject(topic, b.subjects);
  const subject = key ? b.subjects.find((s) => s.key === key) : undefined;
  if (subject && subject.questions.length >= QUIZ_LENGTH) {
    const picked = shuffle(subject.questions, rand).slice(0, QUIZ_LENGTH);
    return {
      source: "bank",
      questions: picked.map((q, i) => ({ id: `q${i + 1}`, kind: "mcq" as const, prompt: q.prompt, options: q.options })),
      keys: picked.map((q, i) => ({ id: `q${i + 1}`, answerIndex: q.answerIndex })),
    };
  }
  return { source: "explain", ...explainQuestion(topic) };
}

export type QuizAnswer = number | string;

const GRADE_SYSTEM = `You are THE SYSTEM, grading a student's short answers strictly but fairly.
For each item decide if the answer shows real understanding of the question on the given topic (it may differ in wording from the expected answer).
Answer with JSON only: {"results":[true,false,...]} in the same order as the items.`;

/**
 * Grades answers. MCQ by the key. Short answers by the AI; when the AI is down, by keywords against the expected
 * answer, and when there is no expected answer (the explain question) the result is pending review.
 */
export async function gradeQuiz(
  topic: string,
  questions: QuizQuestion[],
  keys: QuizKey[],
  answers: QuizAnswer[],
  ai: AiDeps,
): Promise<{ correct: number; total: number; pendingReview: boolean }> {
  let correct = 0;
  const shorts: { q: QuizQuestion; key: QuizKey; answer: string }[] = [];
  questions.forEach((q, i) => {
    const key = keys.find((k) => k.id === q.id);
    const a = answers[i];
    if (!key) return;
    if (q.kind === "mcq") {
      if (typeof a === "number" && a === key.answerIndex) correct++;
    } else {
      shorts.push({ q, key, answer: typeof a === "string" ? a.trim().slice(0, 2000) : "" });
    }
  });
  const answered = shorts.filter((s) => s.answer.length > 0);
  if (answered.length === 0) return { correct, total: questions.length, pendingReview: false };

  const result = await generateOrTemplate(
    {
      systemInstruction: GRADE_SYSTEM,
      prompt: `Prompt-Version: grade-1\nTopic: ${JSON.stringify(topic)}\nItems: ${JSON.stringify(
        answered.map((s) => ({ question: s.q.prompt, expected: s.key.expected ?? null, answer: s.answer })),
      )}`,
      maxOutputTokens: 300,
      temperature: 0,
    },
    ai.call,
  );
  const verdicts = result.model !== "template" ? (extractJson(result.text) as { results?: unknown } | null)?.results : null;
  if (Array.isArray(verdicts) && verdicts.length === answered.length && verdicts.every((v) => typeof v === "boolean")) {
    return { correct: correct + verdicts.filter(Boolean).length, total: questions.length, pendingReview: false };
  }
  if (answered.every((s) => s.key.expected)) {
    return { correct: correct + answered.filter((s) => keywordGrade(s.key.expected!, s.answer)).length, total: questions.length, pendingReview: false };
  }
  return { correct, total: questions.length, pendingReview: true };
}

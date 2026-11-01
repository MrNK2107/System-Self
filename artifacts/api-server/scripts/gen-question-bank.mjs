// Generates the stored study-quiz question bank (spec 8.5) with the local Ollama model, so quizzes still work when
// the AI is down at the end of a session. Run: node scripts/gen-question-bank.mjs [model]   (default gemma4:latest)
// Writes src/data/question-bank.ts (a TypeScript module, so the esbuild bundle includes it). Questions are machine-written: spot-check before relying on them.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL = process.argv[2] ?? "gemma4:latest";
const PER_SUBJECT = 20;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "question-bank.ts");

const SUBJECTS = [
  { key: "mathematics", label: "Mathematics", keywords: ["math", "maths", "mathematics", "algebra", "calculus", "geometry", "trigonometry", "probability", "statistics", "integration", "derivative", "matrix", "equation"] },
  { key: "physics", label: "Physics", keywords: ["physics", "mechanics", "thermodynamics", "entropy", "optics", "electricity", "magnetism", "newton", "motion", "waves", "quantum", "gravity", "energy"] },
  { key: "chemistry", label: "Chemistry", keywords: ["chemistry", "organic", "inorganic", "reaction", "acid", "base", "periodic", "bond", "mole", "electrochemistry", "equilibrium", "atom"] },
  { key: "biology", label: "Biology", keywords: ["biology", "cell", "genetics", "evolution", "botany", "zoology", "anatomy", "physiology", "photosynthesis", "dna", "ecology", "human body"] },
  { key: "programming", label: "Programming", keywords: ["programming", "coding", "code", "javascript", "typescript", "python", "java", "algorithm", "algorithms", "data structures", "react", "database", "sql", "computer science"] },
  { key: "english", label: "English", keywords: ["english", "grammar", "vocabulary", "literature", "essay", "writing", "reading comprehension", "poetry", "tense"] },
  { key: "history", label: "History", keywords: ["history", "mughal", "british", "independence", "ancient", "medieval", "modern history", "freedom struggle", "world war", "civilization", "empire"] },
  { key: "geography", label: "Geography", keywords: ["geography", "climate", "rivers", "mountains", "monsoon", "soil", "maps", "continents", "earth", "population"] },
  { key: "economics", label: "Economics", keywords: ["economics", "economy", "inflation", "gdp", "demand", "supply", "market", "money", "banking", "fiscal", "monetary", "microeconomics", "macroeconomics"] },
  { key: "accounting", label: "Accounting and finance", keywords: ["accounting", "accounts", "finance", "balance sheet", "ledger", "journal", "investing", "investment", "tax", "budgeting", "personal finance", "stock"] },
  { key: "polity", label: "Polity and civics", keywords: ["polity", "civics", "constitution", "parliament", "government", "rights", "democracy", "judiciary", "election", "law"] },
  { key: "psychology", label: "Psychology and self-improvement", keywords: ["psychology", "habits", "habit", "motivation", "mindset", "discipline", "focus", "productivity", "memory", "learning", "self improvement"] },
];

async function generate(subject) {
  const prompt = `Write ${PER_SUBJECT} multiple-choice questions for a student revising ${subject.label} (school and early college level, India).
Each question tests understanding, not trivia. Exactly 4 options, one correct. Vary which option is correct.
Answer with JSON only: {"questions":[{"prompt":"...","options":["...","...","...","..."],"answerIndex":0}]}`;
  const res = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt, stream: false, format: "json", options: { temperature: 0.4, num_ctx: 8192, num_predict: 6000 } }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const body = await res.json();
  const parsed = JSON.parse(body.response);
  const qs = (parsed.questions ?? []).filter(
    (q) =>
      typeof q.prompt === "string" &&
      q.prompt.trim().length >= 10 &&
      Array.isArray(q.options) &&
      q.options.length === 4 &&
      q.options.every((o) => typeof o === "string" && o.trim()) &&
      Number.isInteger(q.answerIndex) &&
      q.answerIndex >= 0 &&
      q.answerIndex < 4,
  );
  return qs.map((q) => ({ prompt: q.prompt.trim(), options: q.options.map((o) => o.trim()), answerIndex: q.answerIndex }));
}

const out = { version: 1, generatedBy: MODEL, generatedAt: new Date().toISOString(), subjects: [] };
for (const s of SUBJECTS) {
  let questions = [];
  for (let attempt = 0; attempt < 3 && questions.length < 10; attempt++) {
    try {
      questions = await generate(s);
    } catch (e) {
      console.error(`${s.key}: ${e.message}`);
    }
  }
  console.log(`${s.key}: ${questions.length} questions`);
  out.subjects.push({ key: s.key, label: s.label, keywords: s.keywords, questions });
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${OUT}`);

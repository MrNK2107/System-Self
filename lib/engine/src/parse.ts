import type { RankedDomain } from "./constants";
import { EXPENSE_CATEGORIES } from "./finance";

/**
 * Free-form logging (PRD 18), keyword path: turns a sentence like "slept 6 hours and read 30 pages" into log
 * proposals. This is the fallback when no AI key is set or the AI fails. A proposal is only a suggestion: nothing
 * is logged or scored until the client posts it to /api/logs. The server checks every proposal against the
 * log-type contract schemas, so a rule here may propose out-of-range data only by being wrong, never by design.
 */
export interface LogProposal {
  domain: RankedDomain;
  logType: string;
  data: Record<string, unknown>;
  /** 0..1: how sure the parser is that the text says this. */
  confidence: number;
}

/** A parse returns at most this many proposals. */
export const PARSE_MAX_PROPOSALS = 3;
/** Free-form text limit (characters). */
export const PARSE_TEXT_MAX = 1000;
/** Parse calls per user per local day (cost control for the AI path; applies to the keyword path too). */
export const PARSE_LIMIT_PER_DAY = 30;
/** Voice logs per user per local day. */
export const VOICE_LIMIT_PER_DAY = 10;
/** Voice recordings are at most this long. */
export const VOICE_MAX_SECONDS = 120;

const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)`;
const HOURS = String.raw`(?:h|hr|hrs|hour|hours)`;
const MINS = String.raw`(?:min|mins|minute|minutes)`;
const UNIT = String.raw`(${MINS}|${HOURS})`;
/** An amount is not followed by a time or count unit ("spent 2 hours studying" is not money) and is not the start of a longer number. */
const AMOUNT = String.raw`${NUM}(?![,.]?\d)(?!\s*(?:h|hr|hrs|hours?|mins?|minutes?|days?|weeks?|months?|years?|pages?)\b)`;

const toNumber = (s: string) => Number(s.replace(/,/g, ""));
const toMinutes = (n: number, unit: string) => Math.round(/^h/i.test(unit) ? n * 60 : n);
const inRange = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;

const CATEGORY_WORDS: Record<string, (typeof EXPENSE_CATEGORIES)[number]> = {
  groceries: "food", grocery: "food", lunch: "food", dinner: "food", breakfast: "food", coffee: "food",
  snacks: "food", restaurant: "food", takeout: "food",
  uber: "transport", taxi: "transport", cab: "transport", fuel: "transport", petrol: "transport", bus: "transport", train: "transport",
  rent: "housing",
  electricity: "utilities", water: "utilities", internet: "utilities", wifi: "utilities", phone: "utilities",
  clothes: "shopping", clothing: "shopping", shoes: "shopping",
  movie: "entertainment", movies: "entertainment", games: "entertainment", concert: "entertainment",
  doctor: "health", medicine: "health", pharmacy: "health", medicines: "health",
  course: "education", books: "education", tuition: "education",
  subscription: "subscriptions", netflix: "subscriptions", spotify: "subscriptions",
};

function categoryOf(word: string | undefined): string {
  const w = (word ?? "").toLowerCase();
  if ((EXPENSE_CATEGORIES as readonly string[]).includes(w)) return w;
  return CATEGORY_WORDS[w] ?? "other";
}

const WORKOUT_KINDS: Record<string, string> = {
  "worked out": "Workout", workout: "Workout", gym: "Strength", lifted: "Strength", trained: "Workout",
  ran: "Run", run: "Run", jogged: "Run", swam: "Swim", cycled: "Cycle", yoga: "Yoga",
};

interface Hit extends LogProposal {
  at: number;
}

type Rule = (text: string) => Hit | null;

const RULES: Rule[] = [
  (t) => {
    const m = new RegExp(String.raw`\bslept\s+(?:for\s+)?(?:about\s+|around\s+)?${NUM}\s*${HOURS}\b`, "i").exec(t);
    if (!m) return null;
    const hours = Math.round(toNumber(m[1]!) * 4) / 4;
    if (!inRange(hours, 0.25, 16)) return null;
    return { at: m.index, domain: "BODY", logType: "sleep", data: { hours, quality: 3 }, confidence: 0.85 };
  },
  (t) => {
    const m = new RegExp(String.raw`\b(?:spent|paid)\s+(?:rs\.?\s*|inr\s*|[₹$€£]\s*)?${AMOUNT}(?:\s*(?:rupees|rs|inr|dollars|usd))?(?:\s+(?:on|for)\s+(?:a\s+|an\s+|the\s+|my\s+)?([a-z]+))?`, "i").exec(t);
    if (!m) return null;
    const amount = toNumber(m[1]!);
    if (!(amount > 0 && amount <= 1e12)) return null;
    return { at: m.index, domain: "WEALTH", logType: "expense", data: { amount, category: categoryOf(m[2]) }, confidence: m[2] ? 0.85 : 0.7 };
  },
  (t) => {
    const m = new RegExp(String.raw`\bread\s+${NUM}\s*pages?\b`, "i").exec(t);
    if (!m) return null;
    const pages = Math.round(toNumber(m[1]!));
    if (!inRange(pages, 1, 2000)) return null;
    return { at: m.index, domain: "MIND", logType: "reading", data: { pages }, confidence: 0.85 };
  },
  (t) => {
    const m = new RegExp(String.raw`\b${NUM}\s*${UNIT}\s+(?:of\s+)?(?:deep\s+work|focus(?:ed)?(?:\s+work)?)\b`, "i").exec(t);
    if (!m) return null;
    const minutes = toMinutes(toNumber(m[1]!), m[2]!);
    if (!inRange(minutes, 1, 600)) return null;
    return { at: m.index, domain: "MIND", logType: "focus", data: { minutes, distraction: 2, subject: "Deep work" }, confidence: 0.85 };
  },
  (t) => {
    const m = new RegExp(String.raw`\b(?:studied|learned|learnt|practiced|practised)\s+(?:for\s+)?${NUM}\s*${UNIT}\b`, "i").exec(t);
    if (!m) return null;
    const minutes = toMinutes(toNumber(m[1]!), m[2]!);
    if (!inRange(minutes, 1, 600)) return null;
    return { at: m.index, domain: "MIND", logType: "learning", data: { minutes }, confidence: 0.8 };
  },
  (t) => {
    const m = new RegExp(String.raw`\b(worked out|workout|gym|lifted|trained|ran|run|jogged|swam|cycled|yoga)\b[^.,;]*?\b${NUM}\s*${UNIT}\b`, "i").exec(t);
    if (!m) return null;
    const minutes = toMinutes(toNumber(m[2]!), m[3]!);
    if (!inRange(minutes, 1, 600)) return null;
    return { at: m.index, domain: "BODY", logType: "workout", data: { kind: WORKOUT_KINDS[m[1]!.toLowerCase()] ?? "Workout", minutes, intensity: 3 }, confidence: 0.75 };
  },
  (t) => {
    const m = /\b(?:called|phoned|talked to|spoke (?:to|with)|met (?:up )?with|texted|caught up with)\s+(?:my\s+)?(?!(?:a|an|the|it|off|in|out|about|up)\b)[a-z]+/i.exec(t);
    if (!m) return null;
    return { at: m.index, domain: "SOCIAL", logType: "interaction", data: { kind: "meaningful", note: m[0].slice(0, 200) }, confidence: 0.6 };
  },
];

/** Keyword-parses free text into up to 3 proposals, in the order they appear in the text. Never throws. */
export function parseFreeText(text: string): LogProposal[] {
  const hits = RULES.map((rule) => rule(text)).filter((h): h is Hit => h !== null);
  hits.sort((a, b) => a.at - b.at);
  return hits.slice(0, PARSE_MAX_PROPOSALS).map(({ at: _at, ...proposal }) => proposal);
}

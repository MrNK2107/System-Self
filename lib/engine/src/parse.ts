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
  ran: "Run", run: "Run", jogged: "Run", swam: "Swim", cycled: "Cycle", biked: "Cycle", walked: "Walk", yoga: "Yoga",
};

/** Minutes per kilometre used to estimate a workout's length when only a distance is given ("ran 5km"). */
const PACE_MIN_PER_KM: Record<string, number> = { Run: 6, Walk: 12, Cycle: 3, Swim: 30 };
const DISTANCE = String.raw`(km|kms|k|kilometers?|kilometres?|mi|miles?)`;

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
    const m = new RegExp(String.raw`\b(worked out|workout|gym|lifted|trained|ran|run|jogged|swam|cycled|biked|walked|yoga)\b[^.,;]*?\b${NUM}\s*${UNIT}\b`, "i").exec(t);
    if (m) {
      const minutes = toMinutes(toNumber(m[2]!), m[3]!);
      if (!inRange(minutes, 1, 600)) return null;
      return { at: m.index, domain: "BODY", logType: "workout", data: { kind: WORKOUT_KINDS[m[1]!.toLowerCase()] ?? "Workout", minutes, intensity: 3 }, confidence: 0.75 };
    }
    // Distance only ("ran 5km"): the minutes are estimated at a steady pace, so the proposal is less sure.
    const d = new RegExp(String.raw`\b(ran|run|jogged|swam|cycled|biked|walked)\s+(?:for\s+)?(?:about\s+|around\s+)?${NUM}\s*${DISTANCE}\b`, "i").exec(t);
    if (!d) return null;
    const kind = WORKOUT_KINDS[d[1]!.toLowerCase()] ?? "Run";
    const km = toNumber(d[2]!) * (/^mi/i.test(d[3]!) ? 1.609 : 1);
    const minutes = Math.round(km * (PACE_MIN_PER_KM[kind] ?? 6));
    if (!inRange(minutes, 1, 600)) return null;
    return { at: d.index, domain: "BODY", logType: "workout", data: { kind, minutes, intensity: 3 }, confidence: 0.6 };
  },
  (t) => {
    const m = /\b(?:called|phoned|talked to|spoke (?:to|with)|met (?:up )?with|texted|caught up with)\s+(?:my\s+)?(?!(?:a|an|the|it|off|in|out|about|up)\b)[a-z]+/i.exec(t);
    if (!m) return null;
    return { at: m.index, domain: "SOCIAL", logType: "interaction", data: { kind: "meaningful", note: m[0].slice(0, 200) }, confidence: 0.6 };
  },
];

/** One clause of a free-form entry and where it starts in the original text. */
export interface Clause {
  text: string;
  at: number;
}

/** Clause separators: ";", new lines, a comma or full stop that is not inside a number ("1,200", "7.5"), "and", "then". */
const CLAUSE_SEP = /\s*(?:;|\n|,(?!\d)|(?<!\d),|\.(?!\d)|(?<!\d)\.)\s*(?:(?:and\s+then|and|then)\s+)?|\s+(?:and\s+then|and|then)\s+/gi;

/** Splits an entry into clauses, so "slept 7 hours and ran 5km" is two: "slept 7 hours", "ran 5km". */
export function splitClauses(text: string): Clause[] {
  const out: Clause[] = [];
  const push = (from: number, to: number) => {
    const part = text.slice(from, to);
    const lead = part.length - part.trimStart().length;
    if (part.trim()) out.push({ text: part.trim(), at: from + lead });
  };
  let from = 0;
  for (const m of text.matchAll(CLAUSE_SEP)) {
    push(from, m.index);
    from = m.index + m[0].length;
  }
  push(from, text.length);
  return out;
}

/**
 * Keyword-parses free text into up to 3 proposals, one per thing it says, in the order they appear in the text.
 * Every rule runs on each clause, so two clauses give two proposals; each rule also runs on the whole text, so a
 * phrase the splitter cut ("gym, 40 min") still counts when no clause produced that type. Never throws.
 */
export function parseFreeText(text: string): LogProposal[] {
  const hits: Hit[] = [];
  for (const clause of splitClauses(text)) {
    for (const rule of RULES) {
      const h = rule(clause.text);
      if (h) hits.push({ ...h, at: clause.at + h.at });
    }
  }
  const found = new Set(hits.map((h) => `${h.domain}:${h.logType}`));
  for (const rule of RULES) {
    const h = rule(text);
    if (h && !found.has(`${h.domain}:${h.logType}`)) hits.push(h);
  }
  hits.sort((a, b) => a.at - b.at);
  return hits.slice(0, PARSE_MAX_PROPOSALS).map(({ at: _at, ...proposal }) => proposal);
}

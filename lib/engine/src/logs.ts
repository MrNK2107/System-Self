import {
  BASE_LOG_DELTAS,
  FORBIDDEN_DISCIPLINE_DELTA,
  FORBIDDEN_DOMAIN_DELTA,
  type RankedDomain,
} from "./constants";
import type { ChangeSpec } from "./scoring";

/** One structured log type: the picker label and the values a one-tap entry sends. */
export interface LogTypeInfo {
  type: string;
  label: string;
  defaults: Record<string, unknown>;
}

/**
 * The structured types the log modal offers per domain, first entry the default. Each `defaults` object is valid
 * data for that type (lib/contracts checks it against the schema). The untyped `generic` log and the special
 * `gym_session` / `floor_session` types are not offered here.
 */
export const LOG_TYPES: Record<RankedDomain, LogTypeInfo[]> = {
  BODY: [
    { type: "workout", label: "Workout", defaults: { kind: "Strength", minutes: 45, intensity: 4 } },
    { type: "sleep", label: "Sleep", defaults: { hours: 7.5, quality: 4 } },
    { type: "meal", label: "Meal", defaults: { description: "Meal", quality: 3 } },
    { type: "home_session", label: "Home Session", defaults: {} },
  ],
  MIND: [
    { type: "focus", label: "Focus", defaults: { minutes: 60, distraction: 2, subject: "Deep work" } },
    { type: "reading", label: "Reading", defaults: { pages: 20 } },
    { type: "learning", label: "Learning", defaults: { minutes: 30 } },
    { type: "journal", label: "Journal", defaults: { words: 200 } },
  ],
  WEALTH: [
    { type: "expense", label: "Expense", defaults: { amount: 100, category: "other" } },
    { type: "income", label: "Income", defaults: { amount: 1000, category: "salary" } },
    { type: "saving", label: "Saving", defaults: { amount: 100 } },
    { type: "investment", label: "Investment", defaults: { amount: 100 } },
  ],
  SOCIAL: [
    { type: "interaction", label: "Interaction", defaults: { kind: "meaningful" } },
    { type: "outreach", label: "Outreach", defaults: { count: 1 } },
    { type: "speaking", label: "Speaking", defaults: { minutes: 10 } },
  ],
  DISCIPLINE: [
    { type: "deadline_met", label: "Deadline Met", defaults: { label: "Deadline met" } },
    { type: "routine", label: "Routine", defaults: { label: "Routine" } },
  ],
};

// Float noise (2.5 * 0.6 * 0.7 = 1.0499999999999998) must not decide a rounding step.
const round1 = (n: number) => Math.round(Number(n.toPrecision(12)) * 10) / 10;

const rec = (data: unknown): Record<string, unknown> =>
  data !== null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The score changes of one log. `data` is validated upstream (lib/contracts); a missing or malformed field here
 * falls back to the plain base, so an old or untyped log scores exactly as it always did.
 * Penalties (sleep under 6 h, a poor meal) are still activity: the streak extends, the score drops.
 */
export function logChanges(domain: RankedDomain, logType: string, data: unknown, forbidden: boolean): ChangeSpec[] {
  if (forbidden) {
    return [
      { domain, delta: FORBIDDEN_DOMAIN_DELTA, bonus: false, activity: true },
      { domain: "DISCIPLINE", delta: FORBIDDEN_DISCIPLINE_DELTA, bonus: false, activity: false },
    ];
  }
  const base = BASE_LOG_DELTAS[domain];
  const d = rec(data);
  const scaled = (factor: number): ChangeSpec[] => [{ domain, delta: round1(base * factor), bonus: true, activity: true }];
  const flat = (delta: number): ChangeSpec[] => [{ domain, delta, bonus: false, activity: true }];

  switch (logType) {
    case "sleep": {
      const hours = num(d.hours);
      const quality = num(d.quality);
      if (hours === null || quality === null) break;
      const penalty = quality <= 2 ? 0.5 : 0;
      if (hours >= 7) {
        // Full base with the streak bonus; a poor night then costs a separate flat 0.5 that is not activity.
        const main = scaled(1);
        return penalty === 0 ? main : [...main, { domain, delta: -penalty, bonus: false, activity: false }];
      }
      return flat(round1((hours >= 6 ? 1 : -1) - penalty));
    }
    case "workout": {
      const intensity = num(d.intensity);
      if (intensity === null) break;
      return scaled(0.6 + 0.1 * intensity);
    }
    case "focus": {
      const minutes = num(d.minutes);
      const distraction = num(d.distraction);
      if (minutes === null || distraction === null) break;
      return scaled((minutes >= 60 ? 1 : minutes >= 30 ? 0.6 : 0.3) * (distraction >= 4 ? 0.7 : 1));
    }
    case "meal": {
      const quality = num(d.quality);
      if (quality === null) break;
      return flat(quality >= 4 ? 1 : quality <= 2 ? -0.5 : 0.5);
    }
    case "interaction":
      if (d.kind === "meaningful") return scaled(1);
      if (d.kind === "networking") return scaled(0.8);
      if (d.kind === "casual") return scaled(0.4);
      break;
    case "income":
    case "expense":
    case "saving":
    case "investment":
      // Logging consistency only; the real WEALTH movement comes from the weekly evaluation.
      if (domain === "WEALTH") return flat(0.5);
      break;
  }
  return [{ domain, delta: base, bonus: true, activity: true }];
}

const titleCase = (s: string) => {
  const t = s.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const join = (...parts: (string | null)[]) => parts.filter((p) => p !== null).join(" · ");

/** One line for the log history, for example `Sleep 7.5h · quality 4`. Pure; never throws on odd data. */
export function summarizeLog(log: { domain: string; logType: string; data: unknown; freeText?: string | null }): string {
  const d = rec(log.data);
  const q = num(d.quality);
  const quality = q === null ? null : `quality ${q}`;
  const mins = num(d.minutes);
  const amount = num(d.amount);
  switch (log.logType) {
    case "sleep": {
      const h = num(d.hours);
      return join(h === null ? "Sleep" : `Sleep ${h}h`, quality);
    }
    case "workout": {
      const i = num(d.intensity);
      return join(`${str(d.kind) ?? "Workout"}${mins === null ? "" : ` ${mins} min`}`, i === null ? null : `intensity ${i}`);
    }
    case "meal":
      return join(str(d.description) ?? "Meal", quality);
    case "focus": {
      const x = num(d.distraction);
      return join(`${str(d.subject) ?? "Focus"}${mins === null ? "" : ` ${mins} min`}`, x === null ? null : `distraction ${x}`);
    }
    case "reading": {
      const p = num(d.pages);
      return p === null ? "Reading" : `Read ${plural(p, "page", "pages")}`;
    }
    case "learning":
      return mins === null ? "Learning" : `Learned ${mins} min`;
    case "journal": {
      const w = num(d.words);
      return w === null ? "Journal" : `Journal ${plural(w, "word", "words")}`;
    }
    case "expense":
    case "income":
      return join(amount === null ? titleCase(log.logType) : `${titleCase(log.logType)} ${amount}`, str(d.category));
    case "saving":
      return amount === null ? "Saving" : `Saved ${amount}`;
    case "investment":
      return amount === null ? "Investment" : `Invested ${amount}`;
    case "interaction": {
      const k = str(d.kind);
      return k ? `${cap(k)} interaction` : "Interaction";
    }
    case "outreach": {
      const c = num(d.count);
      return c === null ? "Outreach" : `Outreach x${c}`;
    }
    case "speaking":
      return mins === null ? "Speaking" : `Spoke ${mins} min`;
    case "deadline_met":
    case "routine":
      return join(log.logType === "routine" ? "Routine" : "Deadline met", str(d.label));
    case "home_session":
    case "gym_session":
    case "floor_session":
      return titleCase(log.logType);
    case "generic":
      return str(log.freeText) ?? str(d.note) ?? "Log";
    default:
      return titleCase(log.logType);
  }
}

import { z } from "zod";
import type { RankedDomain } from "./game";

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const money = z.number().positive().finite().max(1e12);
const text = (max: number) => z.string().trim().min(1).max(max);
const note = z.string().max(200).optional();

/** The old untyped log and the special sessions keep free-form data (the 4 KB request limit still applies). */
const Free = z.record(z.string(), z.unknown());

const Workout = z.object({ kind: text(40), minutes: int(1, 600), intensity: int(1, 5) });
const Sleep = z.object({
  hours: z.number().min(0).max(16).multipleOf(0.25),
  quality: int(1, 5),
});
const Meal = z.object({ description: text(120), quality: int(1, 5) });
const Focus = z.object({ minutes: int(1, 600), distraction: int(1, 5), subject: text(60) });
const Reading = z.object({ pages: int(1, 2000) });
const Learning = z.object({ minutes: int(1, 600) });
const Journal = z.object({ words: int(1, 20000) });
const Money = z.object({ amount: money, category: text(40), note });
const Amount = z.object({ amount: money });
const Interaction = z.object({ kind: z.enum(["meaningful", "networking", "casual"]), note });
const Outreach = z.object({ count: int(1, 50) });
const Speaking = z.object({ minutes: int(1, 300) });
const Labelled = z.object({ label: text(80) });

/** Log types every domain accepts: the untyped log, and the sessions other features write. */
const COMMON = { generic: Free, gym_session: Free, floor_session: Free, home_session: Free } as const;

/** The data schema per (domain, logType). A logType missing here is not valid for that domain. */
export const LOG_DATA_SCHEMAS: Record<RankedDomain, Record<string, z.ZodTypeAny>> = {
  BODY: { ...COMMON, workout: Workout, sleep: Sleep, meal: Meal },
  MIND: { ...COMMON, focus: Focus, reading: Reading, learning: Learning, journal: Journal },
  WEALTH: { ...COMMON, income: Money, expense: Money, saving: Amount, investment: Amount },
  SOCIAL: { ...COMMON, interaction: Interaction, outreach: Outreach, speaking: Speaking },
  DISCIPLINE: { ...COMMON, deadline_met: Labelled, routine: Labelled },
};

export type LogDataResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: "unknown_log_type" | "invalid_log_data"; issues: { path: string; message: string }[] };

/**
 * Validates `data` for a log of this domain and type. Typed data comes back stripped to the schema's fields;
 * generic and session data pass through unchanged. A missing `data` counts as {}.
 */
export function parseLogData(domain: RankedDomain, logType: string, data: unknown): LogDataResult {
  const schema = Object.prototype.hasOwnProperty.call(LOG_DATA_SCHEMAS[domain], logType) ? LOG_DATA_SCHEMAS[domain][logType] : undefined;
  if (!schema) {
    return { ok: false, code: "unknown_log_type", issues: [{ path: "logType", message: `"${logType}" is not a log type of ${domain}` }] };
  }
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_log_data",
      issues: parsed.error.issues.map((i) => ({ path: ["data", ...i.path].join("."), message: i.message })),
    };
  }
  return { ok: true, data: parsed.data as Record<string, unknown> };
}

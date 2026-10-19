import { sql } from "drizzle-orm";
import type { Db } from "@workspace/db";

/**
 * Whether Postgres can compute local times in `tz`. TimezoneSchema validates against the Node runtime's ICU data,
 * but rollover and day-boundary SQL run `at time zone` in Postgres, whose tzdata can differ: a zone only Node knows
 * would fail every later query for that user. Run it outside any transaction (an error would abort it).
 */
export type TimezoneCheck = (db: Db, tz: string) => Promise<boolean>;

const known = new Set<string>();
const INVALID_PARAMETER_VALUE = "22023";

export const postgresKnowsTimezone: TimezoneCheck = async (db, tz) => {
  if (known.has(tz)) return true;
  try {
    await db.execute(sql`select now() at time zone ${tz}`);
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    if ((err.cause?.code ?? err.code) === INVALID_PARAMETER_VALUE) return false;
    throw e;
  }
  known.add(tz);
  return true;
};

/** Shaped like a validation error on `timezone`, so the app's "retry with a fallback zone" path applies. */
export const INVALID_TIMEZONE = {
  error: "Validation failed",
  code: "invalid_timezone",
  issues: [{ path: "timezone", message: "Unknown timezone" }],
} as const;

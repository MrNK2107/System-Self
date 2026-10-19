import { sql } from "drizzle-orm";
import { logs } from "@workspace/db";

/**
 * Logs the server writes on the user's behalf (recurring income) have `logs.system = true`, a column only server code
 * sets (never anything in a request, so a client cannot forge it). They count in the finance figures but are never
 * the user's activity: decay, comeback checklists, achievements, recaps, adherence metrics, clan activity, rival
 * matching and raids all skip them. Raw subqueries over `logs l` use `not l.system` directly.
 */
export const notSystemLog = sql`not ${logs.system}`;

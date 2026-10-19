import { sql } from "drizzle-orm";
import { logs } from "@workspace/db";

/**
 * Logs the rollover writes on the user's behalf (recurring income) carry `data.recurring = true`. They count in the
 * finance figures but are never the user's activity: decay, comeback checklists and achievements filter them out.
 */
export const notSystemLog = sql`coalesce(${logs.data}->>'recurring', 'false') <> 'true'`;

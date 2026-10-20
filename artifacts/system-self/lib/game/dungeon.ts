// Dungeon Briefing and Scout Reports: pure helpers and reads. No React Native imports.
import {
  BriefingResponseSchema,
  CrowdReportResponseSchema,
  QuietHoursResponseSchema,
  type GymBriefing,
  type QuietHours,
} from "@workspace/contracts";
import type { ApiClient } from "../api/client";
import type { Outbox } from "../api/outbox";
import { WEEKDAYS } from "../../features/gym/model/constants";
import { afterOutbox, type MutationResult } from "./actions";
import { weekdayOf } from "./gym";

export type BriefingBlock = GymBriefing["blocks"][number];
export type CrowdLevel = "quiet" | "normal" | "packed";

const WEEKDAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

/** `DUNGEON BRIEFING — MONDAY` for the briefing's local date (YYYY-MM-DD). */
export function briefingHeader(date: string): string {
  return `DUNGEON BRIEFING — ${WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()]}`;
}

/** `Equipment taken? Do: A / B` (what to do when the station is in use), or null when the exercise has no fallback. */
export function fallbackLine(block: Pick<BriefingBlock, "fallbacks">): string | null {
  return block.fallbacks.length > 0 ? `Equipment taken? Do: ${block.fallbacks.map((f) => f.name).join(" / ")}` : null;
}

export const briefingRowMeta = (b: Pick<BriefingBlock, "sets" | "repRange" | "restSec">): string =>
  `${b.sets} x ${b.repRange} · rest ${b.restSec}s`;

export const CROWD_PROMPT = "How crowded was it?";
export const CROWD_OPTIONS: { label: string; level: CrowdLevel | null }[] = [
  { label: "QUIET", level: "quiet" },
  { label: "NORMAL", level: "normal" },
  { label: "PACKED", level: "packed" },
  { label: "SKIP", level: null },
];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Slot-picker chips for the quiet-hour suggestions of one weekday (0 = Sunday, the user's local "today"): labelled
 * by hour alone, e.g. `07:00`, and starting the window then. Suggestions for other weekdays are not offered.
 */
export function quietChips(
  suggestions: QuietHours["suggestions"],
  weekday: number,
): { label: string; start: string }[] {
  return suggestions
    .filter((s) => s.weekday === weekday)
    .map((s) => ({ label: `${pad(s.hour)}:00`, start: `${pad(s.hour)}:00` }));
}

/** The weekday (0 = Sunday, as quiet-hours suggestions number it) of `now` in `tz`, the account timezone; else the device's. */
export function localWeekday(now: Date, tz?: string | null): number {
  return WEEKDAYS.indexOf(weekdayOf(now, tz ?? undefined));
}

/** "{needed} more scout reports needed" while the user has too few reports; otherwise null. */
export function quietHint(q: QuietHours | undefined): string | null {
  if (!q || q.needed <= 0) return null;
  return `${q.needed} more scout ${q.needed === 1 ? "report" : "reports"} needed`;
}

export function fetchBriefing(api: ApiClient, date?: string): Promise<GymBriefing> {
  const path = date ? `/api/gym/briefing?date=${encodeURIComponent(date)}` : "/api/gym/briefing";
  return api.request("GET", path, { schema: BriefingResponseSchema });
}

export function fetchQuietHours(api: ApiClient): Promise<QuietHours> {
  return api.request("GET", "/api/gym/quiet-hours", { schema: QuietHoursResponseSchema });
}

/** One tap after a session. A plain mutation, so queued logs land first; the clientId makes a retry harmless. */
export function submitCrowdReport(
  api: ApiClient,
  outbox: Pick<Outbox, "flushBeforeMutation">,
  level: CrowdLevel,
  sessionId: string | undefined,
  clientId: string,
): Promise<MutationResult<{ ok: true; weekday: number; hour: number }>> {
  return afterOutbox(outbox, () =>
    api.request("POST", "/api/gym/crowd", {
      body: { level, ...(sessionId ? { sessionId } : {}), clientId },
      idempotencyKey: clientId,
      schema: CrowdReportResponseSchema,
    }),
  );
}

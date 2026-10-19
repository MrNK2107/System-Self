// Deferral ledger, Floor Quest and Shadow takeover: pure helpers and reads. No React Native imports.
import { DeferralsResponseSchema, ShadowTakeoversResponseSchema, type FloorRoutineDto } from "@workspace/contracts";
import { z } from "zod";
import type { ApiClient } from "../api/client";
import type { LogInput } from "./actions";

export const REASON_MAX = 200;

/** The refusal reason as the server wants it: trimmed, 1-200 characters. Null when blank. */
export function normalizeReason(text: string): string | null {
  const t = text.trim().slice(0, REASON_MAX).trim();
  return t.length > 0 ? t : null;
}

export const LEDGER_HEADER = "DEFERRAL LEDGER";
export const floorHeader = (minutes: number) => `NOT THE GYM. ${minutes} MINUTES. HERE. NOW.`;
export const ledgerLine = (i: { localDate: string; reason: string; questTitle: string }) =>
  `${i.localDate} — "${i.reason}" — ${i.questTitle}`;
export const shadowTallyLine = (questTitle: string) => `SHADOW completed: ${questTitle}. You did not.`;

export interface FloorProgress {
  stepIndex: number;
  stepRemaining: number;
  totalRemaining: number;
  done: boolean;
}

/** Where a floor routine stands after `elapsedSec` seconds of running. */
export function floorProgress(routine: FloorRoutineDto, elapsedSec: number): FloorProgress {
  const total = routine.steps.reduce((s, x) => s + x.seconds, 0);
  const elapsed = Math.min(Math.max(0, Math.floor(elapsedSec)), total);
  if (elapsed >= total) {
    return { stepIndex: Math.max(0, routine.steps.length - 1), stepRemaining: 0, totalRemaining: 0, done: true };
  }
  let acc = 0;
  for (let i = 0; i < routine.steps.length; i++) {
    const end = acc + routine.steps[i]!.seconds;
    if (elapsed < end) return { stepIndex: i, stepRemaining: end - elapsed, totalRemaining: total - elapsed, done: false };
    acc = end;
  }
  return { stepIndex: 0, stepRemaining: 0, totalRemaining: 0, done: true };
}

/** The log for a finished floor session: an ordinary BODY log (it scores like any BODY log). */
export function floorLogInput(routine: Pick<FloorRoutineDto, "id" | "minutes">): LogInput {
  return { domain: "BODY", type: "floor_session", data: { routineId: routine.id, minutes: routine.minutes } };
}

export type Deferrals = z.infer<typeof DeferralsResponseSchema>;
export type ShadowTakeovers = z.infer<typeof ShadowTakeoversResponseSchema>;

export function fetchDeferrals(api: ApiClient, days = 7): Promise<Deferrals> {
  return api.request("GET", `/api/adherence/deferrals?days=${days}`, { schema: DeferralsResponseSchema });
}

export function fetchShadowTakeovers(api: ApiClient, days = 30): Promise<ShadowTakeovers> {
  return api.request("GET", `/api/adherence/shadow-takeovers?days=${days}`, { schema: ShadowTakeoversResponseSchema });
}

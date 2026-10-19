import type { Notice } from "@workspace/contracts";
import { detectComeback, evaluateComeback } from "./comeback";
import { applyChanges, type ApplyResult, type ScoreChange } from "./scoring";
import type { Tx } from "./user-lock";

/**
 * The one way an activity path scores (POST /logs, quest complete, gym session complete). Around applyChanges it
 * runs the activity side effects in their required order:
 * 1. detectComeback, before applyChanges moves lastActivityDate, when any change counts as activity
 *    (the gap is judged from `activityDate`, default `ctx.localDate`);
 * 2. applyChanges;
 * 3. `afterApply`, the caller's own follow-ups (home-session count, chain completion);
 * 4. evaluateComeback, so a checklist finished by this activity yields its returner mark in the same response.
 * Notices come back in that order: [comeback..., applied..., afterApply..., marks...].
 * Must run inside withUserLock. Paths that score without being activity (refusal, expiry, rollover) call
 * applyChanges directly.
 */
export async function applyActivityChanges(
  tx: Tx,
  userId: string,
  changes: ScoreChange[],
  ctx: { localDate: string; now: Date },
  opts: { activityDate?: string; afterApply?: () => Promise<Notice[]> } = {},
): Promise<ApplyResult> {
  const comeback = changes.some((c) => c.activity)
    ? await detectComeback(tx, userId, { activityDate: opts.activityDate ?? ctx.localDate, now: ctx.now })
    : [];
  const { results, notices } = await applyChanges(tx, userId, changes, ctx);
  const extra = opts.afterApply ? await opts.afterApply() : [];
  const marks = (await evaluateComeback(tx, userId, ctx.now)).notices;
  return { results, notices: [...comeback, ...notices, ...extra, ...marks] };
}

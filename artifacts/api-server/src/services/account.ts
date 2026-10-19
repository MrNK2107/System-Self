// Account deletion. Rows owned by the user cascade with it; what other players kept about them is scrubbed here.
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { billingEvents, notices, profiles, userReports, users } from "@workspace/db";
import { FORMER_OPERATOR_HANDLE } from "@workspace/contracts";
import type { Tx } from "./user-lock";

/** Notice kinds whose payload names another player by `handle` (a username or a public codename). */
export const HANDLE_NOTICE_KINDS = ["shame", "duo_checkin", "challenge_received", "challenge_result"] as const;

/**
 * Deletes the account inside the caller's transaction (which holds the user's lock): other players' notices naming
 * the user get FORMER OPERATOR as the handle, reports about the user are kept (the subject id goes null, the handle
 * snapshot stays for admin review), then the user row goes and everything it owns cascades. Clan dispatches name the
 * user by id and render FORMER OPERATOR once it is gone.
 * Used by DELETE /auth/account and POST /admin/users/:id/delete. docs/RUNBOOK.md has a last-resort SQL copy of these
 * steps: keep it in sync when this changes.
 */
export async function deleteAccount(tx: Tx, userId: string): Promise<void> {
  const [me] = await tx
    .select({ username: users.username, codename: profiles.publicCodename })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!me) return;
  const handles = [me.username, ...(me.codename ? [me.codename] : [])];
  await tx
    .update(notices)
    .set({ payload: sql`jsonb_set(${notices.payload}, '{handle}', to_jsonb(${FORMER_OPERATOR_HANDLE}::text))` })
    .where(
      and(
        ne(notices.userId, userId),
        inArray(notices.kind, [...HANDLE_NOTICE_KINDS]),
        or(...handles.map((h) => sql`${notices.payload}->>'handle' = ${h}`)),
      ),
    );
  await tx
    .update(userReports)
    .set({ subjectHandle: me.username })
    .where(and(eq(userReports.subjectId, userId), isNull(userReports.subjectHandle)));
  // Keep each billing event's id and type (replay protection); drop the payload, which carries the user's ids.
  await tx.update(billingEvents).set({ payload: {} }).where(eq(billingEvents.userId, userId));
  await tx.delete(users).where(eq(users.id, userId));
}

import { Router, type IRouter } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { domainScores, notices, rivalChallenges, rivalTaunts, users, type Db } from "@workspace/db";
import { RIVAL_CHALLENGE_DAYS, RivalChallengeRequestSchema } from "@workspace/contracts";
import { addDays, localDate, type RankedDomain } from "@workspace/engine";
import { z } from "zod";
import type { AiDeps } from "../lib/ai";
import { buildUserContext, generateMessage, type PromptContext } from "../services/ai-context";
import { findReplay, readKey, withIdempotency, type HandlerResult } from "../services/idempotency";
import { MESSAGE_LIMIT_RESULT, overMessageLimit, storeMessage } from "../services/messages";
import { ensureRolledOver, rollOverDue } from "../services/rollover";
import {
  buildRivalsResponse,
  ensureAssignments,
  ownAssignment,
  rivalProfiles,
  rivalScores,
  toChallengeDto,
  toTauntDto,
} from "../services/rivals";
import { withUserLock, type Tx } from "../services/user-lock";

const IdSchema = z.string().uuid();
const TAUNT_ROUTE = "POST /rivals/taunt";

const notFound = (): HandlerResult => ({ status: 404, body: { error: "Rival not found", code: "not_found" } });
const challengeOpen = (): HandlerResult => ({
  status: 409,
  body: { error: "A challenge against this rival is already running", code: "challenge_open" },
});
const tauntLimit = (): HandlerResult => ({
  status: 429,
  body: { error: "One transmission per rival per day", code: "taunt_limit" },
});

async function todayOf(tx: Pick<Tx, "select">, userId: string, now: Date): Promise<string> {
  const [u] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  return localDate(now, u?.tz ?? "UTC");
}

async function tauntedToday(tx: Pick<Tx, "select">, userId: string, assignmentId: string, today: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: rivalTaunts.id })
    .from(rivalTaunts)
    .where(and(eq(rivalTaunts.userId, userId), eq(rivalTaunts.assignmentId, assignmentId), eq(rivalTaunts.localDate, today)))
    .limit(1);
  return !!row;
}

/**
 * The old client's rival transmissions, used when the model is unavailable. Picked by day, no randomness.
 * A ghost is a simulation, not a person: its lines are third person in the SYSTEM voice and carry no signature.
 */
export function tauntTemplate(codename: string, trajectory: string, dayNumber: number, isGhost = false): string {
  const name = codename.split(" // ")[1] ?? codename;
  if (isGhost) {
    const ghostLines = [
      `RIVAL // ${name} logged again. You did not.`,
      `RIVAL // ${name} held the line yesterday. The gap grows.`,
      `RIVAL // ${name} is watching your scores plateau.`,
      `RIVAL // ${name} was where you are. It did not stay there.`,
      trajectory === "up"
        ? `RIVAL // ${name} is accelerating. The gap will show in your dashboard.`
        : `Even at stable, RIVAL // ${name} is ahead of you.`,
    ];
    return ghostLines[Math.abs(dayNumber) % ghostLines.length]!;
  }
  const lines = [
    `Your logs are inconsistent. Mine are not. — ${name}`,
    `You missed yesterday. I did not. The gap grows. — ${name}`,
    `Watching your scores plateau from here. — ${name}`,
    `I was where you are. I did not stay there. — ${name}`,
    trajectory === "up" ? `I am accelerating. You will see the gap in your dashboard. — ${name}` : `Even at stable I am ahead of you. — ${name}`,
  ];
  return lines[Math.abs(dayNumber) % lines.length]!;
}

const FIRST_PERSON = /\b(I|me|my|mine|myself|I'm|I've|I'll)\b/i;

type TauntPhase =
  | { kind: "done"; result: HandlerResult }
  | { kind: "generate"; ctx: PromptContext; codename: string; isGhost: boolean; extraContext: string; template: string };

export function rivalsRoutes(db: Db, ai: AiDeps, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  router.get("/rivals", async (req, res) => {
    const me = req.user!.id;
    const now = clock();
    await ensureRolledOver(db, me, now);
    await withUserLock(db, me, (tx) => ensureAssignments(tx, me, now));
    res.json(await buildRivalsResponse(db, me, now));
  });

  /** A free 7-day gain-vs-gain challenge in one domain against an assigned rival (no score effect). */
  router.post("/rivals/:assignmentId/challenge", async (req, res) => {
    const { domain } = RivalChallengeRequestSchema.parse(req.body ?? {});
    const id = IdSchema.safeParse(req.params.assignmentId);
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /rivals/challenge", async (tx) => {
      if (!id.success) return notFound();
      const now = clock();
      await rollOverDue(tx, me, now);
      const assignment = await ownAssignment(tx, me, id.data);
      if (!assignment) return notFound();
      const [running] = await tx
        .select({ id: rivalChallenges.id })
        .from(rivalChallenges)
        .where(and(eq(rivalChallenges.assignmentId, assignment.id), isNull(rivalChallenges.outcome)))
        .limit(1);
      if (running) return challengeOpen();
      const rival = (await rivalScores(tx, [assignment])).get(assignment.id);
      if (!rival) return notFound();
      const [mine] = await tx
        .select({ score: domainScores.score })
        .from(domainScores)
        .where(and(eq(domainScores.userId, me), eq(domainScores.domain, domain)))
        .limit(1);
      const today = await todayOf(tx, me, now);
      const round2 = (n: number) => Math.round(n * 100) / 100;
      const [row] = await tx
        .insert(rivalChallenges)
        .values({
          userId: me,
          assignmentId: assignment.id,
          codename: assignment.codename,
          domain,
          startDate: today,
          endDate: addDays(today, RIVAL_CHALLENGE_DAYS - 1),
          userStart: round2(mine?.score ?? 0),
          rivalStart: round2(rival[domain as RankedDomain]),
          createdAt: now,
        })
        .returning();
      return { status: 201, body: toChallengeDto(row!) };
    });
  });

  /** Acknowledges a resolved challenge (and marks its result notice seen). */
  router.post("/rivals/challenges/:id/ack", async (req, res) => {
    const id = IdSchema.safeParse(req.params.id);
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /rivals/challenges/ack", async (tx) => {
      if (!id.success) return { status: 404, body: { error: "Challenge not found", code: "not_found" } };
      const [c] = await tx
        .select()
        .from(rivalChallenges)
        .where(and(eq(rivalChallenges.id, id.data), eq(rivalChallenges.userId, me)))
        .limit(1);
      if (!c) return { status: 404, body: { error: "Challenge not found", code: "not_found" } };
      if (c.outcome === null) return challengeOpen();
      const now = clock();
      if (!c.acknowledgedAt) await tx.update(rivalChallenges).set({ acknowledgedAt: now }).where(eq(rivalChallenges.id, c.id));
      await tx
        .update(notices)
        .set({ seenAt: now })
        .where(
          and(
            eq(notices.userId, me),
            eq(notices.kind, "rival_challenge_result"),
            isNull(notices.seenAt),
            sql`${notices.payload}->>'challengeId' = ${c.id}`,
          ),
        );
      return { status: 204, body: null };
    });
  });

  /**
   * A rival_taunt transmission from one rival, at most one per rival per local day. Like POST /messages, the
   * model call runs outside the user lock: (1) checks and context under the lock, (2) generate, (3) re-check and
   * store under the lock (withIdempotency).
   */
  router.post("/rivals/:assignmentId/taunt", async (req, res) => {
    const id = IdSchema.safeParse(req.params.assignmentId);
    const me = req.user!.id;
    if (!id.success) return void res.status(404).json(notFound().body);

    const step1 = await withUserLock(db, me, async (tx): Promise<TauntPhase> => {
      const replay = await findReplay(tx, me, readKey(req), TAUNT_ROUTE);
      if (replay) return { kind: "done", result: replay };
      const now = clock();
      await rollOverDue(tx, me, now);
      const assignment = await ownAssignment(tx, me, id.data);
      if (!assignment) return { kind: "done", result: notFound() };
      const ctx = await buildUserContext(tx, me, now);
      if (!ctx) return { kind: "done", result: { status: 409, body: { error: "Onboarding required", code: "not_onboarded" } } };
      if (await tauntedToday(tx, me, assignment.id, ctx.today)) return { kind: "done", result: tauntLimit() };
      if (await overMessageLimit(tx, me, ctx.today)) return { kind: "done", result: MESSAGE_LIMIT_RESULT };
      const profile = (await rivalProfiles(tx, [assignment], now)).get(assignment.id);
      const isGhost = assignment.ghostId !== null;
      const trajectory = profile?.trajectory ?? "stable";
      return {
        kind: "generate",
        ctx,
        codename: assignment.codename,
        isGhost,
        extraContext: isGhost
          ? `The rival ${assignment.codename} is a simulation, not a person (rank ${profile?.rank ?? ctx.rank}, trajectory ${trajectory}). Write in the SYSTEM voice, third person, about the rival by its codename. Never use "I" or "me", never sign off, never claim to be a real person.`
          : `Speak as the rival ${assignment.codename} (rank ${profile?.rank ?? ctx.rank}, trajectory ${trajectory}).`,
        template: tauntTemplate(assignment.codename, trajectory, ctx.dayNumber, isGhost),
      };
    });
    if (step1.kind === "done") return void res.status(step1.result.status).json(step1.result.body);

    const generated = await generateMessage("rival_taunt", step1.ctx, ai, { extraContext: step1.extraContext }, step1.template);
    // A ghost never speaks as a person: model text in the first person falls back to the third-person template.
    if (step1.isGhost && FIRST_PERSON.test(generated.message)) generated.message = step1.template;

    await withIdempotency(db, req, res, TAUNT_ROUTE, async (tx) => {
      const now = clock();
      const assignment = await ownAssignment(tx, me, id.data);
      if (!assignment) return notFound();
      const today = await todayOf(tx, me, now);
      if (await tauntedToday(tx, me, assignment.id, today)) return tauntLimit();
      if (await overMessageLimit(tx, me, today)) return MESSAGE_LIMIT_RESULT;
      const [row] = await tx
        .insert(rivalTaunts)
        .values({ userId: me, assignmentId: assignment.id, codename: assignment.codename, isGhost: assignment.ghostId !== null, message: generated.message, localDate: today, createdAt: now })
        .returning();
      await storeMessage(tx, me, "rival_taunt", { ...step1.ctx, today }, generated, step1.extraContext);
      return { status: 201, body: toTauntDto(row!) };
    });
  });

  router.post("/rivals/taunts/read", async (req, res) => {
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /rivals/taunts/read", async (tx) => {
      await tx.update(rivalTaunts).set({ readAt: clock() }).where(and(eq(rivalTaunts.userId, me), isNull(rivalTaunts.readAt)));
      return { status: 204, body: null };
    });
  });

  return router;
}

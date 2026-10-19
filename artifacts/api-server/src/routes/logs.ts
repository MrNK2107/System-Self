import express, { Router, type IRouter, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { logs, profiles, quests, userDayState, users, type Db } from "@workspace/db";
import { PARSE_LIMIT_PER_DAY, VOICE_LIMIT_PER_DAY, addDays, localDate, logChanges } from "@workspace/engine";
import {
  AI_UNAVAILABLE_CODE,
  LogListQuerySchema,
  LogRequestSchema,
  PARSE_LIMIT_CODE,
  ParseRequestSchema,
  VOICE_LIMIT_CODE,
  parseLogData,
} from "@workspace/contracts";
import { aiAvailable, type AiDeps } from "../lib/ai";
import { parseAudio, parseText } from "../services/ai-parse";
import { consumeDailyCall, refundDailyCall } from "../services/daily-limit";
import { requirePro } from "../services/entitlements";
import { withIdempotency } from "../services/idempotency";
import { rollOverDue } from "../services/rollover";
import { track } from "../services/analytics";
import { applyActivityChanges } from "../services/activity";
import { countHomeSession } from "../services/comeback";
import { checkOccurredAt } from "../services/retroactive";
import { logger } from "../lib/logger";

/** A stored log as the API returns it (also used by routes that record logs of their own, e.g. finance). */
export function toLogDto(l: typeof logs.$inferSelect) {
  return {
    id: l.id,
    clientId: l.clientId,
    domain: l.domain as "BODY" | "MIND" | "WEALTH" | "SOCIAL" | "DISCIPLINE",
    logType: l.logType,
    data: l.data,
    freeText: l.freeText,
    forbidden: l.forbidden,
    occurredAt: l.occurredAt.toISOString(),
    localDate: l.localDate,
    isRetroactive: l.isRetroactive,
    createdAt: l.createdAt.toISOString(),
  };
}

function encodeCursor(l: typeof logs.$inferSelect): string {
  return Buffer.from(`${l.occurredAt.toISOString()}|${l.id}`).toString("base64url");
}

function decodeCursor(c: string): { at: Date; id: string } | null {
  const [iso, id] = Buffer.from(c, "base64url").toString().split("|");
  const at = new Date(iso ?? "");
  if (!iso || !id || Number.isNaN(at.getTime())) return null;
  return { at, id };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Voice uploads: the container formats the app's recorder produces. Audio never exceeds 5 MB (about 120 s of speech). */
const VOICE_TYPES = ["audio/m4a", "audio/mp4", "audio/aac", "audio/webm"] as const;
const VOICE_MAX_BYTES = 5 * 1024 * 1024;
/** Gemini takes m4a as an MP4 container. */
const MODEL_MIME: Record<string, string> = { "audio/m4a": "audio/mp4" };

const contentTypeOf = (req: Request) => (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();

/** 415 for any other content type, before the body is read. */
const voiceTypeGuard: RequestHandler = (req, res, next) => {
  if (!(VOICE_TYPES as readonly string[]).includes(contentTypeOf(req))) {
    res.status(415).json({ error: "Unsupported audio type", code: "unsupported_media_type" });
    return;
  }
  next();
};

/** The raw body as a Buffer, limited to 5 MB: a larger Content-Length is 413 before any of it is read. */
const rawAudio = express.raw({ type: () => true, limit: VOICE_MAX_BYTES });
const voiceBody: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  rawAudio(req, res, (err?: unknown) => {
    if (err && (err as { type?: string }).type === "entity.too.large") {
      res.status(413).json({ error: "Audio is larger than 5 MB", code: "audio_too_large" });
      return;
    }
    next(err);
  });
};

export function logsRoutes(db: Db, clock: () => Date = () => new Date(), ai: AiDeps = {}): IRouter {
  const router = Router();

  // Free-form text to proposals. Read-only: nothing is logged or scored until the client posts a confirmed proposal
  // to POST /logs with the text as freeText.
  router.post("/logs/parse", async (req, res) => {
    const { text } = ParseRequestSchema.parse(req.body);
    if (!(await consumeDailyCall(db, req.user!.id, "parse_call", PARSE_LIMIT_PER_DAY, clock()))) {
      res.status(429).json({ error: "Parse limit reached for today", code: PARSE_LIMIT_CODE });
      return;
    }
    res.json({ proposals: await parseText(text, ai) });
  });

  // PRO voice log: a recording to { transcript, proposals }. Read-only too, and the audio is kept in memory for
  // this request only: it is never stored, and neither it nor the transcript is logged.
  router.post("/logs/voice", requirePro(db, clock), voiceTypeGuard, voiceBody, async (req, res) => {
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "No audio received", code: "empty_audio" });
      return;
    }
    if (!aiAvailable()) {
      res.status(503).json({ error: "Voice logging is unavailable", code: AI_UNAVAILABLE_CODE });
      return;
    }
    const now = clock();
    if (!(await consumeDailyCall(db, req.user!.id, "voice_call", VOICE_LIMIT_PER_DAY, now))) {
      res.status(429).json({ error: "Voice limit reached for today", code: VOICE_LIMIT_CODE });
      return;
    }
    const type = contentTypeOf(req);
    const out = await parseAudio({ data: body, mimeType: MODEL_MIME[type] ?? type }, ai);
    if (!out.ok) {
      if (out.code === "audio_too_long") res.status(422).json({ error: "Recording is longer than 120 seconds", code: "audio_too_long" });
      else {
        // Our side failed, not the user's: the call does not count against the day (audio_too_long and successes do).
        try {
          await refundDailyCall(db, req.user!.id, "voice_call", now);
        } catch (err) {
          logger.error({ err: (err as Error).message }, "Voice limit refund failed");
        }
        res.status(503).json({ error: "Voice logging is unavailable", code: AI_UNAVAILABLE_CODE });
      }
      return;
    }
    res.json({ transcript: out.transcript, proposals: out.proposals });
  });

  router.post("/logs", async (req, res) => {
    const body = LogRequestSchema.parse(req.body);
    const userId = req.user!.id;
    // Data is checked against the schema of its (domain, logType) before anything is stored or scored.
    const parsedData = parseLogData(body.domain, body.logType, body.data);
    if (!parsedData.ok) {
      res.status(400).json({
        error: parsedData.code === "unknown_log_type" ? "Unknown log type" : "Validation failed",
        code: parsedData.code,
        issues: parsedData.issues,
      });
      return;
    }
    const data = parsedData.data;

    await withIdempotency(db, req, res, "POST /logs", async (tx) => {
      const now = clock();
      const occurredAt = body.occurredAt ? new Date(body.occurredAt) : now;
      const tooOld = await checkOccurredAt(tx, userId, now, occurredAt);
      if (tooOld) return tooOld;

      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      const [profile] = await tx.select({ id: profiles.userId, onboardedAt: profiles.onboardedAt }).from(profiles).where(eq(profiles.userId, userId));
      if (!user || !profile) return { status: 409, body: { error: "Not onboarded", code: "not_onboarded" } };
      const today = localDate(now, user.timezone);
      const logDate = localDate(occurredAt, user.timezone);
      // Roll only the dates before the log's own date, so an offline log synced after midnight still
      // counts for its date's streak and decay; the remaining due dates roll after it is applied.
      await rollOverDue(tx, userId, now, { before: logDate });

      // The clientId is the idempotency key, so a stored response replays above. Once that has been
      // pruned, a retry gets the stored log back without applying it again.
      const [dup] = await tx
        .select()
        .from(logs)
        .where(and(eq(logs.userId, userId), eq(logs.clientId, body.clientId)))
        .limit(1);
      if (dup) return { status: 200, body: { log: toLogDto(dup), results: [], notices: [] } };

      const forbidden = body.forbidden ?? false;
      const [log] = await tx
        .insert(logs)
        .values({
          userId,
          clientId: body.clientId,
          domain: body.domain,
          logType: body.logType,
          data,
          freeText: body.freeText ?? null,
          forbidden,
          occurredAt,
          localDate: logDate,
          isRetroactive: logDate < today,
          createdAt: now,
        })
        .returning();

      // A log for a date that has already rolled over still scores, but it is not activity: its streak, decay and
      // demotion were settled at rollover, so it must not repair a streak, move lastLogDate/lastActivityDate back,
      // or trigger a comeback (PRO's 30-day window must not buy rank). Nothing rolled yet means everything before the
      // onboarding date counts as settled (checkOccurredAt already refuses those dates).
      const [day] = await tx.select({ rolled: userDayState.lastRolledDate }).from(userDayState).where(eq(userDayState.userId, userId)).limit(1);
      const settledThrough = day?.rolled ?? addDays(localDate(profile.onboardedAt, user.timezone), -1);
      const rolledOver = settledThrough >= logDate;
      const changes = logChanges(body.domain, body.logType, data, forbidden).map((c) => ({
        ...c,
        activity: rolledOver ? false : c.activity,
        reason: forbidden ? ("forbidden" as const) : ("log" as const),
        refId: log!.id,
      }));
      const { results, notices } = await applyActivityChanges(tx, userId, changes, { localDate: logDate, now }, {
        // A backdated home session for a settled date is not live training: it never counts toward the gym unlock.
        afterApply: rolledOver
          ? undefined
          : () => countHomeSession(tx, userId, { id: log!.id, logType: body.logType, forbidden, localDate: logDate }, now),
      });
      await rollOverDue(tx, userId, now);
      // Only a floor session started from a refusal's floor offer completes that offer (floorUptake): the id
      // must be a quest this user refused, so a client cannot inflate the metric with arbitrary ids.
      const refusedQuestId = data.refusedQuestId;
      if (body.logType === "floor_session" && typeof refusedQuestId === "string" && UUID.test(refusedQuestId)) {
        const [refused] = await tx
          .select({ id: quests.id })
          .from(quests)
          .where(and(eq(quests.id, refusedQuestId), eq(quests.userId, userId), eq(quests.status, "refused")))
          .limit(1);
        if (refused) await track(tx, userId, "floor_completed", { logId: log!.id, questId: refused.id });
      }
      return { status: 201, body: { log: toLogDto(log!), results, notices } };
    }, { preferClientId: true });
  });

  router.get("/logs", async (req, res) => {
    const q = LogListQuerySchema.parse(req.query);
    const userId = req.user!.id;
    let cursorWhere;
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      if (!c) {
        res.status(400).json({ error: "Invalid cursor", code: "invalid_cursor" });
        return;
      }
      cursorWhere = or(lt(logs.occurredAt, c.at), and(eq(logs.occurredAt, c.at), lt(logs.id, c.id)));
    }
    const rows = await db
      .select()
      .from(logs)
      .where(and(eq(logs.userId, userId), cursorWhere))
      .orderBy(desc(logs.occurredAt), desc(logs.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    res.json({
      items: page.map(toLogDto),
      nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1]!) : null,
    });
  });

  return router;
}

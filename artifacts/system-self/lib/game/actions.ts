// Network logic behind the game screens: reads, the outbox for logs, and guarded quest/chain mutations.
// No React Native imports (used by the smoke script under plain node).
import {
  ChainStartResponseSchema,
  ChainTemplatesResponseSchema,
  GameStateSchema,
  LogListResponseSchema,
  LogRequestSchema,
  NoticeListResponseSchema,
  QuestCompleteResponseSchema,
  QuestGenerateResponseSchema,
  QuestListResponseSchema,
  QuestRefuseResponseSchema,
  type GameLog,
} from "@workspace/contracts";
import { z } from "zod";
import type { ApiClient } from "../api/client";
import type { Outbox, OutboxEntry } from "../api/outbox";
import type { Domain } from "./types";

// Notice lists are parsed loosely here: a kind this build does not know must not fail the whole response.
// notices.ts parses each one with NoticeSchema and skips unknown kinds.
const LooseNotices = z.array(z.unknown());
export const LooseGameStateSchema = GameStateSchema.extend({ unseenNotices: LooseNotices });
export type LooseGameState = z.infer<typeof LooseGameStateSchema>;
const LooseNoticeListSchema = NoticeListResponseSchema.extend({ items: LooseNotices });
const LooseQuestCompleteSchema = QuestCompleteResponseSchema.extend({ notices: LooseNotices });
const LooseQuestRefuseSchema = QuestRefuseResponseSchema.extend({ notices: LooseNotices });

export type QuestList = z.infer<typeof QuestListResponseSchema>;
export type ChainTemplates = z.infer<typeof ChainTemplatesResponseSchema>;

/** A random id for idempotent requests and outbox items. */
export function newClientId(prefix: string): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rand()}${rand()}`;
}

// --- reads -------------------------------------------------------------------

export function fetchGameState(api: ApiClient): Promise<LooseGameState> {
  return api.request("GET", "/api/state", { schema: LooseGameStateSchema });
}

/** The most recent logs, newest first. */
export async function fetchLogs(api: ApiClient, limit = 100): Promise<GameLog[]> {
  const res = await api.request("GET", `/api/logs?limit=${limit}`, { schema: LogListResponseSchema });
  return res.items;
}

export function fetchQuests(api: ApiClient): Promise<QuestList> {
  return api.request("GET", "/api/quests", { schema: QuestListResponseSchema });
}

export function fetchChains(api: ApiClient): Promise<ChainTemplates> {
  return api.request("GET", "/api/chains/templates", { schema: ChainTemplatesResponseSchema });
}

export function fetchNotices(api: ApiClient): Promise<{ items: unknown[]; hasMore: boolean }> {
  return api.request("GET", "/api/notices", { schema: LooseNoticeListSchema });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SEEN_BATCH = 100; // the server accepts at most 100 ids per request

/**
 * POST /api/notices/seen, in chunks of 100. Ids that cannot be server notice ids are dropped (the server would
 * reject the batch) and count as handled. Never throws: `handled` is exactly the ids the caller may forget
 * (also on a mid-way failure), `error` is the failure that stopped the rest.
 */
export async function markNoticesSeen(
  api: ApiClient,
  ids: readonly string[],
  clientId: string,
): Promise<{ handled: string[]; error: unknown }> {
  const handled = ids.filter((id) => !UUID.test(id));
  const valid = ids.filter((id) => UUID.test(id));
  for (let i = 0; i < valid.length; i += SEEN_BATCH) {
    const chunk = valid.slice(i, i + SEEN_BATCH);
    const key = i === 0 ? clientId : `${clientId}-${i / SEEN_BATCH}`;
    try {
      await api.request("POST", "/api/notices/seen", { body: { ids: chunk, clientId: key }, idempotencyKey: key });
    } catch (error) {
      return { handled, error };
    }
    handled.push(...chunk);
  }
  return { handled, error: null };
}

// --- logs (through the outbox) ---------------------------------------------------

export interface LogInput {
  domain: Domain;
  type: string;
  forbidden?: boolean;
  note?: string;
  intensity?: number;
}

/** The outbox entry for one log. The clientId is the server's idempotency key. */
export function buildLogRequest(input: LogInput, clientId: string, now: Date = new Date()): OutboxEntry {
  const note = input.note?.trim();
  const body = LogRequestSchema.parse({
    clientId,
    domain: input.domain,
    logType: input.type,
    data: input.intensity === undefined ? {} : { intensity: input.intensity },
    ...(note ? { freeText: note.slice(0, 2000) } : {}),
    forbidden: input.forbidden ?? false,
    occurredAt: now.toISOString(),
  });
  return { clientId, method: "POST", path: "/api/logs", body };
}

/** Queues a log. Sending happens on the next outbox flush. */
export async function enqueueLog(outbox: Pick<Outbox, "enqueue">, input: LogInput, clientId = newClientId("log")): Promise<OutboxEntry> {
  const entry = buildLogRequest(input, clientId);
  await outbox.enqueue(entry);
  return entry;
}

/** Re-queues every failed outbox item (same clientId, so a log the server did take is not doubled). */
export async function retryFailedEntries(outbox: Pick<Outbox, "failed" | "enqueue" | "clearFailed">): Promise<number> {
  const failed = outbox.failed();
  for (const f of failed) {
    await outbox.enqueue({ clientId: f.item.clientId, method: f.item.method, path: f.item.path, body: f.item.body });
  }
  await outbox.clearFailed();
  return failed.length;
}

export async function discardFailedEntries(outbox: Pick<Outbox, "clearFailed">): Promise<void> {
  await outbox.clearFailed();
}

// --- guarded mutations -------------------------------------------------------------

export type MutationResult<T> = { ok: true; value: T } | { ok: false; reason: "sync_pending" };

/**
 * Server rule: queued logs land before any other mutation. Flush the outbox first; while older items cannot
 * be sent, the mutation is not sent either.
 */
export async function afterOutbox<T>(
  outbox: Pick<Outbox, "flushBeforeMutation">,
  send: () => Promise<T>,
): Promise<MutationResult<T>> {
  if (!(await outbox.flushBeforeMutation())) return { ok: false, reason: "sync_pending" };
  return { ok: true, value: await send() };
}

type Guard = Pick<Outbox, "flushBeforeMutation">;

export function completeQuest(api: ApiClient, outbox: Guard, questId: string, clientId: string) {
  return afterOutbox(outbox, () =>
    api.request("POST", `/api/quests/${encodeURIComponent(questId)}/complete`, {
      body: { clientId },
      idempotencyKey: clientId,
      schema: LooseQuestCompleteSchema,
    }),
  );
}

export function refuseQuest(api: ApiClient, outbox: Guard, questId: string, reason: string | undefined, clientId: string) {
  const trimmed = reason?.trim().slice(0, 200);
  return afterOutbox(outbox, () =>
    api.request("POST", `/api/quests/${encodeURIComponent(questId)}/refuse`, {
      body: { ...(trimmed ? { reason: trimmed } : {}), clientId },
      idempotencyKey: clientId,
      schema: LooseQuestRefuseSchema,
    }),
  );
}

export function startChain(api: ApiClient, outbox: Guard, templateKey: string, clientId: string) {
  return afterOutbox(outbox, () =>
    api.request("POST", "/api/chains", {
      body: { templateKey, clientId },
      idempotencyKey: clientId,
      schema: ChainStartResponseSchema,
    }),
  );
}

export function generateQuests(api: ApiClient, outbox: Guard, clientId: string) {
  return afterOutbox(outbox, () =>
    api.request("POST", "/api/quests/generate", { body: {}, idempotencyKey: clientId, schema: QuestGenerateResponseSchema }),
  );
}

// CUSTOM domains (GET/POST/PATCH/DELETE /api/custom-domains, POST .../logs): plain helpers and requests, no React
// Native imports. A custom domain is a user-defined stat with its own 0-100 score; it is never part of rank. Creating,
// editing and archiving are plain requests sent after the outbox; a custom LOG goes through the outbox with its
// clientId like every other log, so it survives being offline.
import {
  CUSTOM_LOG_LABEL_MAX,
  CUSTOM_NAME_MAX,
  CUSTOM_NOTE_MAX,
  CUSTOM_UNIT_MAX,
  CustomDomainDetailSchema,
  CustomDomainListSchema,
  CustomLogRequestSchema,
  type CustomDomainDetail,
  type CustomDomainDto,
  type CustomDomainList,
} from "@workspace/contracts";
import { customProgress } from "@workspace/engine";
import { ApiError, type ApiClient } from "../api/client";
import type { Outbox, OutboxEntry, OutboxItem } from "../api/outbox";
import { afterOutbox, type MutationResult } from "../game/actions";

export { isProRequired } from "../api/pro";

/** The signed-in user's active custom domains (GET /api/custom-domains). */
export const customDomainsKey = (userId: string | null) => ["custom-domains", userId] as const;
/** One custom domain with its recent logs (GET /api/custom-domains/:id); under the list key, so one invalidation covers both. */
export const customDomainKey = (userId: string | null, id: string) => ["custom-domains", userId, "detail", id] as const;
/** Everything custom (the list and every detail), for invalidating together after a mutation. */
export const customRootKeys = (userId: string | null) => [customDomainsKey(userId)] as const;

type Guard = Pick<Outbox, "flushBeforeMutation">;
const seg = encodeURIComponent;

export interface CustomDomainInput {
  name: string;
  unit: string;
  logLabel: string;
  baseline: number;
  target: number;
  isPublic: boolean;
}

export interface CustomDomainDraft {
  name: string;
  unit: string;
  logLabel: string;
  baseline: string;
  target: string;
  isPublic: boolean;
}

/** A finite number typed by the user (`1,200.5` or `-3`); null when blank or unreadable. */
export function parseCustomNumber(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && Math.abs(n) <= 1e9 ? n : null;
}

/** The create / edit form against the server's rules. A blank log label reads `Log`. */
export function checkCustomDomainForm(draft: CustomDomainDraft): { ok: true; input: CustomDomainInput } | { ok: false; message: string } {
  const name = draft.name.trim();
  const unit = draft.unit.trim();
  const logLabel = draft.logLabel.trim() || "Log";
  if (name.length < 1 || name.length > CUSTOM_NAME_MAX) return { ok: false, message: `Name the stat in 1 to ${CUSTOM_NAME_MAX} characters.` };
  if (unit.length > CUSTOM_UNIT_MAX) return { ok: false, message: `The unit is at most ${CUSTOM_UNIT_MAX} characters.` };
  if (logLabel.length > CUSTOM_LOG_LABEL_MAX) return { ok: false, message: `The log label is at most ${CUSTOM_LOG_LABEL_MAX} characters.` };
  const baseline = parseCustomNumber(draft.baseline);
  const target = parseCustomNumber(draft.target);
  if (baseline === null) return { ok: false, message: "The starting value is a number." };
  if (target === null) return { ok: false, message: "The target is a number." };
  return { ok: true, input: { name, unit, logLabel, baseline, target, isPublic: draft.isPublic } };
}

/** The log form: a number and an optional note. */
export function checkCustomLogForm(valueText: string, noteText: string): { ok: true; value: number; note: string | undefined } | { ok: false; message: string } {
  const value = parseCustomNumber(valueText);
  if (value === null) return { ok: false, message: "Enter the value as a number." };
  const note = noteText.trim();
  if (note.length > CUSTOM_NOTE_MAX) return { ok: false, message: `The note is at most ${CUSTOM_NOTE_MAX} characters.` };
  return { ok: true, value, note: note || undefined };
}

/** Where the latest value stands between baseline and target, as a bar fraction and a line. */
export function progressLine(d: Pick<CustomDomainDto, "baseline" | "target" | "unit" | "latestValue">): { fraction: number; line: string } {
  const unit = d.unit ? ` ${d.unit}` : "";
  const fraction = customProgress(d.baseline, d.target, d.latestValue);
  if (d.latestValue === null) return { fraction, line: `No entry yet  ·  ${d.baseline} to ${d.target}${unit}` };
  return { fraction, line: `${d.latestValue}${unit} of ${d.target}${unit}  ·  from ${d.baseline}` };
}

/** "2 of 3 custom domains.", whether another can be created, and whether to hint at PRO. */
export function customLimitLine(list: Pick<CustomDomainList, "items" | "limit" | "isPro">): { line: string; canCreate: boolean; proHint: boolean } {
  const used = list.items.length;
  const canCreate = used < list.limit;
  return { line: `${used} of ${list.limit} custom domains.`, canCreate, proHint: !canCreate && !list.isPro };
}

/** SYSTEM-voice line for a failed custom-domain request. */
export function describeCustomError(err: unknown): string {
  if (!(err instanceof ApiError)) return "The request failed. Retry.";
  if (err.kind === "network") return "No connection. Check your signal and retry.";
  if (err.kind !== "http") return "The system is unavailable. Retry shortly.";
  switch (err.code) {
    case "pro_required":
      return "Free operators track 3 custom stats. More needs PRO.";
    case "custom_limit":
      return "20 custom stats is the limit. Archive one first.";
    case "name_taken":
      return "You already track a stat with that name.";
    case "archived":
      return "That stat is archived. It keeps its history and takes no new entries.";
    case "retroactive_limit":
      return "Entries can be dated at most 48 hours back.";
    case "not_found":
      return "Stat not found. It may have been removed.";
    default:
      if (err.status === 400) return "Check the fields and retry.";
      return (err.status ?? 0) >= 500 ? "The system is unavailable. Retry shortly." : "The request was rejected.";
  }
}

// --- custom logs through the outbox ------------------------------------------------------------------

const logPath = (domainId: string) => `/api/custom-domains/${domainId}/logs`;

/** The outbox entry for one custom log (`value`, optional `note`), dated now. */
export function buildCustomLogRequest(
  domainId: string,
  input: { value: number; note?: string },
  clientId: string,
  now: Date = new Date(),
): OutboxEntry {
  const note = input.note?.trim();
  const body = CustomLogRequestSchema.parse({
    clientId,
    value: input.value,
    ...(note ? { note } : {}),
    occurredAt: now.toISOString(),
  });
  return { clientId, method: "POST", path: logPath(domainId), body };
}

/** Queues a custom log. Sending happens on the next outbox flush. */
export async function enqueueCustomLog(
  outbox: Pick<Outbox, "enqueue">,
  domainId: string,
  input: { value: number; note?: string },
  clientId: string,
): Promise<OutboxEntry> {
  const entry = buildCustomLogRequest(domainId, input, clientId);
  await outbox.enqueue(entry);
  return entry;
}

export interface PendingCustomLog {
  clientId: string;
  value: number;
  note: string | null;
  occurredAt: string;
  pending: true;
}

/** Queued custom logs of one domain, shown as pending entries until the server has them. */
export function pendingCustomLogs(items: readonly OutboxItem[], domainId: string): PendingCustomLog[] {
  const out: PendingCustomLog[] = [];
  for (const item of items) {
    if (item.path !== logPath(domainId)) continue;
    const parsed = CustomLogRequestSchema.safeParse(item.body);
    if (!parsed.success) continue;
    out.push({
      clientId: parsed.data.clientId,
      value: parsed.data.value,
      note: parsed.data.note ?? null,
      occurredAt: parsed.data.occurredAt ?? new Date().toISOString(),
      pending: true,
    });
  }
  return out;
}

// --- requests ----------------------------------------------------------------------------------------

export function fetchCustomDomains(api: ApiClient): Promise<CustomDomainList> {
  return api.request("GET", "/api/custom-domains", { schema: CustomDomainListSchema });
}

export function fetchCustomDomain(api: ApiClient, id: string): Promise<CustomDomainDetail> {
  return api.request("GET", `/api/custom-domains/${seg(id)}`, { schema: CustomDomainDetailSchema });
}

export function createCustomDomain(api: ApiClient, outbox: Guard, input: CustomDomainInput, clientId: string): Promise<MutationResult<CustomDomainDetail>> {
  return afterOutbox(outbox, () =>
    api.request("POST", "/api/custom-domains", { body: { ...input, clientId }, idempotencyKey: clientId, schema: CustomDomainDetailSchema }),
  );
}

export function updateCustomDomain(
  api: ApiClient,
  outbox: Guard,
  id: string,
  patch: Partial<CustomDomainInput>,
  clientId: string,
): Promise<MutationResult<CustomDomainDetail>> {
  return afterOutbox(outbox, () =>
    api.request("PATCH", `/api/custom-domains/${seg(id)}`, { body: { ...patch, clientId }, idempotencyKey: clientId, schema: CustomDomainDetailSchema }),
  );
}

/** Archives: the history stays, the stat stops counting toward the limit and takes no new entries. */
export function archiveCustomDomain(api: ApiClient, outbox: Guard, id: string, clientId: string): Promise<MutationResult<CustomDomainDetail>> {
  return afterOutbox(outbox, () =>
    api.request("DELETE", `/api/custom-domains/${seg(id)}`, { idempotencyKey: clientId, schema: CustomDomainDetailSchema }),
  );
}

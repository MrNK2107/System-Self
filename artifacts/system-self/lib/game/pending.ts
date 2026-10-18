// Outbox bookkeeping for the log list. Pure, no React Native imports.
import type { OutboxItem } from "../api/outbox";
import { pendingLogEntries } from "./mappers";
import type { LogEntry } from "./types";

/** True when a previously queued item is gone (sent or parked). Items only arriving do not count. */
export function pendingSetChanged(prev: readonly OutboxItem[], next: readonly OutboxItem[]): boolean {
  const now = new Set(next.map((i) => i.clientId));
  return prev.some((i) => !now.has(i.clientId));
}

/**
 * Logs that just left the queue stay on screen (as sent, not pending) until the logs query returns them,
 * so the list does not flicker between "pending" and "server has it". Returns the same map when nothing changed.
 */
export function trackSentLogs(
  recent: ReadonlyMap<string, LogEntry>,
  prev: readonly OutboxItem[],
  next: readonly OutboxItem[],
  failedIds: ReadonlySet<string>,
  serverClientIds: ReadonlySet<string>,
): ReadonlyMap<string, LogEntry> {
  const stillQueued = new Set(next.map((i) => i.clientId));
  const out = new Map(recent);
  for (const entry of pendingLogEntries(prev)) {
    if (stillQueued.has(entry.clientId) || failedIds.has(entry.clientId) || serverClientIds.has(entry.clientId)) continue;
    out.set(entry.clientId, { ...entry, pending: false });
  }
  for (const id of serverClientIds) out.delete(id);
  return out.size === recent.size && [...out.keys()].every((k) => recent.has(k)) ? recent : out;
}

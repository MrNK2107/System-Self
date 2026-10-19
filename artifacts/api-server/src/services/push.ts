// Expo Push API client and delivery. The HTTP client is injected (`fetch`), so tests never touch the network.
import { inArray } from "drizzle-orm";
import { pushTokens, type Db } from "@workspace/db";
import { logger } from "../lib/logger";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_BATCH_SIZE = 100;
/** Each Expo request is abandoned after this long; its messages become error tickets (the push is lost). */
export const EXPO_TIMEOUT_MS = 10_000;
/** The app's Android notification channel (lib/notifications.ts CHANNEL_ID). */
export const PUSH_CHANNEL_ID = "system-self";

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Always 0: the app never shows a badge count. */
  badge: 0;
  /** Server pushes are silent (no `sound`) and land on the app's own Android channel. */
  channelId: typeof PUSH_CHANNEL_ID;
  data?: Record<string, unknown>;
}

export interface PushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Sends messages and returns one ticket per message, in order. Never throws for delivery problems. */
export type PushTransport = (messages: PushMessage[]) => Promise<PushTicket[]>;

export function createExpoTransport(opts: { fetch?: typeof fetch; accessToken?: string | null; timeoutMs?: number } = {}): PushTransport {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? EXPO_TIMEOUT_MS;
  return async (messages) => {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
      const failed = (message: string): PushTicket[] => batch.map(() => ({ status: "error" as const, message }));
      try {
        const res = await doFetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
          },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          tickets.push(...failed(`Expo push API answered ${res.status}`));
          continue;
        }
        const json = (await res.json()) as { data?: PushTicket[] };
        const data = Array.isArray(json.data) ? json.data : [];
        // A malformed answer must keep tickets aligned with messages.
        tickets.push(...batch.map((_, j) => data[j] ?? { status: "error" as const, message: "Missing ticket" }));
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        logger.warn({ errName: err instanceof Error ? err.name : "unknown", timedOut, messages: batch.length }, "Expo push request failed");
        tickets.push(...failed(timedOut ? "Expo push request timed out" : "Expo push request failed"));
      }
    }
    return tickets;
  };
}

export interface PushSendResult {
  sent: number;
  removed: number;
  /** Error tickets, and their count per Expo error code (`unknown` when Expo gave none). Never tokens. */
  errors: number;
  errorCodes: Record<string, number>;
}

/**
 * Sends `messages` and deletes every token Expo reports as `DeviceNotRegistered`. Returns the messages Expo accepted,
 * the tokens removed and the error tickets by code. Receipts are not checked (tickets only).
 */
export async function sendPushMessages(db: Db, transport: PushTransport, messages: PushMessage[]): Promise<PushSendResult> {
  if (messages.length === 0) return { sent: 0, removed: 0, errors: 0, errorCodes: {} };
  const tickets = await transport(messages);
  let sent = 0;
  let errors = 0;
  const errorCodes: Record<string, number> = {};
  const dead: string[] = [];
  messages.forEach((m, i) => {
    const t = tickets[i];
    if (t?.status === "ok") {
      sent++;
      return;
    }
    errors++;
    const code = t?.details?.error ?? "unknown";
    errorCodes[code] = (errorCodes[code] ?? 0) + 1;
    if (code === "DeviceNotRegistered") dead.push(m.to);
  });
  if (dead.length > 0) await db.delete(pushTokens).where(inArray(pushTokens.token, dead));
  return { sent, removed: dead.length, errors, errorCodes };
}

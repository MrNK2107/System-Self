// Expo Push API client and delivery. The HTTP client is injected (`fetch`), so tests never touch the network.
import { inArray } from "drizzle-orm";
import { pushTokens, type Db } from "@workspace/db";
import { logger } from "../lib/logger";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_BATCH_SIZE = 100;

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Always 0: the app never shows a badge count. */
  badge: 0;
  sound?: "default";
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

export function createExpoTransport(opts: { fetch?: typeof fetch; accessToken?: string | null } = {}): PushTransport {
  const doFetch = opts.fetch ?? fetch;
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
        logger.warn({ err }, "Expo push request failed");
        tickets.push(...failed("Expo push request failed"));
      }
    }
    return tickets;
  };
}

/**
 * Sends `messages` and deletes every token Expo reports as `DeviceNotRegistered`. Returns the messages Expo accepted
 * and the tokens removed. Receipts are not checked (tickets only).
 */
export async function sendPushMessages(db: Db, transport: PushTransport, messages: PushMessage[]): Promise<{ sent: number; removed: number }> {
  if (messages.length === 0) return { sent: 0, removed: 0 };
  const tickets = await transport(messages);
  let sent = 0;
  const dead: string[] = [];
  messages.forEach((m, i) => {
    const t = tickets[i];
    if (t?.status === "ok") sent++;
    else if (t?.details?.error === "DeviceNotRegistered") dead.push(m.to);
  });
  if (dead.length > 0) await db.delete(pushTokens).where(inArray(pushTokens.token, dead));
  return { sent, removed: dead.length };
}


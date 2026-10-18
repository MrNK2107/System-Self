import { ApiError, api } from "./client";

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface OutboxItem {
  clientId: string;
  method: "POST";
  path: string;
  body: unknown;
}

export interface FailedOutboxItem {
  item: OutboxItem;
  status: number;
  message: string;
}

export interface Outbox {
  ready(): Promise<void>;
  enqueue(item: OutboxItem): Promise<void>;
  /** Sends oldest-first; stops at the first item that cannot be sent right now. */
  flush(): Promise<{ sent: number; remaining: number }>;
  /** Flush and report whether the queue is empty. Call before any non-outbox mutation. */
  flushBeforeMutation(): Promise<boolean>;
  pending(): OutboxItem[];
  failed(): FailedOutboxItem[];
  clearFailed(): Promise<void>;
}

export const OUTBOX_KEY = "system_self.outbox.v1";

interface Persisted {
  items: OutboxItem[];
  failed: FailedOutboxItem[];
}

// 4xx responses are permanent rejections except these, which are worth retrying.
const RETRYABLE_STATUS = new Set([401, 408, 429]);

export function createOutbox(deps: {
  storage: KeyValueStorage;
  send: (item: OutboxItem) => Promise<void>;
}): Outbox {
  let items: OutboxItem[] = [];
  let failed: FailedOutboxItem[] = [];
  let flushing: Promise<{ sent: number; remaining: number }> | null = null;
  // Serialises storage writes so persisted state always matches the latest in-memory state.
  let writeChain: Promise<void> = Promise.resolve();

  const hydrated = (async () => {
    try {
      const raw = await deps.storage.getItem(OUTBOX_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      items = Array.isArray(parsed.items) ? parsed.items : [];
      failed = Array.isArray(parsed.failed) ? parsed.failed : [];
    } catch {
      items = [];
      failed = [];
    }
  })();

  function persist(): Promise<void> {
    const snapshot = JSON.stringify({ items, failed } satisfies Persisted);
    writeChain = writeChain.then(() => deps.storage.setItem(OUTBOX_KEY, snapshot));
    return writeChain;
  }

  async function runFlush(): Promise<{ sent: number; remaining: number }> {
    await hydrated;
    let sent = 0;
    while (items.length > 0) {
      const head = items[0]!;
      try {
        await deps.send(head);
        items.shift();
        sent += 1;
        await persist();
      } catch (e) {
        if (!(e instanceof ApiError) || e.kind !== "http" || e.status === undefined) break; // network, parse, unknown: keep and stop
        if (e.status === 409 && e.code === "duplicate_client_id") {
          items.shift();
          sent += 1;
          await persist();
          continue;
        }
        const retry = e.status >= 500 || RETRYABLE_STATUS.has(e.status);
        if (retry || e.status < 400) break;
        failed.push({ item: head, status: e.status, message: e.message });
        items.shift();
        await persist();
      }
    }
    return { sent, remaining: items.length };
  }

  const outbox: Outbox = {
    ready: () => hydrated,
    async enqueue(item) {
      await hydrated;
      if (items.some((i) => i.clientId === item.clientId)) return;
      items.push(item);
      await persist();
    },
    flush() {
      if (!flushing) {
        flushing = runFlush().finally(() => {
          flushing = null;
        });
      }
      return flushing;
    },
    async flushBeforeMutation() {
      // A flush already in flight may have read the queue before a later enqueue, so check again if items remain.
      let result = await outbox.flush();
      if (result.remaining > 0 && result.sent > 0) result = await outbox.flush();
      return result.remaining === 0;
    },
    pending: () => [...items],
    failed: () => [...failed],
    async clearFailed() {
      await hydrated;
      failed = [];
      await persist();
    },
  };
  return outbox;
}

let singleton: Outbox | null = null;

/** The app-wide outbox, backed by AsyncStorage and the shared API client. */
export function getOutbox(): Outbox {
  if (!singleton) {
    const AsyncStorage = (require("@react-native-async-storage/async-storage") as typeof import("@react-native-async-storage/async-storage")).default;
    singleton = createOutbox({
      storage: AsyncStorage,
      send: async (item) => {
        await api.request(item.method, item.path, { body: item.body, idempotencyKey: item.clientId });
      },
    });
  }
  return singleton;
}

export function flushBeforeMutation(): Promise<boolean> {
  return getOutbox().flushBeforeMutation();
}

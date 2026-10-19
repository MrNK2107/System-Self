import { ApiError, api } from "./client";
import { secureTokenStore } from "./session";

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** What callers enqueue; the outbox stamps the owner (userId) itself. */
export interface OutboxEntry {
  clientId: string;
  method: "POST";
  path: string;
  body: unknown;
}

export interface OutboxItem extends OutboxEntry {
  userId: string;
}

export interface FailedOutboxItem {
  item: OutboxItem;
  status: number;
  message: string;
  reason: "rejected" | "poison";
}

export interface Outbox {
  ready(): Promise<void>;
  /** Queues for the signed-in user. Rejects with a 401 ApiError when nobody is signed in. */
  enqueue(entry: OutboxEntry): Promise<void>;
  /** Sends the current user's items oldest-first; stops at the first item that cannot be sent right now. */
  flush(): Promise<{ sent: number; remaining: number }>;
  /** Flush and report whether the current user's queue is empty. Call before any non-outbox mutation. */
  flushBeforeMutation(): Promise<boolean>;
  /** The current user's queued items (as of the last flush/enqueue). */
  pending(): OutboxItem[];
  /** The current user's items that were dropped, for the UI. */
  failed(): FailedOutboxItem[];
  clearFailed(): Promise<void>;
  /** Forget everything for every user (sign-out / account switch). */
  reset(): Promise<void>;
  /** Called after every change to the queued or failed items. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export const OUTBOX_KEY = "system_self.outbox.v1";
/** Consecutive 5xx / coded-401 responses on the head item before it is parked as failed. */
export const POISON_ATTEMPTS = 5;

interface Persisted {
  items: OutboxItem[];
  failed: FailedOutboxItem[];
}

// Retry later without counting against the item.
const TRANSIENT_STATUS = new Set([401, 408, 429]);
/** The code of POST /api/auth/refresh's 401, which the client rethrows for the request that needed it. */
const REFRESH_REJECTED_CODE = "invalid_refresh";

export function createOutbox(deps: {
  storage: KeyValueStorage;
  send: (item: OutboxItem) => Promise<void>;
  getUserId: () => Promise<string | null>;
}): Outbox {
  let items: OutboxItem[] = [];
  let failed: FailedOutboxItem[] = [];
  let currentUser: string | null = null;
  const attempts = new Map<string, number>();
  let flushing: Promise<{ sent: number; remaining: number; processed: number }> | null = null;
  // Serialises storage writes so persisted state always matches the latest in-memory state.
  let writeChain: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const hydrated = (async () => {
    try {
      const raw = await deps.storage.getItem(OUTBOX_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      items = Array.isArray(parsed.items) ? parsed.items.filter((i) => typeof i?.userId === "string") : [];
      failed = Array.isArray(parsed.failed) ? parsed.failed : [];
    } catch {
      items = [];
      failed = [];
    }
  })();

  function notify() {
    for (const l of [...listeners]) {
      try {
        l();
      } catch {
        // A listener's failure never breaks the queue.
      }
    }
  }

  function persist(): Promise<void> {
    const snapshot = JSON.stringify({ items, failed } satisfies Persisted);
    writeChain = writeChain.then(() => deps.storage.setItem(OUTBOX_KEY, snapshot));
    notify();
    return writeChain;
  }

  const mine = () => items.filter((i) => i.userId === currentUser);

  async function refreshUser() {
    try {
      currentUser = await deps.getUserId();
    } catch {
      currentUser = null;
    }
  }

  async function runFlush(): Promise<{ sent: number; remaining: number; processed: number }> {
    await hydrated;
    let sent = 0;
    let processed = 0;
    for (;;) {
      await refreshUser(); // re-checked per item so an account switch mid-flush never sends under the wrong user
      const head = mine()[0];
      if (!head) break;
      const remove = () => {
        items = items.filter((i) => i !== head);
        attempts.delete(head.clientId);
      };
      try {
        await deps.send(head);
        remove();
        sent += 1;
        processed += 1;
        await persist();
      } catch (e) {
        if (!(e instanceof ApiError) || e.kind !== "http" || e.status === undefined) break; // network, parse, storage: keep and stop
        if (e.status === 409 && e.code === "duplicate_client_id") {
          remove();
          sent += 1;
          processed += 1;
          await persist();
          continue;
        }
        const permanent4xx = e.status >= 400 && e.status < 500 && !TRANSIENT_STATUS.has(e.status);
        // 5xx and a coded 401 can repeat forever on a bad item; park it after POISON_ATTEMPTS tries. A rejected
        // refresh (invalid_refresh) is about the session, not the item: the item waits for the next sign-in.
        const countsAgainstItem =
          e.status >= 500 || (e.status === 401 && e.code !== undefined && e.code !== REFRESH_REJECTED_CODE);
        if (countsAgainstItem) {
          const n = (attempts.get(head.clientId) ?? 0) + 1;
          attempts.set(head.clientId, n);
          if (n >= POISON_ATTEMPTS) {
            failed.push({ item: head, status: e.status, message: e.message, reason: "poison" });
            remove();
            processed += 1;
            await persist();
            continue;
          }
          break;
        }
        if (!permanent4xx) break; // 401 (session gone), 408, 429: keep and stop
        failed.push({ item: head, status: e.status, message: e.message, reason: "rejected" });
        remove();
        processed += 1;
        await persist();
      }
    }
    return { sent, remaining: mine().length, processed };
  }

  function flushInternal() {
    if (!flushing) {
      flushing = runFlush().finally(() => {
        flushing = null;
      });
    }
    return flushing;
  }

  const outbox: Outbox = {
    ready: async () => {
      await hydrated;
      await refreshUser();
    },
    async enqueue(entry) {
      await hydrated;
      await refreshUser();
      if (!currentUser) throw new ApiError({ kind: "http", status: 401, message: "Not signed in" });
      if (items.some((i) => i.clientId === entry.clientId && i.userId === currentUser)) return;
      items.push({ ...entry, userId: currentUser });
      await persist();
    },
    async flush() {
      const { sent, remaining } = await flushInternal();
      return { sent, remaining };
    },
    async flushBeforeMutation() {
      // Keep flushing while it makes progress: an enqueue that raced an in-flight flush is picked up by the next pass.
      for (;;) {
        const r = await flushInternal();
        if (mine().length === 0) return true;
        if (r.processed === 0) return false;
      }
    },
    pending: () => mine(),
    failed: () => failed.filter((f) => f.item.userId === currentUser),
    async clearFailed() {
      await hydrated;
      failed = failed.filter((f) => f.item.userId !== currentUser);
      await persist();
    },
    async reset() {
      await hydrated;
      // Wait out an in-flight flush so it cannot resurrect items after the wipe.
      await flushing?.catch(() => undefined);
      items = [];
      failed = [];
      attempts.clear();
      await persist();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
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
      getUserId: async () => (await secureTokenStore.get())?.user.id ?? null,
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

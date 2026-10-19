import type { ZodType } from "zod";
import { apiBaseUrl } from "./config";
import { newRequestId } from "./request-id";
import { AuthResponseSchema, secureTokenStore, type Session, type TokenStore } from "./session";

export type ApiErrorKind = "network" | "http" | "parse" | "storage";

/** One validation problem from a 400 response: `path` is dotted ("timezone", "ratings.SOCIAL"). */
export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  /** The server's validation issues (400 responses); empty otherwise. */
  readonly issues: ApiIssue[];

  constructor(init: { kind: ApiErrorKind; message: string; status?: number; code?: string; issues?: ApiIssue[] }) {
    super(init.message);
    this.name = "ApiError";
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.issues = init.issues ?? [];
  }
}

/** React Query retry policy: only transient failures (network, 5xx), at most 2 retries. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!(error instanceof ApiError)) return false;
  return error.kind === "network" || (error.kind === "http" && (error.status ?? 0) >= 500);
}

function parseIssues(raw: unknown): ApiIssue[] {
  if (!Array.isArray(raw)) return [];
  const out: ApiIssue[] = [];
  for (const i of raw) {
    if (i && typeof i === "object" && typeof (i as ApiIssue).message === "string") {
      const path = (i as ApiIssue).path;
      out.push({ path: typeof path === "string" ? path : "", message: (i as ApiIssue).message });
    }
  }
  return out;
}

export interface RequestOptions<T> {
  body?: unknown;
  schema?: ZodType<T>;
  idempotencyKey?: string;
  /** Default true. false sends no token and never refreshes (login, register, ...). */
  auth?: boolean;
  /** A raw (non-JSON) request body, for example a voice recording. Replaces `body`. */
  binary?: { body: Blob | ArrayBuffer; contentType: string };
  /** Overrides the 30 s request timeout (an upload followed by an AI call needs longer). */
  timeoutMs?: number;
  /** Return the response body as untouched text plus its Content-Disposition header, instead of parsed JSON. */
  raw?: boolean;
}

/** What a `raw` request resolves to. */
export interface RawResponse {
  text: string;
  contentDisposition: string | null;
}

export interface ApiClient {
  request<T = unknown>(method: string, path: string, opts?: RequestOptions<T>): Promise<T>;
}

export interface ApiClientDeps {
  fetch: typeof fetch;
  tokens: TokenStore;
  baseUrl: string;
  onSessionExpired: () => void;
}

const REQUEST_TIMEOUT_MS = 30_000;

interface Reply {
  status: number;
  ok: boolean;
  body: unknown;
  text: string;
  contentDisposition: string | null;
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  let refreshing: Promise<void> | null = null;

  // Token storage failures surface as ApiError storage, never as raw native errors.
  async function getSession(): Promise<Session | null> {
    try {
      return await deps.tokens.get();
    } catch {
      throw new ApiError({ kind: "storage", message: "Could not read the stored session" });
    }
  }
  async function setSession(s: Session | null): Promise<void> {
    try {
      await deps.tokens.set(s);
    } catch {
      throw new ApiError({ kind: "storage", message: "Could not write the stored session" });
    }
  }

  // The timeout covers the whole exchange, including reading the body.
  async function send(method: string, path: string, opts: RequestOptions<unknown>, token: string | null): Promise<Reply> {
    const headers: Record<string, string> = { Accept: "application/json", "x-request-id": newRequestId() };
    if (opts.binary) headers["Content-Type"] = opts.binary.contentType;
    else if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
    try {
      const res = await deps.fetch(`${deps.baseUrl}${path}`, {
        method,
        headers,
        body: opts.binary ? opts.binary.body : opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
      const text = await res.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      return { status: res.status, ok: res.ok, body, text, contentDisposition: res.headers.get("content-disposition") };
    } catch {
      throw new ApiError({ kind: "network", message: "Network request failed" });
    } finally {
      clearTimeout(timer);
    }
  }

  function httpError(status: number, body: unknown): ApiError {
    const b = (body && typeof body === "object" ? body : {}) as { error?: unknown; code?: unknown; issues?: unknown };
    return new ApiError({
      kind: "http",
      status,
      code: typeof b.code === "string" ? b.code : undefined,
      issues: parseIssues(b.issues),
      message: typeof b.error === "string" ? b.error : `Request failed (${status})`,
    });
  }

  // One refresh at a time; every waiting request shares its outcome.
  async function doRefresh(): Promise<void> {
    const current = await getSession();
    if (!current) throw new ApiError({ kind: "http", status: 401, message: "Unauthorized" });
    const res = await send("POST", "/api/auth/refresh", { body: { refreshToken: current.refreshToken } }, null);
    // Only a 401 means the refresh token is dead. 5xx / 429 / others keep the session for a later retry.
    if (res.status === 401) {
      await setSession(null);
      deps.onSessionExpired();
      throw httpError(401, res.body);
    }
    if (!res.ok) throw httpError(res.status, res.body);
    const parsed = AuthResponseSchema.safeParse(res.body);
    if (!parsed.success) throw new ApiError({ kind: "parse", message: "Unexpected refresh response" });
    await setSession(parsed.data);
  }

  function refreshOnce(): Promise<void> {
    if (!refreshing) {
      refreshing = doRefresh().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  // A 401 with an endpoint-specific code (e.g. invalid_password) is a real answer, not an expired token.
  const isExpiredToken = (body: unknown) => !(body && typeof body === "object" && "code" in body);

  async function request<T = unknown>(method: string, path: string, opts: RequestOptions<T> = {}): Promise<T> {
    const useAuth = opts.auth !== false;
    const session: Session | null = useAuth ? await getSession() : null;
    const usedToken = session?.accessToken ?? null;

    let res = await send(method, path, opts, usedToken);

    if (res.status === 401 && useAuth && isExpiredToken(res.body)) {
      const latest = await getSession();
      // No session at all: nothing to refresh. Otherwise refresh unless another request already rotated the token.
      if (latest && latest.accessToken === usedToken) await refreshOnce();
      const next = await getSession();
      if (next) res = await send(method, path, opts, next.accessToken);
    }

    if (!res.ok) throw httpError(res.status, res.body);
    if (opts.raw) return { text: res.text, contentDisposition: res.contentDisposition } as T;
    if (opts.schema) {
      const parsed = opts.schema.safeParse(res.body);
      if (!parsed.success) throw new ApiError({ kind: "parse", message: `Unexpected response from ${path}` });
      return parsed.data;
    }
    return res.body as T;
  }

  return { request };
}

const expiredListeners = new Set<() => void>();

/** Subscribe to forced sign-out (refresh token rejected). Returns an unsubscribe function. */
export function onSessionExpired(cb: () => void): () => void {
  expiredListeners.add(cb);
  return () => void expiredListeners.delete(cb);
}

export const api: ApiClient = createApiClient({
  fetch: (input, init) => fetch(input, init),
  tokens: secureTokenStore,
  get baseUrl() {
    return apiBaseUrl();
  },
  onSessionExpired: () => expiredListeners.forEach((cb) => cb()),
});

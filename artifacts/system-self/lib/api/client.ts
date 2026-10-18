import type { ZodType } from "zod";
import { apiBaseUrl } from "./config";
import { AuthResponseSchema, secureTokenStore, type Session, type TokenStore } from "./session";

export type ApiErrorKind = "network" | "http" | "parse";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;

  constructor(init: { kind: ApiErrorKind; message: string; status?: number; code?: string }) {
    super(init.message);
    this.name = "ApiError";
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
  }
}

export interface RequestOptions<T> {
  body?: unknown;
  schema?: ZodType<T>;
  idempotencyKey?: string;
  /** Default true. false sends no token and never refreshes (login, register, ...). */
  auth?: boolean;
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

export function createApiClient(deps: ApiClientDeps): ApiClient {
  let refreshing: Promise<void> | null = null;

  async function send(method: string, path: string, opts: RequestOptions<unknown>, token: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await deps.fetch(`${deps.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } catch {
      throw new ApiError({ kind: "network", message: "Network request failed" });
    } finally {
      clearTimeout(timer);
    }
  }

  async function readBody(res: Response): Promise<unknown> {
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new ApiError({ kind: "network", message: "Network request failed" });
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function httpError(status: number, body: unknown): ApiError {
    const b = (body && typeof body === "object" ? body : {}) as { error?: unknown; code?: unknown };
    return new ApiError({
      kind: "http",
      status,
      code: typeof b.code === "string" ? b.code : undefined,
      message: typeof b.error === "string" ? b.error : `Request failed (${status})`,
    });
  }

  // One refresh at a time; every waiting request shares its outcome.
  async function doRefresh(): Promise<void> {
    const current = await deps.tokens.get();
    if (!current) throw new ApiError({ kind: "http", status: 401, message: "Unauthorized" });
    const res = await send("POST", "/api/auth/refresh", { body: { refreshToken: current.refreshToken } }, null);
    const body = await readBody(res);
    if (res.status === 401) {
      await deps.tokens.set(null);
      deps.onSessionExpired();
      throw httpError(401, body);
    }
    if (!res.ok) throw httpError(res.status, body);
    const parsed = AuthResponseSchema.safeParse(body);
    if (!parsed.success) throw new ApiError({ kind: "parse", message: "Unexpected refresh response" });
    await deps.tokens.set(parsed.data);
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
    const session: Session | null = useAuth ? await deps.tokens.get() : null;
    const usedToken = session?.accessToken ?? null;

    let res = await send(method, path, opts, usedToken);
    let body = await readBody(res);

    if (res.status === 401 && useAuth && isExpiredToken(body)) {
      const latest = await deps.tokens.get();
      // No session at all: nothing to refresh. Otherwise refresh unless another request already did.
      if (latest && latest.accessToken === usedToken) await refreshOnce();
      const next = await deps.tokens.get();
      if (next) {
        res = await send(method, path, opts, next.accessToken);
        body = await readBody(res);
      }
    }

    if (!res.ok) throw httpError(res.status, body);
    if (opts.schema) {
      const parsed = opts.schema.safeParse(body);
      if (!parsed.success) throw new ApiError({ kind: "parse", message: `Unexpected response from ${path}` });
      return parsed.data;
    }
    return body as T;
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

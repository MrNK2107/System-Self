import { randomUUID } from "node:crypto";

const VALID = /^[A-Za-z0-9-]{1,64}$/;

/** An incoming x-request-id is trusted only when short and plain; otherwise a fresh UUID. */
export function resolveRequestId(incoming: string | string[] | undefined): string {
  return typeof incoming === "string" && VALID.test(incoming) ? incoming : randomUUID();
}

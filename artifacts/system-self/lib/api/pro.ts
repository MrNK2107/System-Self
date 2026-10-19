// PRO gate on the client: any PRO-only request the server refuses answers 402 { code: "pro_required" }.
// Plain module (no React Native imports); the PRO lock component and describe* helpers build on it.
import { PRO_REQUIRED_CODE } from "@workspace/contracts";
import { ApiError } from "./client";

/** The placeholder paywall screen (P7 builds the real one). */
export const PAYWALL_ROUTE = "/paywall";
export const PRO_LOCK_LABEL = "PRO";

/** True for the server's PRO refusal: HTTP 402 with code `pro_required`. */
export function isProRequired(err: unknown): boolean {
  return err instanceof ApiError && err.kind === "http" && err.status === 402 && err.code === PRO_REQUIRED_CODE;
}

// THE SYSTEM's reply to a completed action, built from what the server actually applied (no estimates).
import type { Domain } from "./types";

export interface AppliedDelta {
  domain: Domain;
  actualDelta: number;
}

const signed = (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n) % 1 === 0 ? Math.abs(n) : Math.abs(n).toFixed(1)}`;

/** "+3 DISCIPLINE. Logged." — every non-zero applied change, largest first; "Logged." alone when nothing moved. */
export function appliedLine(results: readonly AppliedDelta[]): string {
  const moved = results
    .filter((r) => Math.abs(r.actualDelta) >= 0.05)
    .sort((a, b) => Math.abs(b.actualDelta) - Math.abs(a.actualDelta))
    .map((r) => `${signed(Math.round(r.actualDelta * 10) / 10)} ${r.domain}`);
  return moved.length > 0 ? `${moved.join(". ")}. Logged.` : "Logged.";
}

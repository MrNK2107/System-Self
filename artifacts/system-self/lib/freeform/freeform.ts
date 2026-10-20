// Free-form and voice logging (POST /api/logs/parse, POST /api/logs/voice): plain requests and helpers, no React
// Native imports. A parse or a voice upload only proposes entries; nothing is logged or scored until a proposal is
// confirmed, and a confirmed proposal is an ordinary log: queued in the outbox with the original text as freeText.
import {
  ParseResponseSchema,
  VoiceResponseSchema,
  type LogProposalDto,
  type VoiceResponse,
} from "@workspace/contracts";
import { VOICE_MAX_SECONDS, logChanges, streakMultiplier, summarizeLog, type RankedDomain } from "@workspace/engine";
import { ApiError, type ApiClient } from "../api/client";
import type { LogInput } from "../game/actions";
import type { FormValues } from "../game/log-form";

export { isProRequired } from "../api/pro";

/** Voice recordings stop on their own at this length (the server also checks, best-effort). */
export const VOICE_MAX_MS = VOICE_MAX_SECONDS * 1000;
/** A hold shorter than this is a tap, not a recording. */
export const VOICE_MIN_MS = 600;
/** What the recorder produces (m4a/AAC on iOS and Android). */
export const VOICE_CONTENT_TYPE = "audio/m4a";
/** Free-form text limit, the same as the server's. */
export const FREEFORM_MAX_CHARS = 1000;

/** Free text to proposals (at most 3). Read-only on the server. */
export async function parseText(api: ApiClient, text: string): Promise<LogProposalDto[]> {
  const res = await api.request("POST", "/api/logs/parse", { body: { text: text.trim() }, schema: ParseResponseSchema });
  return res.proposals;
}

/** A recording (m4a bytes) to its transcript and proposals. PRO only: a free user's call fails with 402 pro_required. */
export function sendVoice(api: ApiClient, audio: Blob | ArrayBuffer): Promise<VoiceResponse> {
  return api.request("POST", "/api/logs/voice", {
    binary: { body: audio, contentType: VOICE_CONTENT_TYPE },
    timeoutMs: 90_000,
    schema: VoiceResponseSchema,
  });
}

/** The outbox log for a confirmed proposal: the original text rides along as freeText (the server keeps at most 2000 characters). */
export function proposalToLogInput(p: LogProposalDto, text: string): LogInput {
  return { domain: p.domain, type: p.logType, data: p.data, note: text };
}

/** The structured form prefilled from a proposal (EDIT): scalar fields only. */
export function proposalToFormValues(p: LogProposalDto): FormValues {
  const out: FormValues = {};
  for (const [k, v] of Object.entries(p.data)) if (typeof v === "string" || typeof v === "number") out[k] = v;
  return out;
}

/** One line for a proposal card, for example `BODY // Sleep 6h · quality 3`. */
export function proposalSummary(p: LogProposalDto): string {
  return `${p.domain} // ${summarizeLog({ domain: p.domain, logType: p.logType, data: p.data })}`;
}

/** SYSTEM-voice copy for a failed parse or voice request. A 402 is not handled here: the screen shows the PRO lock. */
export function describeFreeformError(err: unknown): string {
  if (!(err instanceof ApiError)) return "The request failed. Retry.";
  if (err.kind === "network") return "No connection. Check your signal and retry.";
  if (err.kind !== "http") return "The system is unavailable. Retry shortly.";
  switch (err.code) {
    case "parse_limit":
      return "30 parses a day is the limit. Use the structured form.";
    case "voice_limit":
      return "10 voice logs a day is the limit. Type it or use the form.";
    case "ai_unavailable":
      return "Voice is unavailable right now. Type it instead.";
    case "audio_too_large":
      return "That recording is too large. Keep it under 2 minutes.";
    case "audio_too_long":
      return `Recordings are at most ${VOICE_MAX_SECONDS} seconds.`;
    case "empty_audio":
      return "Nothing was recorded. Hold the button and speak.";
    default:
      return err.status === 400 ? "Check the text and retry." : "The system is unavailable. Retry shortly.";
  }
}

/** One entry about to be logged, as the score preview needs it. */
export interface GainEntry {
  domain: RankedDomain;
  type: string;
  data: unknown;
  forbidden?: boolean;
}

/** A score change per domain, in the order the domains first appear. */
export interface Gain {
  label: string;
  delta: number;
}

const round1 = (n: number) => Math.round(Number(n.toPrecision(12)) * 10) / 10;

/**
 * The preview of what a set of logs scores, summed per domain with the streak bonus (an estimate: the server
 * applies the real delta). Domains whose changes cancel out are left out.
 */
export function logGains(entries: GainEntry[], streakOf: (domain: RankedDomain) => number): Gain[] {
  const sums = new Map<string, number>();
  for (const e of entries) {
    for (const c of logChanges(e.domain, e.type, e.data, !!e.forbidden)) {
      const delta = round1(c.bonus && c.delta > 0 ? c.delta * streakMultiplier(streakOf(e.domain)) : c.delta);
      sums.set(c.domain, round1((sums.get(c.domain) ?? 0) + delta));
    }
  }
  return [...sums].filter(([, d]) => d !== 0).map(([label, delta]) => ({ label, delta }));
}

/** A signed one-decimal score, with a true minus sign: "+2.5", "−1.0". */
export function signedScore(n: number): string {
  return n < 0 ? `−${Math.abs(n).toFixed(1)}` : `+${n.toFixed(1)}`;
}

/** The gains as one phrase: "+2.5 BODY", "+2.5 BODY · −2.0 DISCIPLINE". Empty when nothing changes. */
export function gainsText(gains: Gain[]): string {
  return gains.map((g) => `${signedScore(g.delta)} ${g.label}`).join(" · ");
}

/** THE SYSTEM's line after a log: "+2.5 BODY. Logged." (or "Logged." when the preview shows no change). */
export function loggedLine(gains: Gain[]): string {
  const text = gainsText(gains);
  return text ? `${text}. Logged.` : "Logged.";
}

/** A proposal's detail without the domain prefix, for a card that shows the domain as a chip: `Sleep 6h · quality 3`. */
export function proposalDetail(p: LogProposalDto): string {
  return summarizeLog({ domain: p.domain, logType: p.logType, data: p.data });
}

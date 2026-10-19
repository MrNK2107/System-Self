// The log modal's forms, as plain data: which fields a log type has, how typed text becomes the request
// data, and the local check before queueing. No React Native imports (tested under plain node).
import { LOG_TYPES, logChanges, streakMultiplier, type LogTypeInfo } from "@workspace/engine";
import { parseLogData } from "@workspace/contracts";
import type { Domain } from "./types";

export type FieldSpec =
  | { key: string; label: string; kind: "text"; max: number; optional?: boolean }
  | { key: string; label: string; kind: "number"; decimal?: boolean; suffix?: string }
  | { key: string; label: string; kind: "scale"; min: number; max: number; lowLabel: string; highLabel: string }
  | { key: string; label: string; kind: "choice"; options: { value: string; label: string }[] };

const intensity = (label: string): FieldSpec => ({ key: "intensity", label, kind: "scale", min: 1, max: 5, lowLabel: "light", highLabel: "all out" });
const quality = (label: string): FieldSpec => ({ key: "quality", label, kind: "scale", min: 1, max: 5, lowLabel: "poor", highLabel: "great" });
const minutes = (label = "MINUTES"): FieldSpec => ({ key: "minutes", label, kind: "number", suffix: "min" });
const amount: FieldSpec = { key: "amount", label: "AMOUNT", kind: "number", decimal: true };

/** The fields of each structured log type, in form order. Types without fields (home_session) have none. */
export const LOG_FIELDS: Record<string, FieldSpec[]> = {
  workout: [{ key: "kind", label: "KIND", kind: "text", max: 40 }, minutes(), intensity("INTENSITY")],
  sleep: [{ key: "hours", label: "HOURS", kind: "number", decimal: true, suffix: "h" }, quality("QUALITY")],
  meal: [{ key: "description", label: "WHAT", kind: "text", max: 120 }, quality("QUALITY")],
  focus: [
    minutes(),
    { key: "distraction", label: "DISTRACTION", kind: "scale", min: 1, max: 5, lowLabel: "locked in", highLabel: "scattered" },
    { key: "subject", label: "SUBJECT", kind: "text", max: 60 },
  ],
  reading: [{ key: "pages", label: "PAGES", kind: "number" }],
  learning: [minutes()],
  journal: [{ key: "words", label: "WORDS", kind: "number" }],
  expense: [amount, { key: "category", label: "CATEGORY", kind: "text", max: 40 }, { key: "note", label: "NOTE", kind: "text", max: 200, optional: true }],
  income: [amount, { key: "category", label: "CATEGORY", kind: "text", max: 40 }, { key: "note", label: "NOTE", kind: "text", max: 200, optional: true }],
  saving: [amount],
  investment: [amount],
  interaction: [
    {
      key: "kind",
      label: "KIND",
      kind: "choice",
      options: [
        { value: "meaningful", label: "Meaningful" },
        { value: "networking", label: "Networking" },
        { value: "casual", label: "Casual" },
      ],
    },
    { key: "note", label: "NOTE", kind: "text", max: 200, optional: true },
  ],
  outreach: [{ key: "count", label: "PEOPLE REACHED", kind: "number" }],
  speaking: [minutes()],
  deadline_met: [{ key: "label", label: "WHAT", kind: "text", max: 80 }],
  routine: [{ key: "label", label: "WHICH", kind: "text", max: 80 }],
};

export type FormValues = Record<string, string | number>;

export function typesFor(domain: Domain): LogTypeInfo[] {
  return LOG_TYPES[domain];
}

/** The type a domain opens on: the first listed. */
export function defaultTypeFor(domain: Domain): LogTypeInfo {
  return LOG_TYPES[domain][0]!;
}

/** Form values prefilled with a type's one-tap defaults. */
export function initialValues(domain: Domain, type: string): FormValues {
  const info = LOG_TYPES[domain].find((t) => t.type === type);
  const out: FormValues = {};
  for (const [k, v] of Object.entries(info?.defaults ?? {})) if (typeof v === "string" || typeof v === "number") out[k] = v;
  return out;
}

/** Typed form values to request data: numbers parsed (an unparsable one stays NaN for the check), blank optional fields left out. */
export function toLogData(type: string, values: FormValues): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of LOG_FIELDS[type] ?? []) {
    const raw = values[f.key];
    if (f.kind === "number") {
      data[f.key] = typeof raw === "number" ? raw : raw === undefined || String(raw).trim() === "" ? undefined : Number(String(raw).trim().replace(",", "."));
    } else if (f.kind === "scale") {
      data[f.key] = typeof raw === "number" ? raw : undefined;
    } else {
      const text = raw === undefined ? "" : String(raw).trim();
      if (text !== "" || !("optional" in f && f.optional)) data[f.key] = text;
    }
  }
  return data;
}

export type FormCheck = { ok: true; data: Record<string, unknown> } | { ok: false; message: string };

/** The same schema check the server runs, so a bad entry is caught before it is queued. */
export function checkLogForm(domain: Domain, type: string, values: FormValues): FormCheck {
  const data = toLogData(type, values);
  const r = parseLogData(domain, type, data);
  if (r.ok) return { ok: true, data: r.data };
  const first = r.issues[0];
  const field = first?.path.split(".")[1];
  const label = (LOG_FIELDS[type] ?? []).find((f) => f.key === field)?.label.toLowerCase();
  return { ok: false, message: label ? `Check ${label}: ${first!.message}` : (first?.message ?? "Check the entry.") };
}

/** The score a log is expected to give at this streak (preview only: the server applies the real one). */
export function previewDelta(domain: Domain, type: string, data: unknown, streak: number): number {
  const c = logChanges(domain, type, data, false)[0]!;
  const raw = c.bonus && c.delta > 0 ? c.delta * streakMultiplier(streak) : c.delta;
  return Math.round(raw * 10) / 10;
}

// Shared by the load seed and runner: the dedicated load database guard and the log payloads both send.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LOAD_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(LOAD_DIR, "../..");
/** Gitignored: access tokens of the seeded users, written by seed.ts and read by run.ts. */
export const TOKENS_FILE = path.join(LOAD_DIR, ".tokens.json");
/** Gitignored: one JSON file per run. */
export const RESULTS_DIR = path.join(LOAD_DIR, "results");

export const DEFAULT_LOAD_DATABASE_URL = "postgres://system_self:system_self@localhost:5432/system_self_load";
/** Databases the load harness must never touch, whatever the URL says. */
const PROTECTED_DATABASES = new Set(["system_self", "system_self_test", "postgres", "template0", "template1"]);

/** The load database URL, refusing anything that is not a dedicated `*load*` database (never dev or test). */
export function loadDatabaseUrl(): { url: string; name: string; adminUrl: string } {
  const url = process.env.LOAD_DATABASE_URL ?? DEFAULT_LOAD_DATABASE_URL;
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes("load") || PROTECTED_DATABASES.has(name)) {
    throw new Error(`Refusing database "${name}": the load harness only uses a dedicated *load* database (e.g. system_self_load)`);
  }
  const admin = new URL(url);
  admin.pathname = "/postgres";
  return { url, name, adminUrl: admin.toString() };
}

export type TokensFile = {
  createdAt: string;
  expiresAt: string;
  users: { id: string; username: string; token: string }[];
};

type LogPayload = { domain: string; logType: string; data: Record<string, unknown> };

/** Valid typed logs across all five domains (see LOG_DATA_SCHEMAS in @workspace/contracts). */
const LOGS: ((r: () => number) => LogPayload)[] = [
  (r) => ({ domain: "BODY", logType: "workout", data: { minutes: 20 + Math.floor(r() * 60), intensity: 1 + Math.floor(r() * 5) } }),
  (r) => ({ domain: "BODY", logType: "sleep", data: { hours: 5 + Math.floor(r() * 16) / 4, quality: 1 + Math.floor(r() * 5) } }),
  (r) => ({ domain: "BODY", logType: "meal", data: { quality: 1 + Math.floor(r() * 5) } }),
  (r) => ({ domain: "MIND", logType: "focus", data: { minutes: 15 + Math.floor(r() * 90), distraction: 1 + Math.floor(r() * 5) } }),
  (r) => ({ domain: "MIND", logType: "reading", data: { pages: 5 + Math.floor(r() * 40) } }),
  (r) => ({ domain: "MIND", logType: "journal", data: { words: 50 + Math.floor(r() * 500) } }),
  (r) => ({ domain: "WEALTH", logType: "saving", data: { amount: 100 + Math.floor(r() * 2000) } }),
  (r) => ({ domain: "WEALTH", logType: "expense", data: { amount: 50 + Math.floor(r() * 900), category: "food" } }),
  (r) => ({ domain: "SOCIAL", logType: "interaction", data: { kind: (["meaningful", "networking", "casual"] as const)[Math.floor(r() * 3)] } }),
  (r) => ({ domain: "SOCIAL", logType: "outreach", data: { count: 1 + Math.floor(r() * 5) } }),
  (r) => ({ domain: "DISCIPLINE", logType: "routine", data: { label: "Morning routine" } }),
  (r) => ({ domain: "DISCIPLINE", logType: "deadline_met", data: { label: "Shipped the report" } }),
];

export function randomLog(r: () => number = Math.random): LogPayload {
  return LOGS[Math.floor(r() * LOGS.length)]!(r);
}

/** Small deterministic PRNG (mulberry32), so a seed with the same arguments builds the same dataset shape. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

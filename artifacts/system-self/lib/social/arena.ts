// Arena honesty helpers: what the Rivals panel is allowed to claim. Plain functions, no React Native imports.
// Every gap here is read from the user's side (user minus other): positive means the user leads.
import { RANKED_DOMAIN_VALUES, type PastSelfResponse, type RankedDomain } from "@workspace/contracts";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The feed badge over the rivals list: LIVE only when at least one rival is a real player. */
export type RivalsFeed = "LIVE" | "SIMULATED" | null;

export function rivalsFeed(rivals: readonly { isGhost: boolean }[]): RivalsFeed {
  if (rivals.length === 0) return null;
  return rivals.every((r) => r.isGhost) ? "SIMULATED" : "LIVE";
}

/** What a gap means, not which way the number points: lead = success, trail = destructive. */
export type GapTone = "lead" | "trail" | "level";

export interface Gap {
  /** User minus other, one decimal. */
  value: number;
  tone: GapTone;
  /** Signed: `+1.2`, `-0.4`, `0.0`. */
  label: string;
}

export function signed(n: number): string {
  const r = round1(n);
  if (r === 0) return "0.0";
  return r > 0 ? `+${r.toFixed(1)}` : `-${Math.abs(r).toFixed(1)}`;
}

export function gapFromUser(user: number, other: number): Gap {
  const value = round1(user - other) || 0; // no -0
  return { value, tone: value > 0 ? "lead" : value < 0 ? "trail" : "level", label: signed(value) };
}

/** `You lead by 2.1.` / `You trail by 2.1.` / `Level.` */
export function gapLine(g: Gap): string {
  if (g.tone === "level") return "Level.";
  return `You ${g.tone === "lead" ? "lead" : "trail"} by ${Math.abs(g.value).toFixed(1)}.`;
}

/** THE SYSTEM's standing line over the ranked list. */
export function standingLine(position: number, total: number): string {
  if (total <= 1) return "No one to rank against yet.";
  if (position === 1) return `You lead. ${total - 1} behind you.`;
  if (position === total) return `Last of ${total}. Everyone is ahead.`;
  return `#${position} of ${total}. ${position - 1} ahead of you.`;
}

/** Mean of the five ranked domains for a partial record (missing reads as 0). */
function mean(scores: Partial<Record<RankedDomain, number>>): number {
  return RANKED_DOMAIN_VALUES.reduce((a, d) => a + (Number(scores[d]) || 0), 0) / RANKED_DOMAIN_VALUES.length;
}

/** Past You in one line: the average change across the five domains since the baseline. */
export function pastSelfGap(data: Pick<PastSelfResponse, "baseline" | "current" | "label">): Gap & { line: string } {
  const g = gapFromUser(mean(data.current), mean(data.baseline));
  // The server labels the baseline "DAY 1" or "SINCE {date}".
  const since = data.label.startsWith("SINCE ") ? `since ${data.label.slice(6)}` : `since ${data.label}`;
  const line =
    g.tone === "level" ? `No change ${since}.` : `${g.tone === "lead" ? "Up" : "Down"} ${Math.abs(g.value).toFixed(1)} on average ${since}.`;
  return { ...g, line };
}

/** The Shadow in one line: how far the user is from their shadow on average, and how many domains it holds. */
export function shadowGap(
  shadow: Partial<Record<RankedDomain, number>>,
  user: Partial<Record<RankedDomain, number>>,
): Gap & { domainsLost: number; line: string } {
  const g = gapFromUser(mean(user), mean(shadow));
  const domainsLost = RANKED_DOMAIN_VALUES.filter((d) => (Number(shadow[d]) || 0) > (Number(user[d]) || 0)).length;
  const line =
    g.tone === "trail"
      ? `Ahead of you by ${Math.abs(g.value).toFixed(1)}. Holds ${domainsLost} of 5 domains.`
      : g.tone === "lead"
        ? `You lead it by ${g.value.toFixed(1)}.`
        : "Level with you.";
  return { ...g, domainsLost, line };
}

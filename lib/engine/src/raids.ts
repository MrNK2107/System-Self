// Weekly clan raids (PRD 15): week windows, type rotation, grouping by clan rank, standings, dispatch text.
// Pure: the server supplies the metric values.

export const RAID_TYPES = ["domain", "discipline", "body", "score"] as const;
export type RaidType = (typeof RAID_TYPES)[number];

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** Largest raid group; smaller groups form when the clan count does not divide by it. */
export const RAID_GROUP_MAX = 4;

/**
 * The raid type of an ISO week: ISO week number mod 4 over domain, discipline, body, score. (Accepted: the
 * 52/53-week year boundary repeats a type, e.g. W53 and W01 are both discipline.)
 */
export function raidTypeForWeek(isoWeek: number): RaidType {
  return RAID_TYPES[((isoWeek % 4) + 4) % 4]!;
}

/**
 * Splits clans (by clan rank) into raid groups of 2-4 of the nearest rank: chunks of 4, and when the last chunk
 * would be a lone clan one clan moves over from the previous chunk (5 -> 3+2, 9 -> 4+3+2). One clan alone has no raid.
 */
export function groupClans(clans: readonly { id: string; clanRank: number }[]): string[][] {
  const ids = [...clans].sort((a, b) => a.clanRank - b.clanRank || (a.id < b.id ? -1 : 1)).map((c) => c.id);
  if (ids.length < 2) return [];
  const groups: string[][] = [];
  for (let i = 0; i < ids.length; i += RAID_GROUP_MAX) groups.push(ids.slice(i, i + RAID_GROUP_MAX));
  const last = groups[groups.length - 1]!;
  if (last.length === 1 && groups.length > 1) {
    const prev = groups[groups.length - 2]!;
    last.unshift(prev.pop()!);
  }
  return groups;
}

export interface RaidWeek {
  /** ISO week key `YYYY-Www`. */
  weekKey: string;
  week: number;
  /** Monday 00:00 UTC. */
  start: Date;
  /** Sunday 23:59 UTC: the close as announced and displayed. */
  end: Date;
  /** The next Monday 00:00 UTC: the exclusive end of the metrics span, when the raid resolves (no activity in Sunday's last minute is lost). */
  close: Date;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function weekFromMonday(mondayMs: number): RaidWeek {
  const thursday = new Date(mondayMs + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return {
    weekKey: `${pad(year, 4)}-W${pad(week)}`,
    week,
    start: new Date(mondayMs),
    end: new Date(mondayMs + 7 * DAY_MS - MINUTE_MS),
    close: new Date(mondayMs + 7 * DAY_MS),
  };
}

/** The raid week containing `at` (Monday 00:00 UTC to the next Monday 00:00 UTC). */
export function raidWeekOf(at: Date): RaidWeek {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dow = day.getUTCDay() || 7;
  return weekFromMonday(day.getTime() - (dow - 1) * DAY_MS);
}

/** The raid week of an ISO week key `YYYY-Www`. */
export function raidWindow(weekKey: string): RaidWeek {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) throw new Error(`Invalid week key: ${weekKey}`);
  const jan4 = Date.UTC(Number(m[1]), 0, 4); // always in ISO week 1
  const dow = new Date(jan4).getUTCDay() || 7;
  return weekFromMonday(jan4 - (dow - 1) * DAY_MS + (Number(m[2]) - 1) * 7 * DAY_MS);
}

export interface RaidStanding {
  clanId: string;
  value: number;
  /** Competition ranking: ties share a position (1, 2, 2, 4). */
  position: number;
  /** The unique leader. A tie for the lead has no winner. */
  winner: boolean;
}

/** Orders a group by metric value, highest first (ties by clan id for a stable order). */
export function raidStandings(entries: readonly { clanId: string; value: number }[]): RaidStanding[] {
  const sorted = [...entries].sort((a, b) => b.value - a.value || (a.clanId < b.clanId ? -1 : 1));
  const out: RaidStanding[] = sorted.map((e, i) => {
    const position = sorted.findIndex((x) => x.value === e.value) + 1;
    return { clanId: e.clanId, value: e.value, position, winner: false };
  });
  if (out.length > 0 && out.filter((s) => s.position === 1).length === 1) out[0]!.winner = true;
  return out;
}

/** The value the clan is compared with: the leader's for everyone else, the runner-up's for the leader. */
export function raidRivalValue(standings: readonly RaidStanding[], clanId: string): number {
  const me = standings.find((s) => s.clanId === clanId);
  const others = standings.filter((s) => s.clanId !== clanId);
  if (!me || others.length === 0) return me?.value ?? 0;
  return Math.max(...others.map((s) => s.value));
}

export const RAID_METRIC_LABEL: Record<RaidType, string> = {
  domain: "Mind logs",
  discipline: "Quest completion",
  body: "Body sessions",
  score: "Score movement",
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A metric value as shown: counts whole, completion in percent, score movement signed. */
export function formatRaidValue(type: RaidType, value: number, opts: { signed?: boolean } = {}): string {
  const signed = opts.signed ?? true;
  if (type === "discipline") return `${round1(value)}%`;
  if (type === "score") {
    const v = round1(value);
    return `${signed && v > 0 ? "+" : ""}${v}`;
  }
  return String(Math.round(value));
}

/** The dispatch for one clan, in the PRD format (the template; AI may rewrite it). */
export function raidDispatchText(a: {
  week: number;
  position: number;
  count: number;
  type: RaidType;
  value: number;
  rivalValue: number;
}): string {
  const gap = formatRaidValue(a.type, Math.abs(a.rivalValue - a.value), { signed: false });
  return `RAID RESULT — WEEK ${a.week}. Your clan ranked ${a.position} of ${a.count}. ${RAID_METRIC_LABEL[a.type]}: ${formatRaidValue(a.type, a.value)}. Rival clan: ${formatRaidValue(a.type, a.rivalValue)}. Gap: ${gap}.`;
}

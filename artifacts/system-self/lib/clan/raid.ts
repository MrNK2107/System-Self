// Weekly clan raid (GET /api/clans/raid): plain helpers and the request, no React Native imports. Everything is
// clan-level: standings and each clan's total; a member's own contribution and hidden score never reach the app.
import { RaidResponseSchema, type RaidSummary, type RaidType } from "@workspace/contracts";
import { RAID_METRIC_LABEL, formatRaidValue } from "@workspace/engine";
import type { ApiClient } from "../api/client";

export const RAID_TYPE_TITLE: Record<RaidType, string> = {
  domain: "DOMAIN RAID",
  discipline: "DISCIPLINE RAID",
  body: "BODY RAID",
  score: "SCORE RAID",
};

/** What the raid measures, in the SYSTEM voice. */
export const RAID_TYPE_RULE: Record<RaidType, string> = {
  domain: "Total MIND logs across the clan.",
  discipline: "Clan-wide quest completion rate.",
  body: "BODY logs (gym sessions included) across the clan.",
  score: "Net hidden score movement of the clan.",
};

export const raidTitle = (r: Pick<RaidSummary, "week" | "type">): string => `WEEK ${r.week} // ${RAID_TYPE_TITLE[r.type]}`;

export const raidMetricLabel = (type: RaidType): string => RAID_METRIC_LABEL[type];

/** A clan's total as shown: counts whole, completion in percent, score movement signed; `—` while hidden (a live score raid). */
export const raidValueLabel = (type: RaidType, value: number | null): string => (value === null ? "—" : formatRaidValue(type, value));

/** Time to the raid's close: `2d 5h left`, `5h 10m left`, `12m left`, or `closing` once it has passed. */
export function raidTimeLeft(endsAt: string, now: Date): string {
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (ms <= 0) return "closing";
  const mins = Math.floor(ms / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${Math.max(1, m)}m left`;
}

/** `Position 2 of 3.`, or once settled `Raid closed. Position 2 of 3.` */
export function raidPositionLine(r: RaidSummary): string {
  const line = `Position ${r.myPosition} of ${r.standings.length}.`;
  return r.resolved ? `Raid closed. ${line}` : line;
}

export async function fetchRaid(api: ApiClient): Promise<RaidSummary | null> {
  return (await api.request("GET", "/api/clans/raid", { schema: RaidResponseSchema })).raid;
}

import { and, asc, eq, gte } from "drizzle-orm";
import { seasons, type Db } from "@workspace/db";
import { SEASON_LINES, type SeasonKind } from "@workspace/engine";
import type { Season } from "@workspace/contracts";

export function toSeason(row: { id: string; kind: string; startsOn: string; endsOn: string }): Season {
  return {
    id: row.id,
    kind: row.kind as SeasonKind,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    line: SEASON_LINES[row.kind as SeasonKind] ?? "",
  };
}

/** The season running on `today` (local) and the one scheduled after it. At most one of them exists. */
export async function currentSeasons(
  db: Pick<Db, "select">,
  userId: string,
  today: string,
): Promise<{ active: Season | null; scheduled: Season | null }> {
  const rows = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.userId, userId), gte(seasons.endsOn, today)))
    .orderBy(asc(seasons.startsOn));
  const active = rows.find((r) => r.startsOn <= today);
  const scheduled = rows.find((r) => r.startsOn > today);
  return { active: active ? toSeason(active) : null, scheduled: scheduled ? toSeason(scheduled) : null };
}

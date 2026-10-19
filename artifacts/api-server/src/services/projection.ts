import { eq, inArray } from "drizzle-orm";
import { domainScores, profiles, shadowSelves, users, type Db } from "@workspace/db";
import { RANKED_DOMAINS, localDate, type Rank, type RankedDomain } from "@workspace/engine";
import type { PublicProfile } from "@workspace/contracts";
import { toShadowState } from "./scoring";
import { hiddenAndTrajectoryBatch } from "./state";

/**
 * How the viewer stands to the subject. This is the single place that decides what one player may see of
 * another: every social payload (search, following, rivals, clans, duo, raids) must be built with projectUser.
 */
export type Relation = "self" | "clanmate" | "duo" | "follower" | "rival" | "public";

export type IdentitySetting = "anonymous" | "semi-public" | "public";

export interface ProjectionSubject {
  userId: string;
  username: string;
  identitySetting: IdentitySetting;
  publicCodename: string;
  rank: Rank;
  /** Ranked-domain scores. The hidden score must never be part of a subject. */
  scores: Record<RankedDomain, number>;
  trajectory: "up" | "stable" | "down";
  shadowActive: boolean;
  clanTag?: string;
}

export interface ProjectOptions {
  /** The per-assignment codename (`RIVAL // WORD-N`) shown to the viewer for this rival. */
  rivalCodename?: string;
  /** The viewer has unlocked rival reveal (P7). False until then. */
  rivalReveal?: boolean;
}

/**
 * The only place that decides which fields of a user another viewer may see.
 *  - handle: username for self/clanmate/duo; for follower/public only when the subject is `public`;
 *    for a rival only when the subject is `public` and the viewer has rivalReveal, else the rival codename.
 *  - scores (the five ranked domains): self, clanmate, rival. A follower sees rank, trajectory, shadowActive only (PRD 16).
 *  - clanTag: never shown to a rival (PRD 14); hidden for `anonymous` subjects except to clanmates (and to self).
 * Never includes a user id or the hidden score.
 */
export function projectUser(subject: ProjectionSubject, relation: Relation, opts: ProjectOptions = {}): PublicProfile {
  const inside = relation === "self" || relation === "clanmate" || relation === "duo";
  const isPublic = subject.identitySetting === "public";

  let handle: string;
  if (inside) handle = subject.username;
  else if (relation === "rival") {
    handle = isPublic && opts.rivalReveal ? subject.username : (opts.rivalCodename ?? subject.publicCodename);
  } else handle = isPublic ? subject.username : subject.publicCodename;

  const profile: PublicProfile = {
    handle,
    isCodename: handle !== subject.username,
    rank: subject.rank,
    trajectory: subject.trajectory,
    shadowActive: subject.shadowActive,
  };
  if (relation === "self" || relation === "clanmate" || relation === "rival") profile.scores = { ...subject.scores };
  if (subject.clanTag && relation !== "rival" && (subject.identitySetting !== "anonymous" || relation === "clanmate" || relation === "self")) {
    profile.clanTag = subject.clanTag;
  }
  return profile;
}

/** A ghost rival (a server simulation, not a user) as a rival sees it: its codename and its five domain scores. */
export function projectGhost(ghost: {
  codename: string;
  rank: Rank;
  scores: Record<RankedDomain, number>;
  trajectory: "up" | "stable" | "down";
  shadowActive: boolean;
}): PublicProfile {
  return {
    handle: ghost.codename,
    isCodename: true,
    rank: ghost.rank,
    trajectory: ghost.trajectory,
    shadowActive: ghost.shadowActive,
    scores: Object.fromEntries(RANKED_DOMAINS.map((d) => [d, ghost.scores[d] ?? 0])) as Record<RankedDomain, number>,
  };
}

/**
 * Loads projection subjects in a constant number of queries (rank from the profile, scores from domain_scores, trajectory from the same
 * snapshots as the game state) for onboarded users, keyed by user id. Unknown or un-onboarded ids are absent.
 */
export async function loadProjectionSubjects(
  db: Pick<Db, "select">,
  userIds: readonly string[],
  now: Date,
): Promise<Map<string, ProjectionSubject>> {
  const out = new Map<string, ProjectionSubject>();
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      timezone: users.timezone,
      identitySetting: profiles.identitySetting,
      publicCodename: profiles.publicCodename,
      rank: profiles.rank,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(inArray(users.id, ids));
  const scoreRows = await db.select().from(domainScores).where(inArray(domainScores.userId, ids));
  const shadowRows = await db.select().from(shadowSelves).where(inArray(shadowSelves.userId, ids));
  const shadowActive = new Set(shadowRows.filter((r) => toShadowState(r) !== null).map((r) => r.userId));
  const scoresOf = new Map<string, Record<RankedDomain, number>>();
  for (const r of rows) scoresOf.set(r.userId, Object.fromEntries(RANKED_DOMAINS.map((d) => [d, 0])) as Record<RankedDomain, number>);
  for (const s of scoreRows) {
    const m = scoresOf.get(s.userId);
    if (m && s.domain in m) m[s.domain as RankedDomain] = s.score;
  }
  const trends = await hiddenAndTrajectoryBatch(
    db,
    rows.map((r) => ({ userId: r.userId, today: localDate(now, r.timezone), scoreMap: scoresOf.get(r.userId)! })),
  );
  for (const r of rows) {
    out.set(r.userId, {
      userId: r.userId,
      username: r.username,
      identitySetting: r.identitySetting as IdentitySetting,
      publicCodename: r.publicCodename,
      rank: r.rank as Rank,
      scores: scoresOf.get(r.userId)!,
      trajectory: trends.get(r.userId)!.trajectory,
      shadowActive: shadowActive.has(r.userId),
    });
  }
  return out;
}

import { and, eq, or, sql } from "drizzle-orm";
import { blocks, profiles, users, type Db } from "@workspace/db";
import { CODENAME_SINGLE_WORD_ATTEMPTS, generateUserCodename } from "@workspace/engine";
import type { IdentitySetting } from "./projection";

type Reader = Pick<Db, "select">;

/** A random public codename nobody holds yet. Callers still handle a unique violation (a concurrent onboarding). */
export async function freePublicCodename(db: Reader, rng: () => number = Math.random): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const candidate = generateUserCodename(rng, attempt);
    const [taken] = await db
      .select({ id: profiles.userId })
      .from(profiles)
      .where(eq(profiles.publicCodename, candidate))
      .limit(1);
    if (!taken) return candidate;
    // From CODENAME_SINGLE_WORD_ATTEMPTS the codename gets a second word, so a free one always turns up.
    if (attempt > CODENAME_SINGLE_WORD_ATTEMPTS * 20) throw new Error("no free public codename");
  }
}

export interface ResolvedPlayer {
  userId: string;
  identitySetting: IdentitySetting;
  /** The handle matched the viewer's own username or codename. */
  self: boolean;
}

/**
 * Resolves a handle typed or linked by `viewerId`. A public codename resolves for every identity (it is the
 * handle a stranger can ever see); a username resolves only for `public` players (or the viewer's own), so
 * a handle lookup is never an oracle for the username behind a codename. Only onboarded players resolve.
 */
export async function resolveHandle(db: Reader, viewerId: string, handle: string): Promise<ResolvedPlayer | null> {
  const key = handle.trim().toLowerCase();
  if (!key) return null;
  const rows = await db
    .select({ userId: users.id, identity: profiles.identitySetting, username: users.username, codename: profiles.publicCodename })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(or(sql`lower(${profiles.publicCodename}) = ${key}`, sql`lower(${users.username}) = ${key}`));
  const pick = (r: (typeof rows)[number]): ResolvedPlayer => ({
    userId: r.userId,
    identitySetting: r.identity as IdentitySetting,
    self: r.userId === viewerId,
  });
  const byCodename = rows.find((r) => r.codename.toLowerCase() === key);
  if (byCodename) return pick(byCodename);
  const byUsername = rows.find((r) => r.username.toLowerCase() === key && (r.identity === "public" || r.userId === viewerId));
  return byUsername ? pick(byUsername) : null;
}

/** A block exists between the two players in either direction. */
export async function isBlockedEitherWay(db: Reader, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
    .limit(1);
  return !!row;
}

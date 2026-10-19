// One-time removals of the old on-device game state (`@system_self:*`). Nothing shipped publicly, so nothing
// is imported. v1 removed the old game keys but kept the on-device rivals (simulated locally until P5); v2
// discards those rival keys too, now that rivals, challenges and transmissions live on the server.

export const LEGACY_PREFIX = "@system_self:";
export const LEGACY_CLEANUP_MARKER = "system_self.legacy_cleanup.v1";
export const LEGACY_CLEANUP_MARKER_V2 = "system_self.legacy_cleanup.v2";

/** The keys of the rivals the app simulated on the device before P5. */
export const LEGACY_RIVAL_KEYS: readonly string[] = [
  "@system_self:rivals",
  "@system_self:challenges",
  "@system_self:challenge_record",
  "@system_self:rival_taunts",
  "@system_self:rivals_last_drift",
];

export interface CleanupStorage {
  getAllKeys(): Promise<readonly string[]>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

/** Removes the old keys once per install (each step once). Returns how many were removed (0 when already done). */
export async function cleanupLegacyKeys(storage: CleanupStorage): Promise<number> {
  let removed = 0;
  if ((await storage.getItem(LEGACY_CLEANUP_MARKER)) === null) {
    const keys = (await storage.getAllKeys()).filter((k) => k.startsWith(LEGACY_PREFIX) && !LEGACY_RIVAL_KEYS.includes(k));
    if (keys.length > 0) await storage.multiRemove(keys);
    await storage.setItem(LEGACY_CLEANUP_MARKER, new Date().toISOString());
    removed += keys.length;
  }
  if ((await storage.getItem(LEGACY_CLEANUP_MARKER_V2)) === null) {
    const all = await storage.getAllKeys();
    const keys = LEGACY_RIVAL_KEYS.filter((k) => all.includes(k));
    if (keys.length > 0) await storage.multiRemove(keys);
    await storage.setItem(LEGACY_CLEANUP_MARKER_V2, new Date().toISOString());
    removed += keys.length;
  }
  return removed;
}

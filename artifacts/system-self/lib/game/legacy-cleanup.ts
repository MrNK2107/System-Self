// One-time removal of the old on-device game state (`@system_self:*`). Nothing shipped publicly, so nothing
// is imported. Rivals, challenges and taunts stay local until P5 and keep their keys.

export const LEGACY_PREFIX = "@system_self:";
export const LEGACY_CLEANUP_MARKER = "system_self.legacy_cleanup.v1";

/** Old keys that are still in use (rivals are simulated on the device until P5). */
export const KEPT_LEGACY_KEYS: readonly string[] = [
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

/** Removes the old keys once per install. Returns how many were removed (0 when already done). */
export async function cleanupLegacyKeys(storage: CleanupStorage): Promise<number> {
  if ((await storage.getItem(LEGACY_CLEANUP_MARKER)) !== null) return 0;
  const keys = (await storage.getAllKeys()).filter((k) => k.startsWith(LEGACY_PREFIX) && !KEPT_LEGACY_KEYS.includes(k));
  if (keys.length > 0) await storage.multiRemove(keys);
  await storage.setItem(LEGACY_CLEANUP_MARKER, new Date().toISOString());
  return keys.length;
}

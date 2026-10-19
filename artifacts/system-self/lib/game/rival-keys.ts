// AsyncStorage keys of the rivals simulated on the device until P5. They belong to the signed-in user:
// lib/api/user-scope.ts removes them on sign-out and on an account switch. No React Native imports.
export const RIVAL_KEYS = {
  RIVALS: "@system_self:rivals",
  CHALLENGES: "@system_self:challenges",
  CHALLENGE_RECORD: "@system_self:challenge_record",
  RIVAL_TAUNTS: "@system_self:rival_taunts",
  LAST_DRIFT: "@system_self:rivals_last_drift",
} as const;

export const RIVAL_STORAGE_KEYS: readonly string[] = Object.values(RIVAL_KEYS);

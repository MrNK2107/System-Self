// Pure notification helpers (no React Native imports, so they run under node --test).
import { addDays, daysBetween, localDate, localTimeToInstant } from "@workspace/engine";

/** Shown in-app before the OS permission dialog. */
export const PERMISSION_EXPLANATION = "THE SYSTEM speaks twice a day. Allow it.";
export const NIGHTLY_BODY = "The day is over. Your verdict is waiting.";
export const morningBody = (dayNumber: number): string => `SYSTEM // SELF — Day ${dayNumber}. Your briefing is ready.`;

/** Every scheduled id this app creates starts with this, so rescheduling never touches anything else. */
export const NOTIFICATION_ID_PREFIX = "system-self:reminder:";
/** Reminders are scheduled this many local days ahead and re-planned whenever the app opens. */
export const SCHEDULE_DAYS = 14;

export type ReminderKind = "morning" | "nightly";
export interface PlannedReminder {
  id: string;
  kind: ReminderKind;
  at: Date;
  body: string;
}

export const reminderId = (kind: ReminderKind, date: string): string => `${NOTIFICATION_ID_PREFIX}${kind}:${date}`;

export function parseClock(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

export interface PlanInput {
  now: Date;
  /** IANA timezone the briefing and debrief times are in (the account's). */
  timezone: string;
  morningTime: string;
  nightlyTime: string;
  morning: boolean;
  nightly: boolean;
  /** A known local date and its "Day n", from the game state; later days count on from it. */
  anchor: { date: string; dayNumber: number };
  days?: number;
}

/**
 * The reminders to schedule: one one-shot per enabled kind per local day for the next `days` days, only those still
 * in the future. One-shots (not a repeating trigger) because the morning copy carries the day number.
 */
export function planReminders(input: PlanInput): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  const first = localDate(input.now, input.timezone);
  const kinds: { kind: ReminderKind; on: boolean; time: string }[] = [
    { kind: "morning", on: input.morning, time: input.morningTime },
    { kind: "nightly", on: input.nightly, time: input.nightlyTime },
  ];
  for (let i = 0; i < (input.days ?? SCHEDULE_DAYS) + 1; i++) {
    const date = addDays(first, i);
    for (const k of kinds) {
      const clock = k.on ? parseClock(k.time) : null;
      if (!clock) continue;
      const at = localTimeToInstant(date, clock.hour, clock.minute, input.timezone);
      if (at.getTime() <= input.now.getTime()) continue;
      const body = k.kind === "morning" ? morningBody(input.anchor.dayNumber + daysBetween(input.anchor.date, date)) : NIGHTLY_BODY;
      out.push({ id: reminderId(k.kind, date), kind: k.kind, at, body });
    }
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  // The window is `days` local days of each kind from the first one still ahead.
  const perKind = input.days ?? SCHEDULE_DAYS;
  const seen: Record<ReminderKind, number> = { morning: 0, nightly: 0 };
  return out.filter((r) => ++seen[r.kind] <= perKind);
}

/** The scheduled ids that belong to this app's reminders (everything else is left alone). */
export function ourScheduledIds(scheduled: readonly { identifier: string }[]): string[] {
  return scheduled.map((s) => s.identifier).filter((id) => id.startsWith(NOTIFICATION_ID_PREFIX));
}

export type PermissionAction = "none" | "explain" | "settings";

/**
 * What to show for the notification permission. `explain` (the SYSTEM line, then the OS dialog) happens once, only
 * while the OS has not been asked and we have not prompted. After a denial the app never asks again by itself:
 * the settings screen offers a link to the OS settings.
 */
export function permissionAction(s: { status: "granted" | "denied" | "undetermined"; canAskAgain: boolean; alreadyPrompted: boolean }): PermissionAction {
  if (s.status === "granted") return "none";
  if (s.status === "denied") return "settings";
  return s.alreadyPrompted ? "none" : "explain";
}

export type PushRegistration =
  | { register: true; projectId: string }
  | { register: false; reason: "expo_go_android" | "no_project_id" | "not_a_device" | "unsupported_platform" };

/**
 * Whether to fetch an Expo push token. Expo Go on Android has no remote push (SDK 53+); on iOS Expo Go it needs an
 * EAS project id, which is also required elsewhere. Local reminders do not depend on any of this.
 */
export function pushRegistrationDecision(s: {
  executionEnvironment: string | null | undefined;
  platform: string;
  isDevice: boolean;
  projectId: string | null | undefined;
}): PushRegistration {
  if (s.platform !== "ios" && s.platform !== "android") return { register: false, reason: "unsupported_platform" };
  if (s.executionEnvironment === "storeClient" && s.platform === "android") return { register: false, reason: "expo_go_android" };
  if (!s.isDevice) return { register: false, reason: "not_a_device" };
  if (!s.projectId) return { register: false, reason: "no_project_id" };
  return { register: true, projectId: s.projectId };
}

/** Sign-out removes this device's token on the server: DELETE with the token in the JSON body, never in the URL. */
export function unregisterTokenRequest(token: string) {
  return { method: "DELETE" as const, path: "/api/push/tokens", opts: { body: { token } } };
}

// Smoke: clan peer ratings against a running API.
// Register + onboard -> GET ratings/mine shows an empty week with 5 remaining -> rating without a clan, and rating
// oneself, are refused (not_eligible / self_target) with SYSTEM copy. The 7-day clan tenure gate means a full
// rate-and-close cycle is covered by the server tests (routes/social-ratings.test.ts), not here.
// Registers 1 account.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/peer-ratings.ts
import assert from "node:assert/strict";
import { createApiClient, ApiError } from "../../lib/api/client";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import { describeRatingError, fetchRatings, remainingLine, submitRating } from "../../lib/clan/ratings";
import { newClientId } from "../../lib/game/actions";
import { submitOnboarding } from "../../lib/onboarding/actions";
import { buildOnboardingPayload, draftFromParams } from "../../lib/onboarding/payload";

const baseUrl = process.env.SMOKE_API_URL;
if (!baseUrl) {
  console.error("SMOKE_API_URL is required");
  process.exit(2);
}

const synced = { flushBeforeMutation: async () => true };
const step = (name: string, detail?: unknown) => console.log(`ok  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);

async function main() {
  const prefix = `sp${Date.now().toString(36).slice(-6)}`;
  let stored: Session | null = null;
  const tokens: TokenStore = { get: async () => stored, set: async (s) => void (stored = s) };
  const api = createApiClient({ fetch: (i, init) => fetch(i, init), tokens, baseUrl: baseUrl!, onSessionExpired: () => {} });
  const auth = createAuthActions({ api, tokens, handleSignIn: async () => {}, clearLocalData: async () => {} });
  const signUp = await auth.signUp({
    email: `smoke-ratings-${prefix}@example.com`,
    password: "correct horse battery",
    username: `${prefix}_r`,
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 4, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Build a disciplined life",
      weakness: "SOCIAL",
      identity: "anonymous",
    },
    "UTC",
  );
  assert.ok(draft);
  await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-onb-${prefix}`));
  step("register + onboard", { prefix });

  const week = await fetchRatings(api);
  assert.match(week.weekKey, /^\d{4}-W\d{2}$/);
  assert.deepEqual(week.given, []);
  assert.equal(week.remaining, 5);
  step("an empty week", { weekKey: week.weekKey, line: remainingLine(week.remaining) });

  const stranger = "00000000-0000-4000-8000-000000000000";
  const refused = await submitRating(api, synced, stranger, 4, newClientId("rate")).then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(refused instanceof ApiError && refused.status === 403 && refused.code === "not_eligible");
  step("rating outside a clan is refused", { line: describeRatingError(refused) });

  const self = await submitRating(api, synced, signUp.id, 4, newClientId("rate")).then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(self instanceof ApiError && self.status === 403 && self.code === "self_target");
  step("rating oneself is refused", { line: describeRatingError(self) });
  console.log("PASS peer-ratings");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Pure billing helpers (no React Native imports, so they run under node --test).
import {
  PRO_FALLBACK_PRICE_ANNUAL,
  PRO_FALLBACK_PRICE_MONTHLY,
  PRO_PRODUCT_ANNUAL,
  PRO_PRODUCT_MONTHLY,
  BillingStatusSchema,
  type BillingStatus,
} from "@workspace/contracts";
import type { ApiClient } from "../api/client";

/** GET /api/billing/status, per signed-in user. The server is authoritative; the webhook grants PRO. */
export const billingStatusKey = (userId: string | null) => ["billing-status", userId] as const;

export const fetchBillingStatus = (api: ApiClient): Promise<BillingStatus> =>
  api.request("GET", "/api/billing/status", { schema: BillingStatusSchema });

export const STORE_ONLY_LINE = "Purchases are available in the store build.";

/** Expo Go reports `storeClient`; the native purchases module is not in it. */
export function isExpoGo(executionEnvironment: string | null | undefined): boolean {
  return executionEnvironment === "storeClient";
}

/** The RevenueCat public SDK key for this platform, or null (missing/blank, or Expo Go) meaning purchases are unavailable. */
export function resolvePurchasesKey(opts: {
  executionEnvironment: string | null | undefined;
  platform: string;
  iosKey?: string;
  androidKey?: string;
}): string | null {
  if (isExpoGo(opts.executionEnvironment)) return null;
  const key = opts.platform === "ios" ? opts.iosKey : opts.platform === "android" ? opts.androidKey : undefined;
  return key && key.trim() ? key.trim() : null;
}

export type PlanId = "monthly" | "annual";
export interface Plan {
  id: PlanId;
  productId: string;
  label: string;
  price: string;
}

export const FALLBACK_PLANS: readonly Plan[] = [
  { id: "monthly", productId: PRO_PRODUCT_MONTHLY, label: "MONTHLY", price: PRO_FALLBACK_PRICE_MONTHLY },
  { id: "annual", productId: PRO_PRODUCT_ANNUAL, label: "ANNUAL", price: PRO_FALLBACK_PRICE_ANNUAL },
];

/** The offering package shape this app reads (a subset of react-native-purchases' PurchasesPackage). */
export interface PackageLike {
  product: { identifier: string; priceString: string };
}

/** Plans with live store prices where the offering has the matching product; the fallback price otherwise. */
export function plansFromPackages(packages: readonly PackageLike[]): Plan[] {
  return FALLBACK_PLANS.map((p) => {
    const hit = packages.find((k) => k.product.identifier === p.productId);
    return hit ? { ...p, price: hit.product.priceString } : { ...p };
  });
}

/** What PRO adds (Global Constraints), in SYSTEM voice. Nothing here changes score, rank or matching fairness. */
export const PRO_FEATURES: readonly string[] = [
  "Bonus quests. Up to three extra a day. No score effect.",
  "The full SYSTEM. It remembers your logs and quotes your words.",
  "Adaptive interface. All four states.",
  "Named challenges.",
  "Rival identity reveal.",
  "Clan creation.",
  "Full history. 365 days.",
  "Retroactive logging beyond 48 hours.",
  "Rank Freeze.",
  "Voice logging.",
  "Shame Mode.",
  "Priority rival matching.",
  "Custom domains beyond three.",
];

/** Gaps between status checks after a purchase or restore: 1+2+3+5+8+10 = 29 s, then give up (the webhook may be late). */
export const POLL_DELAYS_MS = [1000, 2000, 3000, 5000, 8000, 10000] as const;

/**
 * Polls the server until it reports pro; "pending" when the schedule runs out; "stopped" as soon as `shouldStop`
 * returns true (checked before every fetch and after every sleep). Fetch errors count as "not yet".
 */
export async function pollUntilPro(
  fetchStatus: () => Promise<BillingStatus>,
  sleep: (ms: number) => Promise<void>,
  delays: readonly number[] = POLL_DELAYS_MS,
  shouldStop: () => boolean = () => false,
): Promise<"pro" | "pending" | "stopped"> {
  for (let i = 0; i <= delays.length; i++) {
    if (shouldStop()) return "stopped";
    try {
      if ((await fetchStatus()).tier === "pro") return "pro";
    } catch {
      // keep polling
    }
    if (i < delays.length) await sleep(delays[i]!);
  }
  return shouldStop() ? "stopped" : "pending";
}

/**
 * PRO as the client should treat a status: tier `pro` and not past `expiresAt` (a cached status can outlive the
 * period it describes). Anything unknown is free.
 */
export function isProStatus(status: BillingStatus | null | undefined, nowMs: number = Date.now()): boolean {
  if (status?.tier !== "pro") return false;
  return status.expiresAt === null || Date.parse(status.expiresAt) > nowMs;
}

/** Where the store lets the user manage or cancel a subscription; null where there is no store (web). */
export const MANAGE_SUBSCRIPTION_URLS = {
  ios: "https://apps.apple.com/account/subscriptions",
  android: "https://play.google.com/store/account/subscriptions",
} as const;

export function manageSubscriptionUrl(platform: string): string | null {
  return platform === "ios" ? MANAGE_SUBSCRIPTION_URLS.ios : platform === "android" ? MANAGE_SUBSCRIPTION_URLS.android : null;
}

const storeSettings = (platform: string) =>
  platform === "ios" ? "App Store account settings" : platform === "android" ? "Google Play account settings" : "App Store or Google Play account settings";

/** The store's required auto-renewal disclosure, in plain language. */
export function autoRenewDisclosure(platform: string): string {
  return `The subscription renews automatically unless it is cancelled at least 24 hours before the current period ends. Manage or cancel it in your ${storeSettings(platform)}.`;
}

export const MANAGE_SUBSCRIPTION_LABEL = "MANAGE SUBSCRIPTION";

/** Shown before account deletion: the store bills independently of this account. */
export const DELETE_KEEPS_SUBSCRIPTION_LINE =
  "Deleting your account does not cancel a store subscription. Cancel it in your App Store or Google Play account settings, or it keeps renewing.";

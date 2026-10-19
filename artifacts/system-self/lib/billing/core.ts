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

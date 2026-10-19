// RevenueCat wrapper. The native module is required lazily inside functions, never at import time, so Expo Go (which
// does not bundle it) and builds without keys never touch it. The server stays authoritative: after a purchase or
// restore the caller invalidates the billing status query and the webhook grants PRO.
import Constants from "expo-constants";
import { Platform } from "react-native";
import { plansFromPackages, resolvePurchasesKey, type PackageLike, type Plan, type PlanId } from "./billing/core";

type Native = typeof import("react-native-purchases");
type PurchasesApi = Native["default"];

export type PurchasesAvailability = { available: false } | { available: true; key: string };

export function purchasesAvailability(): PurchasesAvailability {
  const key = resolvePurchasesKey({
    executionEnvironment: Constants.executionEnvironment,
    platform: Platform.OS,
    iosKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
    androidKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
  });
  return key ? { available: true, key } : { available: false };
}

let configuredFor: string | null = null;

function loadNative(): PurchasesApi | null {
  try {
    // Guarded lazy require: a missing native module (Expo Go, web) must never crash the app.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-purchases") as Native;
    return mod.default ?? (mod as unknown as PurchasesApi);
  } catch {
    return null;
  }
}

/** Configures the SDK for this user (RevenueCat app_user_id = our user id). `{ available: false }` when it cannot run. */
export async function initPurchases(userId: string): Promise<{ available: false } | { available: true; sdk: PurchasesApi }> {
  const avail = purchasesAvailability();
  if (!avail.available) return { available: false };
  const sdk = loadNative();
  if (!sdk) return { available: false };
  try {
    if (configuredFor === null) {
      sdk.configure({ apiKey: avail.key, appUserID: userId });
    } else if (configuredFor !== userId) {
      await sdk.logIn(userId);
    }
    configuredFor = userId;
    return { available: true, sdk };
  } catch {
    return { available: false };
  }
}

export interface Offerings {
  plans: Plan[];
  packages: Partial<Record<PlanId, unknown>>;
}

export async function loadOfferings(userId: string): Promise<{ available: false } | ({ available: true } & Offerings)> {
  const init = await initPurchases(userId);
  if (!init.available) return { available: false };
  let pkgs: PackageLike[] = [];
  try {
    const offerings = await init.sdk.getOfferings();
    pkgs = (offerings.current?.availablePackages ?? []) as unknown as PackageLike[];
  } catch {
    pkgs = [];
  }
  const plans = plansFromPackages(pkgs);
  const packages: Offerings["packages"] = {};
  for (const plan of plans) packages[plan.id] = pkgs.find((k) => k.product.identifier === plan.productId);
  return { available: true, plans, packages };
}

export type PurchaseResult = "purchased" | "cancelled" | "failed";

export async function purchasePlan(userId: string, pkg: unknown): Promise<PurchaseResult> {
  const init = await initPurchases(userId);
  if (!init.available || !pkg) return "failed";
  try {
    await init.sdk.purchasePackage(pkg as Parameters<PurchasesApi["purchasePackage"]>[0]);
    return "purchased";
  } catch (e) {
    return (e as { userCancelled?: boolean })?.userCancelled ? "cancelled" : "failed";
  }
}

export async function restorePurchases(userId: string): Promise<"restored" | "failed"> {
  const init = await initPurchases(userId);
  if (!init.available) return "failed";
  try {
    await init.sdk.restorePurchases();
    return "restored";
  } catch {
    return "failed";
  }
}

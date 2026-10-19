import { z } from "zod";

export const EntitlementTierSchema = z.enum(["free", "pro"]);
export type EntitlementTier = z.infer<typeof EntitlementTierSchema>;

/** POST /api/admin/users/:id/entitlement. `expiresAt` null or absent means no expiry. */
export const EntitlementGrantRequestSchema = z.object({
  tier: EntitlementTierSchema,
  expiresAt: z.string().datetime({ offset: true }).nullish(),
});
export type EntitlementGrantRequest = z.infer<typeof EntitlementGrantRequestSchema>;

export const EntitlementSchema = z.object({
  tier: EntitlementTierSchema,
  source: z.enum(["admin", "revenuecat"]),
  expiresAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type EntitlementDto = z.infer<typeof EntitlementSchema>;

/** The 402 body of any PRO-gated route. The app maps `code` to a PRO lock. */
export const PRO_REQUIRED_CODE = "pro_required";
export const ProRequiredSchema = z.object({ error: z.string(), code: z.literal(PRO_REQUIRED_CODE) });
export type ProRequired = z.infer<typeof ProRequiredSchema>;

/** GET /api/billing/status: the caller's effective tier (an expired pro row reads as free). `source` is null with no row. */
export const BillingStatusSchema = z.object({
  tier: EntitlementTierSchema,
  expiresAt: z.string().nullable(),
  source: z.enum(["admin", "revenuecat"]).nullable(),
});
export type BillingStatus = z.infer<typeof BillingStatusSchema>;

/** Product ids and the entitlement id RevenueCat uses; fallback display prices when offerings cannot load. */
export const PRO_ENTITLEMENT_ID = "pro";
export const PRO_PRODUCT_MONTHLY = "system_self_pro_monthly";
export const PRO_PRODUCT_ANNUAL = "system_self_pro_annual";
export const PRO_FALLBACK_PRICE_MONTHLY = "₹499 / month";
export const PRO_FALLBACK_PRICE_ANNUAL = "₹3,999 / year";

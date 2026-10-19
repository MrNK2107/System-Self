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

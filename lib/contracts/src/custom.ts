import { z } from "zod";
import { UserLogClientIdSchema } from "./game";

/** CUSTOM domains (PRD 8): user-defined stats with their own 0-100 score, never part of rank. */
export const CUSTOM_NAME_MAX = 24;
export const CUSTOM_UNIT_MAX = 12;
export const CUSTOM_LOG_LABEL_MAX = 40;
export const CUSTOM_NOTE_MAX = 200;
/** Returned with the 409 of a PRO user at the cap. */
export const CUSTOM_LIMIT_CODE = "custom_limit";

const clientId = z.string().min(1).max(200).optional();
const num = z.number().finite().min(-1e9).max(1e9);

const CustomFields = {
  name: z.string().trim().min(1).max(CUSTOM_NAME_MAX),
  unit: z.string().trim().max(CUSTOM_UNIT_MAX),
  logLabel: z.string().trim().min(1).max(CUSTOM_LOG_LABEL_MAX),
  baseline: num,
  target: num,
  isPublic: z.boolean(),
};

/** POST /api/custom-domains */
export const CustomDomainCreateSchema = z.object({
  clientId,
  name: CustomFields.name,
  unit: CustomFields.unit.default(""),
  logLabel: CustomFields.logLabel.default("Log"),
  baseline: CustomFields.baseline,
  target: CustomFields.target,
  isPublic: CustomFields.isPublic.default(false),
});
export type CustomDomainCreate = z.infer<typeof CustomDomainCreateSchema>;

/** PATCH /api/custom-domains/:id: any of the fields, at least one. */
export const CustomDomainUpdateSchema = z
  .object({
    clientId,
    name: CustomFields.name.optional(),
    unit: CustomFields.unit.optional(),
    logLabel: CustomFields.logLabel.optional(),
    baseline: CustomFields.baseline.optional(),
    target: CustomFields.target.optional(),
    isPublic: CustomFields.isPublic.optional(),
  })
  .refine(({ clientId: _c, ...rest }) => Object.values(rest).some((v) => v !== undefined), "Nothing to update");
export type CustomDomainUpdate = z.infer<typeof CustomDomainUpdateSchema>;

/** POST /api/custom-domains/:id/logs */
export const CustomLogRequestSchema = z.object({
  clientId: UserLogClientIdSchema,
  value: num,
  note: z.string().trim().max(CUSTOM_NOTE_MAX).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
});
export type CustomLogRequest = z.infer<typeof CustomLogRequestSchema>;

export const CustomDomainSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  unit: z.string(),
  logLabel: z.string(),
  baseline: z.number(),
  target: z.number(),
  isPublic: z.boolean(),
  /** Archived: history kept, no new entries. Only reachable by id. */
  archived: z.boolean(),
  score: z.number(),
  /** The current streak (0 once it has lapsed). */
  streak: z.number().int(),
  lastLogDate: z.string().nullable(),
  /** The most recent value logged (by when it happened), null before the first log. */
  latestValue: z.number().nullable(),
});
export type CustomDomainDto = z.infer<typeof CustomDomainSchema>;

export const CustomLogSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string(),
  value: z.number(),
  note: z.string().nullable(),
  occurredAt: z.string(),
  localDate: z.string(),
});
export type CustomLogDto = z.infer<typeof CustomLogSchema>;

/** GET /api/custom-domains: the active domains and the caller's cap. */
export const CustomDomainListSchema = z.object({
  items: z.array(CustomDomainSchema),
  /** 3 for free, 20 for PRO. */
  limit: z.number().int(),
  isPro: z.boolean(),
});
export type CustomDomainList = z.infer<typeof CustomDomainListSchema>;

/** GET /api/custom-domains/:id and the POST / PATCH answers. `logs` is the newest 30 (empty on POST / PATCH). */
export const CustomDomainDetailSchema = z.object({ domain: CustomDomainSchema, logs: z.array(CustomLogSchema) });
export type CustomDomainDetail = z.infer<typeof CustomDomainDetailSchema>;

/** POST /api/custom-domains/:id/logs */
export const CustomLogResponseSchema = z.object({ score: z.number(), streak: z.number().int() });
export type CustomLogResponse = z.infer<typeof CustomLogResponseSchema>;

/** A public custom domain as another player sees it: name and score only. */
export const PublicCustomDomainSchema = z.object({ name: z.string(), score: z.number() });
export type PublicCustomDomain = z.infer<typeof PublicCustomDomainSchema>;

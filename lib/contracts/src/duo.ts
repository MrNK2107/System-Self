import { z } from "zod";
import { PublicProfileSchema, SocialHandleSchema } from "./social";

/** Party of Two (PRD 16, design 3.4): one partner, check-ins, no score effect, no shared rank. */
export const DUO_CHECKIN_KINDS = ["going_now", "checked_in", "done"] as const;
export const DuoCheckinKindSchema = z.enum(DUO_CHECKIN_KINDS);
export type DuoCheckinKind = z.infer<typeof DuoCheckinKindSchema>;
/** A nudge (`going_now`): at most this many per sender per local day. */
export const DUO_NUDGES_PER_DAY = 3;
/** Check-ins listed to the pair. */
export const DUO_CHECKIN_DAYS = 7;
/** Open invites one player may have out at a time. */
export const DUO_MAX_OUTGOING_INVITES = 5;

const clientId = z.string().min(1).max(200).optional();

/** POST /api/duo/invite. `username` is a handle the inviter can resolve (a public username or any codename). */
export const DuoInviteRequestSchema = z.object({ username: SocialHandleSchema, clientId });
export type DuoInviteRequest = z.infer<typeof DuoInviteRequestSchema>;

/** POST /api/duo/invites/:id/accept | decline, POST /api/duo/leave */
export const DuoActionRequestSchema = z.object({ clientId });

/** POST /api/duo/checkin */
export const DuoCheckinRequestSchema = z.object({ kind: DuoCheckinKindSchema, clientId });
export type DuoCheckinRequest = z.infer<typeof DuoCheckinRequestSchema>;

export const DuoCheckinSchema = z.object({
  id: z.string().uuid(),
  kind: DuoCheckinKindSchema,
  /** The viewer sent it (else the partner did). */
  fromMe: z.boolean(),
  createdAt: z.string(),
});
export type DuoCheckinItem = z.infer<typeof DuoCheckinSchema>;

/** An open invite as the viewer sees the other side (a handle only, projected as for a stranger). */
export const DuoInviteSchema = z.object({
  id: z.string().uuid(),
  direction: z.enum(["incoming", "outgoing"]),
  handle: z.string(),
  isCodename: z.boolean(),
  createdAt: z.string(),
});
export type DuoInviteItem = z.infer<typeof DuoInviteSchema>;

/** GET /api/duo. `partner` is the duo projection (the partner's username, rank, trajectory; never scores). */
export const DuoResponseSchema = z.object({
  partner: PublicProfileSchema.nullable(),
  checkins: z.array(DuoCheckinSchema),
  pendingInvites: z.array(DuoInviteSchema),
});
export type DuoResponse = z.infer<typeof DuoResponseSchema>;

export const DuoCheckinResponseSchema = DuoCheckinSchema;
export const DuoInviteResponseSchema = DuoInviteSchema;

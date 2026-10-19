import { Router, type IRouter, type Request, type Response } from "express";
import { asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { users, type Db } from "@workspace/db";
import { EntitlementGrantRequestSchema, type EntitlementDto } from "@workspace/contracts";
import { grantEntitlement } from "../services/entitlements";
import { requireAdmin } from "../middlewares/auth";
import { toPublicUser } from "../lib/auth/public-user";
import { buildExport } from "../services/export";
import { deleteAccount } from "../services/account";
import { withIdempotency } from "../services/idempotency";
import { sendExport } from "./account";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});
const roleBodySchema = z.object({ role: z.enum(["user", "admin"]) });
const idParamSchema = z.string().uuid();
const deleteBodySchema = z.object({ confirm: z.string().min(1).max(64) });

/** The support audit line: who did what to whom and how it ended. Never the request body or the exported data. */
function auditOnFinish(req: Request, res: Response, action: "user_export" | "user_delete", targetId: string): void {
  res.on("finish", () => {
    req.log.info({ event: "admin_action", action, actorId: req.user!.id, targetId, status: res.statusCode }, "admin_action");
  });
}

// Callers must mount this behind requireAuth.
export function adminRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();
  router.use("/admin", requireAdmin);

  router.get("/admin/users", async (req, res) => {
    const { limit, cursor } = listQuerySchema.parse(req.query);
    const rows = await db
      .select()
      .from(users)
      .where(cursor ? gt(users.id, cursor) : undefined)
      .orderBy(asc(users.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    res.json({ items: page.map(toPublicUser), nextCursor: hasMore ? page[page.length - 1]!.id : null });
  });

  router.patch("/admin/users/:id/role", async (req, res) => {
    const id = idParamSchema.parse(req.params.id);
    const { role } = roleBodySchema.parse(req.body);
    const result = await db.transaction(async (tx) => {
      // Lock every admin row so two concurrent demotions cannot both pass the "another admin exists" check.
      const admins = await tx.select({ id: users.id }).from(users).where(eq(users.role, "admin")).for("update");
      if (role === "user" && admins.length <= 1 && admins.some((a) => a.id === id)) return "last_admin" as const;
      const [row] = await tx.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id)).returning();
      return row;
    });
    if (result === "last_admin") {
      res.status(409).json({ error: "Cannot demote the last admin", code: "last_admin" });
      return;
    }
    const updated = result;
    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    req.log.info({ event: "admin_role_change", actorId: req.user!.id, targetId: id, role }, "admin_action");
    res.json({ user: toPublicUser(updated) });
  });

  /** P5 stub of the paywall: an admin sets a user's tier (P7 replaces the source with RevenueCat). */
  router.post("/admin/users/:id/entitlement", async (req, res) => {
    const id = idParamSchema.parse(req.params.id);
    const { tier, expiresAt } = EntitlementGrantRequestSchema.parse(req.body ?? {});
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const row = await grantEntitlement(db, id, tier, expiresAt ? new Date(expiresAt) : null, clock());
    req.log.info({ event: "admin_entitlement", actorId: req.user!.id, targetId: id, tier }, "admin_action");
    const dto: EntitlementDto = {
      tier: row.tier as EntitlementDto["tier"],
      source: row.source as EntitlementDto["source"],
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      updatedAt: row.updatedAt.toISOString(),
    };
    res.json(dto);
  });

  /** Support: a user's data export (a data request by email), the same document and attachment as GET /account/export. */
  router.get("/admin/users/:id/export", async (req, res) => {
    const id = idParamSchema.parse(req.params.id);
    auditOnFinish(req, res, "user_export", id);
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const at = clock();
    const { json, redacted } = await buildExport(db, id, at);
    if (redacted > 0) req.log.warn({ event: "export_redacted", redacted }, "export_safety_net");
    sendExport(res, json, at);
  });

  /**
   * Support: deletes a user's account exactly as DELETE /auth/account does (deleteAccount under the user's lock), for a
   * deletion request from someone who cannot sign in. `confirm` must be the target's username. A retry with the same
   * Idempotency-Key replays the stored result; without one, a second call finds the user gone (404).
   */
  router.post("/admin/users/:id/delete", async (req, res) => {
    const id = idParamSchema.parse(req.params.id);
    auditOnFinish(req, res, "user_delete", id);
    const { confirm } = deleteBodySchema.parse(req.body ?? {});
    if (id === req.user!.id) {
      res.status(409).json({ error: "Admins cannot delete their own account here", code: "self_delete" });
      return;
    }
    await withIdempotency(db, req, res, `POST /admin/users/${id}/delete`, async (tx) => {
      // withIdempotency holds the admin's lock; take the target's too, as the user's own delete does.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
      const [target] = await tx.select({ username: users.username }).from(users).where(eq(users.id, id)).limit(1);
      if (!target) return { status: 404, body: { error: "User not found" } };
      if (target.username !== confirm.trim()) {
        return { status: 409, body: { error: "confirm must be the user's username", code: "confirm_mismatch" } };
      }
      await deleteAccount(tx, id);
      req.log.info({ event: "account_deleted", userId: id, by: "admin" }, "auth_event");
      return { status: 200, body: { deleted: true, id } };
    });
  });

  return router;
}

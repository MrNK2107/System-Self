import { Router, type IRouter } from "express";
import { asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { users, type Db } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";
import { toPublicUser } from "../lib/auth/public-user";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});
const roleBodySchema = z.object({ role: z.enum(["user", "admin"]) });
const idParamSchema = z.string().uuid();

// Callers must mount this behind requireAuth.
export function adminRoutes(db: Db): IRouter {
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
    const [updated] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    req.log.info({ event: "admin_role_change", actorId: req.user!.id, targetId: id, role }, "admin_action");
    res.json({ user: toPublicUser(updated) });
  });

  return router;
}

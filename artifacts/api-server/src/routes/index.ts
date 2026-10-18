import { Router, type IRouter } from "express";
import type { Db } from "@workspace/db";
import type { Mailer } from "../lib/mailer";
import { createRequireAuth } from "../middlewares/auth";
import { adminRoutes } from "./admin";
import { authRoutes } from "./auth";
import { healthRoutes } from "./health";
import { historyRoutes } from "./history";
import { systemRoutes } from "./system";

export function createRouter(deps: { db: Db | null; mailer: Mailer }): IRouter {
  const { db, mailer } = deps;
  const router: IRouter = Router();
  const requireAuth = createRequireAuth(db);

  // Public: healthz, readyz, and the public /auth endpoints (the auth router guards its own private ones).
  router.use(healthRoutes(db));
  router.use(authRoutes({ db, mailer, requireAuth }));

  // Everything below requires a valid user.
  router.use(requireAuth);
  router.use(systemRoutes(db));
  router.use(historyRoutes(db));
  if (db) router.use(adminRoutes(db));
  return router;
}

export default createRouter;

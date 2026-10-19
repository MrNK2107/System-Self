import { Router, type IRouter } from "express";
import type { Db } from "@workspace/db";
import type { AiDeps } from "../lib/ai";
import type { Mailer } from "../lib/mailer";
import { createRequireAuth } from "../middlewares/auth";
import { adherenceRoutes } from "./adherence";
import { adminRoutes } from "./admin";
import { authRoutes } from "./auth";
import { chainsRoutes } from "./chains";
import { comebackRoutes } from "./comeback";
import { debriefRoutes } from "./debrief";
import { gymRoutes } from "./gym";
import { healthRoutes } from "./health";
import { historyRoutes } from "./history";
import { logsRoutes } from "./logs";
import { messagesRoutes } from "./messages";
import { noticesRoutes } from "./notices";
import { onboardingRoutes } from "./onboarding";
import { profileRoutes } from "./profile";
import { questsRoutes } from "./quests";
import { stateRoutes } from "./state";
import { systemRoutes } from "./system";

export function createRouter(deps: { db: Db | null; mailer: Mailer; ai?: AiDeps; now?: () => Date }): IRouter {
  const { db, mailer } = deps;
  const ai = deps.ai ?? {};
  const router: IRouter = Router();
  const requireAuth = createRequireAuth(db);

  // Public: healthz, readyz, and the public /auth endpoints (the auth router guards its own private ones).
  router.use(healthRoutes(db));
  router.use(authRoutes({ db, mailer, requireAuth }));

  // Private surfaces. requireAuth is mounted per prefix so unknown /api paths fall through to 404.
  router.use(["/system", "/admin", "/onboarding", "/profile", "/state", "/logs", "/quests", "/chains", "/notices", "/messages", "/debrief", "/recap", "/gym", "/adherence", "/comeback"], requireAuth);
  router.use(systemRoutes(db));
  router.use(historyRoutes(db, ai));
  if (db) {
    router.use(adminRoutes(db));
    router.use(onboardingRoutes(db));
    router.use(profileRoutes(db));
    router.use(stateRoutes(db));
    router.use(logsRoutes(db, deps.now));
    router.use(questsRoutes(db, ai));
    router.use(chainsRoutes(db));
    router.use(noticesRoutes(db));
    router.use(messagesRoutes(db, ai));
    router.use(debriefRoutes(db, ai));
    router.use(gymRoutes(db, deps.now));
    router.use(adherenceRoutes(db));
    router.use(comebackRoutes(db, deps.now));
  }
  return router;
}

export default createRouter;

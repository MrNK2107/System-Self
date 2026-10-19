import { Router, type IRouter } from "express";
import type { Db } from "@workspace/db";
import type { AiDeps } from "../lib/ai";
import type { Mailer } from "../lib/mailer";
import { createRequireAuth } from "../middlewares/auth";
import { adherenceRoutes } from "./adherence";
import { adminRoutes } from "./admin";
import { adminMetricsRoutes } from "./admin-metrics";
import { authRoutes } from "./auth";
import { chainsRoutes } from "./chains";
import { challengesRoutes } from "./challenges";
import { clansRoutes } from "./clans";
import { socialRatingsRoutes } from "./social-ratings";
import { comebackRoutes } from "./comeback";
import { customDomainsRoutes } from "./custom-domains";
import { debriefRoutes } from "./debrief";
import { duoRoutes } from "./duo";
import { financeRoutes } from "./finance";
import { gymRoutes } from "./gym";
import { healthRoutes } from "./health";
import { historyRoutes } from "./history";
import { logsRoutes } from "./logs";
import { messagesRoutes } from "./messages";
import { noticesRoutes } from "./notices";
import { onboardingRoutes } from "./onboarding";
import { profileRoutes } from "./profile";
import { progressRoutes } from "./progress";
import { rivalsRoutes } from "./rivals";
import { questsRoutes } from "./quests";
import { seasonsRoutes } from "./seasons";
import { socialRoutes } from "./social";
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
  router.use(["/system", "/admin", "/onboarding", "/profile", "/state", "/logs", "/quests", "/chains", "/notices", "/messages", "/debrief", "/recap", "/gym", "/adherence", "/comeback", "/seasons", "/progress", "/social", "/rivals", "/clans", "/challenges", "/duo", "/finance", "/custom-domains"], requireAuth);
  router.use(systemRoutes(db));
  router.use(historyRoutes(db, ai));
  if (db) {
    router.use(adminRoutes(db, deps.now));
    router.use(adminMetricsRoutes(db, deps.now));
    router.use(onboardingRoutes(db));
    router.use(profileRoutes(db, deps.now));
    router.use(stateRoutes(db));
    router.use(logsRoutes(db, deps.now, ai));
    router.use(questsRoutes(db, ai, deps.now));
    router.use(chainsRoutes(db));
    router.use(noticesRoutes(db));
    router.use(messagesRoutes(db, ai));
    router.use(debriefRoutes(db, ai));
    router.use(gymRoutes(db, deps.now));
    router.use(adherenceRoutes(db));
    router.use(comebackRoutes(db, deps.now));
    router.use(seasonsRoutes(db, deps.now));
    router.use(progressRoutes(db));
    router.use(socialRoutes(db, deps.now));
    router.use(rivalsRoutes(db, ai, deps.now));
    router.use(socialRatingsRoutes(db, deps.now));
    router.use(clansRoutes(db, deps.now));
    router.use(challengesRoutes(db, deps.now));
    router.use(duoRoutes(db, deps.now));
    router.use(financeRoutes(db, deps.now));
    router.use(customDomainsRoutes(db, deps.now));
  }
  return router;
}

export default createRouter;

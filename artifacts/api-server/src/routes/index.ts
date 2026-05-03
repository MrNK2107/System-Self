import { Router, type IRouter } from "express";
import adminRouter from "./admin";
import healthRouter from "./health";
import historyRouter from "./history";
import systemRouter from "./system";

const router: IRouter = Router();

router.use(healthRouter);
router.use(systemRouter);
router.use(historyRouter);
router.use(adminRouter);

export default router;

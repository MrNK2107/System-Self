import { Router, type IRouter } from "express";
import healthRouter from "./health";
import historyRouter from "./history";
import systemRouter from "./system";

const router: IRouter = Router();

router.use(healthRouter);
router.use(systemRouter);
router.use(historyRouter);

export default router;

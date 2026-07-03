import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import papersRouter from "./papers";
import adminRouter from "./admin";
import fieldOverviewRouter from "./fieldOverview";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(papersRouter);
router.use(adminRouter);
router.use(fieldOverviewRouter);

export default router;

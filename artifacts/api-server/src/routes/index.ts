import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import papersRouter from "./papers";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(papersRouter);

export default router;

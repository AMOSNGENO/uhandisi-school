import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import learningRouter from "./learning";
import paymentsRouter from "./payments";
import adminRouter from "./admin";
import uploadsRouter from "./uploads";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(learningRouter);
router.use(paymentsRouter);
router.use(uploadsRouter);
router.use(adminRouter);

export default router;

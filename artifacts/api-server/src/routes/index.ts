import { Router, type IRouter } from "express";
import healthRouter from "./health";
import learningRouter from "./learning";
import paymentsRouter from "./payments";

const router: IRouter = Router();

router.use(healthRouter);
router.use(learningRouter);
router.use(paymentsRouter);

export default router;

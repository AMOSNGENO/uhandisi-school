import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import learningRouter from "./learning";
import paymentsRouter from "./payments";
import adminRouter from "./admin";
import uploadsRouter from "./uploads";
import adminContentRouter from "./admin-content";
import contentRouter from "./content";
import adminMoodleRouter from "./admin-moodle";
import examsRouter from "./exams";
import adminCertificatesRouter from "./admin-certificates";
import siteSettingsRouter from "./site-settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(learningRouter);
router.use(paymentsRouter);
router.use(uploadsRouter);
router.use(adminContentRouter);
router.use(contentRouter);
router.use(adminMoodleRouter);
router.use(examsRouter);
router.use(adminCertificatesRouter);
router.use(siteSettingsRouter);
router.use(adminRouter);

export default router;

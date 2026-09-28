import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAdmin } from "../lib/auth";
import { getJob, listMoodleCourses, MoodleError, moodleStatus, startImport } from "../lib/moodle";

const router: IRouter = Router();
router.use("/admin/moodle", requireAdmin);

router.get("/admin/moodle/status", async (_req, res) => {
  res.json(await moodleStatus());
});

router.get("/admin/moodle/courses", async (_req, res) => {
  try {
    res.json(await listMoodleCourses());
  } catch (e) {
    res.status(502).json({ error: e instanceof MoodleError ? e.message : "Couldn't read courses from Moodle. Check the connection on this page." });
  }
});

router.post("/admin/moodle/import", (req, res) => {
  const body = z.object({ courseIds: z.array(z.number().int().positive()).min(1).max(200) }).safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Choose at least one course to import." });
  try {
    res.status(202).json({ jobId: startImport(body.data.courseIds) });
  } catch (e) {
    res.status(409).json({ error: e instanceof MoodleError ? e.message : "Couldn't start the import." });
  }
});

router.get("/admin/moodle/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return void res.status(404).json({ error: "Import not found (the server may have restarted)." });
  res.json(job);
});

export default router;

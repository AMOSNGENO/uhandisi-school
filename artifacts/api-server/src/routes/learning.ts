import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  GetCourseParams,
  GetCourseResponse,
  GetStudentDashboardResponse,
  ListCoursesResponse,
  ListStudentPaymentsResponse,
} from "@workspace/api-zod";
import { coursesTable, db, enrollmentsTable, lessonsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { enroll, getCourseForUser, listCourseSummaries, paymentsFor } from "../lib/courses";

const router: IRouter = Router();

// Course browsing is public; enrolling, paying and the student pages need a login.
router.get("/courses", async (_req, res) => {
  const courses = await listCourseSummaries();
  res.json(ListCoursesResponse.parse(courses.map((c) => c.summary)));
});

router.get("/courses/:courseId", async (req, res) => {
  const params = GetCourseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const course = await getCourseForUser(params.data.courseId, req.user?.id ?? null);
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }
  // overviewHtml isn't in the generated API schema yet, so it's added after validation.
  res.json({ ...GetCourseResponse.parse(course), overviewHtml: course.overviewHtml });
});

// A module's lessons, only for someone who has unlocked it (admins can preview everything).
router.get("/courses/:courseId/modules/:moduleId", requireAuth, async (req, res) => {
  const courseId = Number(req.params.courseId);
  const moduleId = Number(req.params.moduleId);
  if (!Number.isInteger(courseId) || !Number.isInteger(moduleId)) {
    res.status(400).json({ error: "Invalid course or module" });
    return;
  }
  const isAdmin = req.user!.role === "admin";
  const course = await getCourseForUser(courseId, req.user!.id, { includeUnpublished: isAdmin });
  const module = course?.modules.find((m) => m.id === moduleId);
  if (!course || !module) {
    res.status(404).json({ error: "Module not found" });
    return;
  }
  if (!module.unlocked && !isAdmin) {
    res.status(403).json({ error: "This module is locked. Make a payment to unlock it." });
    return;
  }
  // Opening a free course's module counts as joining it.
  if (course.paymentModel === "free") await enroll(req.user!.id, courseId);
  const rows = await db
    .select()
    .from(lessonsTable)
    .where(eq(lessonsTable.moduleId, moduleId))
    .orderBy(asc(lessonsTable.order), asc(lessonsTable.id));
  // Files and packages are reached through the access-checked /content routes, never their storage paths.
  const packageUrl = (lessonId: number, href: string) => `/api/content/package/${lessonId}/${href}`;
  const lessons = rows.map((l) => ({
    id: l.id,
    title: l.title,
    kind: l.kind,
    contentHtml: l.contentHtml,
    externalUrl: l.kind === "url" ? l.externalUrl : null,
    file: l.kind === "file" && l.storageKey
      ? { name: l.fileName, type: l.fileType, size: l.fileSize, url: `/api/content/file/${l.id}` }
      : null,
    package: l.kind === "package" && l.storageKey && l.packageEntry
      ? {
        scorm: l.fileType === "scorm",
        entryUrl: packageUrl(l.id, l.packageEntry),
        toc: (JSON.parse(l.packageToc || "[]") as Array<{ title: string; href: string | null; depth: number }>)
          .map((t) => ({ title: t.title, depth: t.depth, url: t.href ? packageUrl(l.id, t.href) : null })),
      }
      : null,
  }));
  res.json({
    course: { id: course.id, title: course.title, accent: course.accent },
    module: { ...module, locked: !module.unlocked },
    modules: course.modules.map((m) => ({ id: m.id, title: m.title, unlocked: m.unlocked || isAdmin })),
    lessons,
  });
});

// Free courses are joined directly; paid ones are joined by making a payment.
router.post("/courses/:courseId/enroll", requireAuth, async (req, res) => {
  const params = GetCourseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [course] = await db
    .select({ id: coursesTable.id, paymentModel: coursesTable.paymentModel })
    .from(coursesTable)
    .where(and(eq(coursesTable.id, params.data.courseId), eq(coursesTable.published, true)))
    .limit(1);
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }
  if (course.paymentModel !== "free") {
    res.status(400).json({ error: "This course is paid. Make a payment to enroll." });
    return;
  }
  await enroll(req.user!.id, course.id);
  res.status(204).end();
});

router.get("/student/dashboard", requireAuth, async (req, res) => {
  const user = req.user!;
  const all = await listCourseSummaries();
  const myCourseIds = new Set(
    (await db.select({ courseId: enrollmentsTable.courseId }).from(enrollmentsTable).where(eq(enrollmentsTable.userId, user.id)))
      .map((e) => e.courseId),
  );
  const enrolledCourses = [];
  for (const { course, summary } of all) {
    if (!myCourseIds.has(course.id)) continue;
    const detail = await getCourseForUser(course.id, user.id);
    if (detail) enrolledCourses.push({ ...summary, progress: detail.progress });
  }
  const payments = await paymentsFor({ userId: user.id });
  const data = {
    studentName: user.name,
    streakDays: 0,
    enrolledCourses,
    featuredCourses: all.map((c) => c.summary),
    totalPaid: payments.filter((p) => p.status === "completed").reduce((sum, p) => sum + p.amount, 0),
    activeCourseCount: enrolledCourses.length,
    // Lesson completion isn't tracked yet, so no course can be "completed" (being fully paid isn't the same thing).
    completedCourseCount: 0,
  };
  res.json(GetStudentDashboardResponse.parse(data));
});

router.get("/student/payments", requireAuth, async (req, res) => {
  res.json(ListStudentPaymentsResponse.parse(await paymentsFor({ userId: req.user!.id })));
});

export default router;

import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  GetCourseParams,
  GetCourseResponse,
  GetStudentDashboardResponse,
  ListCoursesResponse,
  ListStudentPaymentsResponse,
} from "@workspace/api-zod";
import { coursesTable, db, enrollmentsTable, lessonsTable, modulesTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { lessonForViewer } from "../lib/access";
import { enroll, getCourseForUser, listCourseSummaries, paymentsFor } from "../lib/courses";
import { activeCertificate } from "../lib/exams";
import { checkCompletion, learningStreak, markViewed, userProgress } from "../lib/progress";

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
  const extra: Record<string, unknown> = { overviewHtml: course.overviewHtml, certificateRule: course.certificateRule };
  if (req.user) {
    const progress = await userProgress(req.user.id, course.id);
    for (const m of course.modules) {
      const p = progress.modules.find((x) => x.moduleId === m.id);
      if (m.unlocked && p && p.total > 0 && p.done === p.total) m.status = "complete";
    }
    const cert = await activeCertificate(req.user.id, course.id);
    extra.completion = { done: progress.done, total: progress.total, percent: progress.percent, complete: progress.complete };
    extra.certificate = cert ? { code: cert.code } : null;
  }
  // Pay-as-you-go details (lessons and their prices, plans, lesson-level progress) aren't in the generated API
  // schema yet, so the validated response gets them back afterwards.
  res.json({
    ...GetCourseResponse.parse(course),
    progress: course.progress, modules: course.modules, lessons: course.lessons, plans: course.plans, planId: course.planId,
    ...extra,
  });
});

// The student picks a daily plan (Bronze, Silver, ...). It only sets their pace; it joins them to the course too.
router.post("/courses/:courseId/plan", requireAuth, async (req, res) => {
  const courseId = Number(req.params.courseId);
  const planId = typeof req.body?.planId === "string" ? req.body.planId : "";
  const course = Number.isInteger(courseId) ? await getCourseForUser(courseId, req.user!.id) : undefined;
  if (!course) return void res.status(404).json({ error: "Course not found" });
  if (course.paymentModel === "free") return void res.status(400).json({ error: "This course is free; there's nothing to pay." });
  if (!course.plans.some((p) => p.id === planId)) return void res.status(400).json({ error: "Pick one of the plans shown." });
  await enroll(req.user!.id, courseId);
  await db.update(enrollmentsTable).set({ planId })
    .where(and(eq(enrollmentsTable.userId, req.user!.id), eq(enrollmentsTable.courseId, courseId)));
  res.status(204).end();
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
  const progress = await userProgress(req.user!.id, courseId);
  // Files and packages are reached through the access-checked /content routes, never their storage paths.
  const packageUrl = (lessonId: number, href: string) => `/api/content/package/${lessonId}/${href}`;
  const locked = (lessonId: number) => !isAdmin && !course.lessons.find((x) => x.id === lessonId)?.unlocked;
  const lessons = rows.map((l) => {
    const access = course.lessons.find((x) => x.id === l.id);
    const pricing = { price: access?.price ?? 0, paidTowards: access?.paidTowards ?? 0, amountToOpen: isAdmin ? 0 : access?.amountToOpen ?? 0 };
    // A lesson the student hasn't paid up to yet shows its title and price, never its content.
    if (locked(l.id)) {
      return { id: l.id, title: l.title, kind: l.kind, done: false, locked: true, ...pricing, contentHtml: "", externalUrl: null, file: null, package: null };
    }
    return {
    id: l.id,
    title: l.title,
    kind: l.kind,
    done: progress.doneIds.has(l.id),
    locked: false,
    ...pricing,
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
    };
  });
  res.json({
    course: { id: course.id, title: course.title, accent: course.accent, paymentModel: course.paymentModel, remaining: course.progress.remaining },
    module: { ...module, locked: !module.unlocked },
    modules: course.modules.map((m) => ({ id: m.id, title: m.title, unlocked: m.unlocked || isAdmin })),
    lessons,
    completion: { done: progress.done, total: progress.total, percent: progress.percent, complete: progress.complete },
  });
});

// Opening a reading activity marks it done; finishing the course can issue the certificate.
router.post("/lessons/:lessonId/view", requireAuth, async (req, res) => {
  const lesson = await lessonForViewer(req.user!, Number(req.params.lessonId));
  if (!lesson) return void res.status(404).json({ error: "Lesson not found, or its module is locked." });
  const [mod] = await db.select({ courseId: modulesTable.courseId }).from(modulesTable).where(eq(modulesTable.id, lesson.moduleId)).limit(1);
  const courseId = mod!.courseId;
  const before = await activeCertificate(req.user!.id, courseId);
  // Working through a course means taking part in it (no-op if already enrolled).
  await enroll(req.user!.id, courseId);
  if (lesson.kind !== "quiz") await markViewed(req.user!.id, lesson.id);
  const cert = (await checkCompletion(req.user!.id, courseId)) ?? before;
  const progress = await userProgress(req.user!.id, courseId);
  res.json({
    done: progress.doneIds.has(lesson.id),
    completion: { done: progress.done, total: progress.total, percent: progress.percent, complete: progress.complete },
    certificate: cert ? { code: cert.code, new: !before } : null,
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
  const completion = new Map<number, { done: number; total: number; percent: number; complete: boolean }>();
  const fullProgress = new Map<number, unknown>();
  for (const { course, summary } of all) {
    if (!myCourseIds.has(course.id)) continue;
    const detail = await getCourseForUser(course.id, user.id);
    if (!detail) continue;
    enrolledCourses.push({ ...summary, progress: detail.progress });
    fullProgress.set(course.id, detail.progress);
    const p = await userProgress(user.id, course.id);
    // A course counts as completed once everything is done or its certificate has been earned.
    const earned = !!(await activeCertificate(user.id, course.id));
    completion.set(course.id, { done: p.done, total: p.total, percent: p.percent, complete: p.complete || earned });
  }
  const finished = [...completion.values()].filter((c) => c.complete).length;
  const payments = await paymentsFor({ userId: user.id });
  const data = {
    studentName: user.name,
    streakDays: await learningStreak(user.id),
    enrolledCourses,
    featuredCourses: all.map((c) => c.summary),
    totalPaid: payments.filter((p) => p.status === "completed").reduce((sum, p) => sum + p.amount, 0),
    activeCourseCount: enrolledCourses.length - finished,
    completedCourseCount: finished,
  };
  const parsed = GetStudentDashboardResponse.parse(data);
  // Learning completion per course isn't in the generated schema yet, so it's added after validation.
  res.json({ ...parsed, enrolledCourses: parsed.enrolledCourses.map((c) => ({ ...c, progress: fullProgress.get(c.id) ?? c.progress, completion: completion.get(c.id) })) });
});

router.get("/student/payments", requireAuth, async (req, res) => {
  res.json(ListStudentPaymentsResponse.parse(await paymentsFor({ userId: req.user!.id })));
});

export default router;

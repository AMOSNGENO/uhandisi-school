import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  coursesTable, db, enrollmentsTable, hashPassword, lessonsTable, modulesTable, paymentsTable, sessionsTable, usersTable,
} from "@workspace/db";
import { requireAdmin, toPublicUser } from "../lib/auth";
import { removeStored } from "../lib/storage";
import { clearAccessCache } from "../lib/access";
import { paymentsFor } from "../lib/courses";
import { isMpesaConfigured, MpesaError, mpesaStatus, queryStkStatus } from "../lib/mpesa";
import { applyMpesaResult } from "./payments";

const router: IRouter = Router();
router.use("/admin", requireAdmin);

const Id = z.coerce.number().int().positive();

function badRequest(res: import("express").Response, error: z.ZodError) {
  res.status(400).json({ error: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

router.get("/admin/stats", async (_req, res) => {
  const [users] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      students: sql<number>`SUM(${usersTable.role} = 'student')`,
      admins: sql<number>`SUM(${usersTable.role} = 'admin')`,
    })
    .from(usersTable);
  const [courses] = await db
    .select({ total: sql<number>`COUNT(*)`, published: sql<number>`SUM(${coursesTable.published})` })
    .from(coursesTable);
  const [payments] = await db
    .select({
      revenue: sql<number>`COALESCE(SUM(CASE WHEN ${paymentsTable.status} = 'completed' THEN ${paymentsTable.amount} END), 0)`,
      pending: sql<number>`SUM(${paymentsTable.status} = 'pending')`,
      completed: sql<number>`SUM(${paymentsTable.status} = 'completed')`,
    })
    .from(paymentsTable);
  const [enrollments] = await db.select({ total: sql<number>`COUNT(*)` }).from(enrollmentsTable);
  res.json({
    users: { total: Number(users?.total ?? 0), students: Number(users?.students ?? 0), admins: Number(users?.admins ?? 0) },
    courses: { total: Number(courses?.total ?? 0), published: Number(courses?.published ?? 0) },
    payments: { revenue: Number(payments?.revenue ?? 0), pending: Number(payments?.pending ?? 0), completed: Number(payments?.completed ?? 0) },
    enrollments: Number(enrollments?.total ?? 0),
    recentPayments: (await paymentsFor()).slice(0, 8),
  });
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const adminUser = (u: typeof usersTable.$inferSelect, enrolments = 0) =>
  ({ ...toPublicUser(u), active: u.active, createdAt: u.createdAt.toISOString(), enrolments });

router.get("/admin/users", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const role = typeof req.query.role === "string" && ["student", "instructor", "admin"].includes(req.query.role) ? req.query.role : "";
  const pattern = `%${search}%`;
  const users = await db
    .select()
    .from(usersTable)
    .where(and(
      search ? or(like(usersTable.name, pattern), like(usersTable.email, pattern), like(usersTable.phone, pattern)) : undefined,
      role ? eq(usersTable.role, role as "student") : undefined,
    ))
    .orderBy(desc(usersTable.createdAt))
    .limit(500);
  const counts = await db
    .select({ userId: enrollmentsTable.userId, n: sql<number>`COUNT(*)` })
    .from(enrollmentsTable)
    .groupBy(enrollmentsTable.userId);
  const byUser = new Map(counts.map((c) => [c.userId, Number(c.n)]));
  res.json(users.map((u) => adminUser(u, byUser.get(u.id) ?? 0)));
});

const Role = z.enum(["student", "instructor", "admin"]);
const Email = z.string().trim().toLowerCase().email().max(190);

// Admins can add accounts themselves (Moodle: Site administration > Users > Add a new user).
router.post("/admin/users", async (req, res) => {
  const body = z.object({
    name: z.string().trim().min(2).max(120),
    email: Email,
    phone: z.string().trim().max(30).optional(),
    role: Role.default("student"),
    password: z.string().min(8).max(200),
  }).safeParse(req.body);
  if (!body.success) return badRequest(res, body.error);
  const [taken] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, body.data.email)).limit(1);
  if (taken) return void res.status(409).json({ error: "An account with that email already exists." });
  const [result] = await db.insert(usersTable).values({
    name: body.data.name, email: body.data.email, phone: body.data.phone || null, role: body.data.role,
    passwordHash: await hashPassword(body.data.password), active: true, createdAt: new Date(),
  });
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, result.insertId)).limit(1);
  res.status(201).json(adminUser(user!));
});

// A new password set by an admin also logs the user out everywhere.
router.post("/admin/users/:id/password", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  const body = z.object({ password: z.string().min(8).max(200) }).safeParse(req.body);
  if (!id.success) return void res.status(400).json({ error: "Invalid user id" });
  if (!body.success) return void res.status(400).json({ error: "The password must be at least 8 characters." });
  const [result] = await db.update(usersTable).set({ passwordHash: await hashPassword(body.data.password) }).where(eq(usersTable.id, id.data));
  if (!result.affectedRows) return void res.status(404).json({ error: "User not found" });
  if (id.data !== req.user!.id) await db.delete(sessionsTable).where(eq(sessionsTable.userId, id.data));
  res.status(204).end();
});

router.delete("/admin/users/:id", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid user id" });
  if (id.data === req.user!.id) return void res.status(400).json({ error: "You can't delete your own account." });
  const [paid] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.userId, id.data), eq(paymentsTable.status, "completed")));
  if (Number(paid?.n ?? 0) > 0) {
    return void res.status(409).json({ error: "This person has made payments, so their record is kept. Suspend the account instead." });
  }
  await db.delete(usersTable).where(eq(usersTable.id, id.data));
  res.status(204).end();
});

const UpdateUserBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: Email.optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  role: Role.optional(),
  active: z.boolean().optional(),
});

router.patch("/admin/users/:id", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  const body = UpdateUserBody.safeParse(req.body);
  if (!id.success) return void res.status(400).json({ error: "Invalid user id" });
  if (!body.success) return badRequest(res, body.error);
  if (id.data === req.user!.id && (body.data.role !== undefined && body.data.role !== "admin" || body.data.active === false)) {
    res.status(400).json({ error: "You can't remove your own admin access or disable your own account." });
    return;
  }
  if (body.data.email) {
    const [taken] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, body.data.email)).limit(1);
    if (taken && taken.id !== id.data) return void res.status(409).json({ error: "Another account already uses that email." });
  }
  const changes = { ...body.data, ...(body.data.phone !== undefined ? { phone: body.data.phone || null } : {}) };
  if (Object.keys(changes).length) await db.update(usersTable).set(changes).where(eq(usersTable.id, id.data));
  // Log a disabled user out everywhere.
  if (body.data.active === false) await db.delete(sessionsTable).where(eq(sessionsTable.userId, id.data));
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id.data)).limit(1);
  if (!user) return void res.status(404).json({ error: "User not found" });
  res.json(adminUser(user));
});

// ---------------------------------------------------------------------------
// Courses & modules
// ---------------------------------------------------------------------------

const CourseBody = z.object({
  title: z.string().trim().min(2).max(190),
  category: z.string().trim().min(2).max(120),
  description: z.string().trim().min(1),
  price: z.number().int().min(0),
  paymentModel: z.enum(["free", "paid", "lipa_pole_pole"]),
  accent: z.string().trim().max(20).default("#1f6f5c"),
  imageUrl: z.string().trim().max(255).default(""),
  instructor: z.string().trim().max(120).default(""),
  instructorRole: z.string().trim().max(120).default(""),
  planName: z.string().trim().max(60).default("Flex"),
  planAmountPerDay: z.number().int().min(0).default(100),
  planDescription: z.string().trim().max(255).default(""),
  published: z.boolean().default(true),
  overviewHtml: z.string().max(5_000_000).default(""),
  certificateTemplateId: z.number().int().positive().nullable().default(null),
  certificateRule: z.enum(["completion", "exams", "manual"]).default("completion"),
});

const ModuleBody = z.object({
  title: z.string().trim().min(2).max(190),
  description: z.string().trim().default(""),
  unlockAmount: z.number().int().min(0).default(0),
  lessonCount: z.number().int().min(0).default(0),
  duration: z.string().trim().max(30).default(""),
});

async function withLessonTotals<M extends { id: number }>(modules: M[]) {
  if (modules.length === 0) return [];
  const counts = await db
    .select({ moduleId: lessonsTable.moduleId, n: sql<number>`COUNT(*)` })
    .from(lessonsTable)
    .where(inArray(lessonsTable.moduleId, modules.map((m) => m.id)))
    .groupBy(lessonsTable.moduleId);
  const byModule = new Map(counts.map((c) => [c.moduleId, Number(c.n)]));
  return modules.map((m) => ({ ...m, lessonTotal: byModule.get(m.id) ?? 0 }));
}

async function courseWithModules(id: number) {
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, id)).limit(1);
  if (!course) return undefined;
  const modules = await db.select().from(modulesTable).where(eq(modulesTable.courseId, id)).orderBy(asc(modulesTable.order), asc(modulesTable.id));
  return { ...course, overviewHtml: course.overviewHtml ?? "", createdAt: course.createdAt.toISOString(), modules: await withLessonTotals(modules) };
}

router.get("/admin/courses", async (_req, res) => {
  const courses = await db.select().from(coursesTable).orderBy(asc(coursesTable.id));
  const modules = await withLessonTotals(await db.select().from(modulesTable).orderBy(asc(modulesTable.order), asc(modulesTable.id)));
  const counts = await db
    .select({ courseId: enrollmentsTable.courseId, n: sql<number>`COUNT(*)` })
    .from(enrollmentsTable)
    .groupBy(enrollmentsTable.courseId);
  res.json(courses.map((c) => ({
    ...c,
    overviewHtml: c.overviewHtml ?? "",
    createdAt: c.createdAt.toISOString(),
    enrolledCount: Number(counts.find((x) => x.courseId === c.id)?.n ?? 0),
    modules: modules.filter((m) => m.courseId === c.id),
  })));
});

router.post("/admin/courses", async (req, res) => {
  const body = CourseBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error);
  const data = body.data.paymentModel === "free" ? { ...body.data, price: 0 } : body.data;
  const [result] = await db.insert(coursesTable).values({ ...data, createdAt: new Date() });
  res.status(201).json(await courseWithModules(result.insertId));
});

router.patch("/admin/courses/:id", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  const body = CourseBody.partial().safeParse(req.body);
  if (!id.success) return void res.status(400).json({ error: "Invalid course id" });
  if (!body.success) return badRequest(res, body.error);
  // A free course never carries a price.
  const data = body.data.paymentModel === "free" ? { ...body.data, price: 0 } : body.data;
  if (Object.keys(data).length) await db.update(coursesTable).set(data).where(eq(coursesTable.id, id.data));
  const course = await courseWithModules(id.data);
  if (!course) return void res.status(404).json({ error: "Course not found" });
  res.json(course);
});

router.delete("/admin/courses/:id", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid course id" });
  const [paid] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.courseId, id.data), eq(paymentsTable.status, "completed")));
  if (Number(paid?.n ?? 0) > 0) {
    res.status(409).json({ error: "Students have paid for this course. Unpublish it instead of deleting it." });
    return;
  }
  await removeLessonFiles(
    db.select({ kind: lessonsTable.kind, storageKey: lessonsTable.storageKey })
      .from(lessonsTable)
      .innerJoin(modulesTable, eq(lessonsTable.moduleId, modulesTable.id))
      .where(eq(modulesTable.courseId, id.data)),
  );
  await db.delete(coursesTable).where(eq(coursesTable.id, id.data));
  res.status(204).end();
});

router.post("/admin/courses/:id/modules", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  const body = ModuleBody.safeParse(req.body);
  if (!id.success) return void res.status(400).json({ error: "Invalid course id" });
  if (!body.success) return badRequest(res, body.error);
  const [max] = await db
    .select({ n: sql<number>`COALESCE(MAX(${modulesTable.order}), 0)` })
    .from(modulesTable)
    .where(eq(modulesTable.courseId, id.data));
  await db.insert(modulesTable).values({ ...body.data, courseId: id.data, order: Number(max?.n ?? 0) + 1 });
  res.status(201).json(await courseWithModules(id.data));
});

router.put("/admin/courses/:id/module-order", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  const body = z.object({ moduleIds: z.array(Id) }).safeParse(req.body);
  if (!id.success) return void res.status(400).json({ error: "Invalid course id" });
  if (!body.success) return badRequest(res, body.error);
  await db.transaction(async (tx) => {
    for (const [i, moduleId] of body.data.moduleIds.entries()) {
      await tx.update(modulesTable).set({ order: i + 1 }).where(and(eq(modulesTable.id, moduleId), eq(modulesTable.courseId, id.data)));
    }
  });
  res.json(await courseWithModules(id.data));
});

router.patch("/admin/modules/:id", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  const body = ModuleBody.partial().safeParse(req.body);
  if (!id.success) return void res.status(400).json({ error: "Invalid module id" });
  if (!body.success) return badRequest(res, body.error);
  const [module] = await db.select().from(modulesTable).where(eq(modulesTable.id, id.data)).limit(1);
  if (!module) return void res.status(404).json({ error: "Module not found" });
  if (Object.keys(body.data).length) await db.update(modulesTable).set(body.data).where(eq(modulesTable.id, id.data));
  res.json(await courseWithModules(module.courseId));
});

router.delete("/admin/modules/:id", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid module id" });
  const [module] = await db.select().from(modulesTable).where(eq(modulesTable.id, id.data)).limit(1);
  if (!module) return void res.status(404).json({ error: "Module not found" });
  await removeLessonFiles(
    db.select({ kind: lessonsTable.kind, storageKey: lessonsTable.storageKey }).from(lessonsTable).where(eq(lessonsTable.moduleId, id.data)),
  );
  await db.delete(modulesTable).where(eq(modulesTable.id, id.data));
  res.json(await courseWithModules(module.courseId));
});

// ---------------------------------------------------------------------------
// Lessons (the content inside a module)
// ---------------------------------------------------------------------------

// Moodle-style activity or resource: page (rich text), file, url, or package (IMS / SCORM zip).
// Files and packages are uploaded separately (admin-content.ts) once the item exists.
const LessonBody = z.object({
  title: z.string().trim().min(1).max(190),
  kind: z.enum(["page", "file", "url", "package", "quiz"]).default("page"),
  contentHtml: z.string().max(5_000_000).default(""),
  externalUrl: z.string().trim().max(1000).refine((u) => u === "" || /^https?:\/\//i.test(u), "must start with http:// or https://").nullable().optional(),
});

async function removeLessonFiles(rows: Promise<Array<{ kind: string; storageKey: string | null }>>) {
  for (const r of await rows) await removeStored(r.kind, r.storageKey);
}

const lessonList = async (moduleId: number) =>
  (await db.select().from(lessonsTable).where(eq(lessonsTable.moduleId, moduleId)).orderBy(asc(lessonsTable.order), asc(lessonsTable.id)))
    .map(({ storageKey, packageToc, ...l }) => ({ ...l, hasUpload: !!storageKey, packageItems: packageToc ? (JSON.parse(packageToc) as unknown[]).length : 0 }));

router.get("/admin/modules/:id/lessons", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid module id" });
  res.json(await lessonList(id.data));
});

router.post("/admin/modules/:id/lessons", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  const body = LessonBody.safeParse(req.body);
  if (!id.success) return void res.status(400).json({ error: "Invalid module id" });
  if (!body.success) return badRequest(res, body.error);
  const [module] = await db.select({ id: modulesTable.id }).from(modulesTable).where(eq(modulesTable.id, id.data)).limit(1);
  if (!module) return void res.status(404).json({ error: "Module not found" });
  const [max] = await db
    .select({ n: sql<number>`COALESCE(MAX(${lessonsTable.order}), 0)` })
    .from(lessonsTable)
    .where(eq(lessonsTable.moduleId, id.data));
  const now = new Date();
  await db.insert(lessonsTable).values({ ...body.data, moduleId: id.data, order: Number(max?.n ?? 0) + 1, createdAt: now, updatedAt: now });
  res.status(201).json(await lessonList(id.data));
});

router.patch("/admin/lessons/:id", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  const body = LessonBody.partial().safeParse(req.body);
  if (!id.success) return void res.status(400).json({ error: "Invalid lesson id" });
  if (!body.success) return badRequest(res, body.error);
  const [lesson] = await db.select().from(lessonsTable).where(eq(lessonsTable.id, id.data)).limit(1);
  if (!lesson) return void res.status(404).json({ error: "Lesson not found" });
  // Switching type drops any uploaded file or package that no longer applies.
  const dropUpload = body.data.kind !== undefined && body.data.kind !== lesson.kind && lesson.storageKey;
  if (dropUpload) await removeStored(lesson.kind, lesson.storageKey);
  await db.update(lessonsTable).set({
    ...body.data,
    ...(dropUpload ? { storageKey: null, fileName: null, fileType: null, fileSize: null, packageEntry: null, packageToc: null } : {}),
    updatedAt: new Date(),
  }).where(eq(lessonsTable.id, id.data));
  res.json(await lessonList(lesson.moduleId));
});

router.delete("/admin/lessons/:id", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid lesson id" });
  const [lesson] = await db.select().from(lessonsTable).where(eq(lessonsTable.id, id.data)).limit(1);
  if (!lesson) return void res.status(404).json({ error: "Lesson not found" });
  await removeStored(lesson.kind, lesson.storageKey);
  await db.delete(lessonsTable).where(eq(lessonsTable.id, id.data));
  res.json(await lessonList(lesson.moduleId));
});

router.put("/admin/modules/:id/lesson-order", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  const body = z.object({ lessonIds: z.array(Id) }).safeParse(req.body);
  if (!id.success) return void res.status(400).json({ error: "Invalid module id" });
  if (!body.success) return badRequest(res, body.error);
  await db.transaction(async (tx) => {
    for (const [i, lessonId] of body.data.lessonIds.entries()) {
      await tx.update(lessonsTable).set({ order: i + 1 }).where(and(eq(lessonsTable.id, lessonId), eq(lessonsTable.moduleId, id.data)));
    }
  });
  res.json(await lessonList(id.data));
});

// ---------------------------------------------------------------------------
// Participants (enrolments in one course)
// ---------------------------------------------------------------------------

router.get("/admin/courses/:id/participants", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid course id" });
  const rows = await db
    .select({ enrolment: enrollmentsTable, user: usersTable })
    .from(enrollmentsTable)
    .innerJoin(usersTable, eq(enrollmentsTable.userId, usersTable.id))
    .where(eq(enrollmentsTable.courseId, id.data))
    .orderBy(desc(enrollmentsTable.createdAt));
  const paid = await db
    .select({ userId: paymentsTable.userId, total: sql<number>`SUM(${paymentsTable.amount})` })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.courseId, id.data), eq(paymentsTable.status, "completed")))
    .groupBy(paymentsTable.userId);
  const paidBy = new Map(paid.map((p) => [p.userId, Number(p.total)]));
  res.json(rows.map(({ enrolment, user }) => ({
    userId: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, active: user.active,
    fullAccess: enrolment.fullAccess, enrolledAt: enrolment.createdAt.toISOString(), paid: paidBy.get(user.id) ?? 0,
  })));
});

// Manual enrolment by email; fullAccess unlocks every module without payment.
router.post("/admin/courses/:id/participants", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  const body = z.object({ email: Email, fullAccess: z.boolean().default(false) }).safeParse(req.body);
  if (!id.success) return void res.status(400).json({ error: "Invalid course id" });
  if (!body.success) return void res.status(400).json({ error: "Enter the email address of an existing account." });
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, body.data.email)).limit(1);
  if (!user) return void res.status(404).json({ error: "No account uses that email. Add the person under Users first." });
  const [existing] = await db
    .select({ id: enrollmentsTable.id })
    .from(enrollmentsTable)
    .where(and(eq(enrollmentsTable.userId, user.id), eq(enrollmentsTable.courseId, id.data)))
    .limit(1);
  if (existing) await db.update(enrollmentsTable).set({ fullAccess: body.data.fullAccess }).where(eq(enrollmentsTable.id, existing.id));
  else await db.insert(enrollmentsTable).values({ userId: user.id, courseId: id.data, fullAccess: body.data.fullAccess, createdAt: new Date() });
  clearAccessCache();
  res.status(existing ? 200 : 201).json({ ok: true, alreadyEnrolled: !!existing });
});

router.patch("/admin/courses/:id/participants/:userId", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  const userId = Id.safeParse(req.params.userId);
  const body = z.object({ fullAccess: z.boolean() }).safeParse(req.body);
  if (!id.success || !userId.success || !body.success) return void res.status(400).json({ error: "Invalid request" });
  await db.update(enrollmentsTable).set({ fullAccess: body.data.fullAccess })
    .where(and(eq(enrollmentsTable.courseId, id.data), eq(enrollmentsTable.userId, userId.data)));
  clearAccessCache();
  res.status(204).end();
});

// Unenrolling keeps payment records; a paid student regains paid modules if they re-enrol.
router.delete("/admin/courses/:id/participants/:userId", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  const userId = Id.safeParse(req.params.userId);
  if (!id.success || !userId.success) return void res.status(400).json({ error: "Invalid request" });
  await db.delete(enrollmentsTable).where(and(eq(enrollmentsTable.courseId, id.data), eq(enrollmentsTable.userId, userId.data)));
  clearAccessCache();
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Categories (the category name on each course)
// ---------------------------------------------------------------------------

router.get("/admin/categories", async (_req, res) => {
  const rows = await db
    .select({ name: coursesTable.category, courses: sql<number>`COUNT(*)`, published: sql<number>`SUM(${coursesTable.published})` })
    .from(coursesTable)
    .groupBy(coursesTable.category)
    .orderBy(asc(coursesTable.category));
  res.json(rows.map((r) => ({ name: r.name, courses: Number(r.courses), published: Number(r.published ?? 0) })));
});

// Renaming to an existing name merges the two categories.
router.patch("/admin/categories", async (req, res) => {
  const body = z.object({ from: z.string().min(1), to: z.string().trim().min(2).max(120) }).safeParse(req.body);
  if (!body.success) return badRequest(res, body.error);
  const [result] = await db.update(coursesTable).set({ category: body.data.to }).where(eq(coursesTable.category, body.data.from));
  res.json({ updated: result.affectedRows });
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

router.get("/admin/payments", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const rows = await paymentsFor();
  const users = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable);
  const byId = new Map(users.map((u) => [u.id, u]));
  res.json(
    rows
      .filter((p) => !status || p.status === status)
      .map((p) => ({ ...p, studentName: byId.get(p.userId)?.name ?? "Deleted user", studentEmail: byId.get(p.userId)?.email ?? "" })),
  );
});

const UpdatePaymentBody = z.object({
  status: z.enum(["pending", "completed", "failed", "cancelled", "refunded"]),
  receipt: z.string().trim().max(60).optional(),
});

router.get("/admin/mpesa", (_req, res) => {
  res.json(mpesaStatus());
});

// Asks Safaricom directly, for when a callback never arrived (e.g. a local machine Safaricom can't reach).
router.post("/admin/payments/:id/check", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid payment id" });
  if (!isMpesaConfigured()) return void res.status(400).json({ error: "M-Pesa isn't connected yet. Add the Daraja keys to the server's .env file." });
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id.data)).limit(1);
  if (!payment) return void res.status(404).json({ error: "Payment not found" });
  if (!payment.checkoutRequestId || payment.checkoutRequestId.startsWith("manual_")) {
    return void res.status(400).json({ error: "This payment was recorded without M-Pesa, so there's nothing to check." });
  }
  try {
    const status = await queryStkStatus(payment.checkoutRequestId);
    if (status.resultCode === null) return void res.json({ status: "pending", message: "The customer hasn't finished paying yet." });
    // The query doesn't return the receipt number; the admin can add it when confirming.
    await applyMpesaResult({ checkoutRequestId: payment.checkoutRequestId, resultCode: status.resultCode, resultDescription: status.resultDescription });
    const [updated] = await db.select({ status: paymentsTable.status }).from(paymentsTable).where(eq(paymentsTable.id, id.data)).limit(1);
    res.json({ status: updated?.status ?? payment.status, message: status.resultDescription });
  } catch (e) {
    res.status(502).json({ error: e instanceof MpesaError ? `M-Pesa: ${e.message}` : "Could not reach M-Pesa." });
  }
});

// Manual confirmation for when an M-Pesa callback never arrives.
router.patch("/admin/payments/:id", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  const body = UpdatePaymentBody.safeParse(req.body);
  if (!id.success) return void res.status(400).json({ error: "Invalid payment id" });
  if (!body.success) return badRequest(res, body.error);
  await db
    .update(paymentsTable)
    .set({ status: body.data.status, ...(body.data.receipt !== undefined ? { receipt: body.data.receipt || null } : {}) })
    .where(eq(paymentsTable.id, id.data));
  // A refund takes access away again.
  clearAccessCache();
  res.status(204).end();
});

export default router;

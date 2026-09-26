import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  coursesTable, db, enrollmentsTable, lessonsTable, modulesTable, paymentsTable, sessionsTable, usersTable,
} from "@workspace/db";
import { requireAdmin, toPublicUser } from "../lib/auth";
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

router.get("/admin/users", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const pattern = `%${search}%`;
  const users = await db
    .select()
    .from(usersTable)
    .where(search ? or(like(usersTable.name, pattern), like(usersTable.email, pattern), like(usersTable.phone, pattern)) : undefined)
    .orderBy(desc(usersTable.createdAt))
    .limit(200);
  res.json(users.map((u) => ({ ...toPublicUser(u), active: u.active, createdAt: u.createdAt.toISOString() })));
});

const UpdateUserBody = z.object({
  role: z.enum(["student", "instructor", "admin"]).optional(),
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
  await db.update(usersTable).set(body.data).where(eq(usersTable.id, id.data));
  // Log a disabled user out everywhere.
  if (body.data.active === false) await db.delete(sessionsTable).where(eq(sessionsTable.userId, id.data));
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id.data)).limit(1);
  if (!user) return void res.status(404).json({ error: "User not found" });
  res.json({ ...toPublicUser(user), active: user.active, createdAt: user.createdAt.toISOString() });
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
  await db.delete(modulesTable).where(eq(modulesTable.id, id.data));
  res.json(await courseWithModules(module.courseId));
});

// ---------------------------------------------------------------------------
// Lessons (the content inside a module)
// ---------------------------------------------------------------------------

const LessonBody = z.object({
  title: z.string().trim().min(1).max(190),
  contentHtml: z.string().max(5_000_000).default(""),
});

const lessonList = (moduleId: number) =>
  db.select().from(lessonsTable).where(eq(lessonsTable.moduleId, moduleId)).orderBy(asc(lessonsTable.order), asc(lessonsTable.id));

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
  const [lesson] = await db.select({ moduleId: lessonsTable.moduleId }).from(lessonsTable).where(eq(lessonsTable.id, id.data)).limit(1);
  if (!lesson) return void res.status(404).json({ error: "Lesson not found" });
  await db.update(lessonsTable).set({ ...body.data, updatedAt: new Date() }).where(eq(lessonsTable.id, id.data));
  res.json(await lessonList(lesson.moduleId));
});

router.delete("/admin/lessons/:id", async (req, res) => {
  const id = Id.safeParse(req.params.id);
  if (!id.success) return void res.status(400).json({ error: "Invalid lesson id" });
  const [lesson] = await db.select({ moduleId: lessonsTable.moduleId }).from(lessonsTable).where(eq(lessonsTable.id, id.data)).limit(1);
  if (!lesson) return void res.status(404).json({ error: "Lesson not found" });
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
  res.status(204).end();
});

export default router;

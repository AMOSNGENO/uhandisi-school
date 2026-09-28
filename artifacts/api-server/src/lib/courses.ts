import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  coursesTable, db, enrollmentsTable, lessonsTable, modulesTable, paymentsTable,
  type Course, type Module,
} from "@workspace/db";

/** A module's lesson count is its real lessons once it has any; before that, the number the admin typed. */
export async function withRealLessonCounts(modules: Module[]): Promise<Module[]> {
  if (modules.length === 0) return modules;
  const counts = await db
    .select({ moduleId: lessonsTable.moduleId, n: sql<number>`COUNT(*)` })
    .from(lessonsTable)
    .where(inArray(lessonsTable.moduleId, modules.map((m) => m.id)))
    .groupBy(lessonsTable.moduleId);
  const byModule = new Map(counts.map((c) => [c.moduleId, Number(c.n)]));
  return modules.map((m) => (byModule.get(m.id) ? { ...m, lessonCount: byModule.get(m.id)! } : m));
}

export function courseSummary(course: Course, lessonCount: number, enrolledCount: number) {
  return {
    id: course.id,
    title: course.title,
    category: course.category,
    description: course.description,
    price: course.price,
    paymentModel: course.paymentModel,
    lessonCount,
    enrolledCount,
    accent: course.accent,
    imageUrl: course.imageUrl,
  };
}

/** Published courses with lesson and learner counts, in creation order. */
export async function listCourseSummaries(opts: { includeUnpublished?: boolean } = {}) {
  const courses = await db
    .select()
    .from(coursesTable)
    .where(opts.includeUnpublished ? undefined : eq(coursesTable.published, true))
    .orderBy(asc(coursesTable.id));
  if (courses.length === 0) return [];
  const ids = courses.map((c) => c.id);
  const modules = await withRealLessonCounts(await db.select().from(modulesTable).where(inArray(modulesTable.courseId, ids)));
  const enrollments = await db.select().from(enrollmentsTable).where(inArray(enrollmentsTable.courseId, ids));
  return courses.map((course) => {
    const lessons = modules.filter((m) => m.courseId === course.id).reduce((n, m) => n + m.lessonCount, 0);
    const learners = enrollments.filter((e) => e.courseId === course.id).length;
    return { course, summary: courseSummary(course, lessons, learners) };
  });
}

export async function totalPaidForCourse(userId: number, courseId: number) {
  const rows = await db
    .select({ amount: paymentsTable.amount })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.userId, userId), eq(paymentsTable.courseId, courseId), eq(paymentsTable.status, "completed")));
  return rows.reduce((sum, r) => sum + r.amount, 0);
}

/** fullAccess: an admin enrolled this student with the whole course unlocked (scholarship, staff). */
export function progressFor(course: Course, modules: Module[], totalPaid: number, fullAccess = false) {
  const open = course.paymentModel === "free" || fullAccess;
  const paid = open ? course.price : totalPaid;
  const withAccess = modules.map((module) => {
    const unlocked = open || paid >= module.unlockAmount;
    return {
      id: module.id,
      title: module.title,
      description: module.description,
      order: module.order,
      unlockAmount: module.unlockAmount,
      unlocked,
      lessonCount: module.lessonCount,
      duration: module.duration,
      status: unlocked ? "unlocked" : "locked",
    };
  });
  const next = withAccess.find((m) => !m.unlocked);
  const percentagePaid = course.price === 0 ? 100 : Math.min(100, (paid / course.price) * 100);
  return {
    modules: withAccess,
    progress: {
      coursePrice: course.price,
      totalPaid: paid,
      remaining: Math.max(0, course.price - paid),
      percentagePaid: Number(percentagePaid.toFixed(2)),
      unlockedModules: withAccess.filter((m) => m.unlocked).length,
      totalModules: withAccess.length,
      nextModule: next?.title ?? null,
      amountToUnlock: next ? Math.max(0, next.unlockAmount - paid) : null,
    },
  };
}

/** userId null = a guest browsing: nothing paid yet. */
export async function getCourseForUser(courseId: number, userId: number | null, opts: { includeUnpublished?: boolean } = {}) {
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, courseId)).limit(1);
  if (!course || (!course.published && !opts.includeUnpublished)) return undefined;
  const modules = await withRealLessonCounts(
    await db.select().from(modulesTable).where(eq(modulesTable.courseId, courseId)).orderBy(asc(modulesTable.order), asc(modulesTable.id)),
  );
  const enrolled = await db.select({ id: enrollmentsTable.id }).from(enrollmentsTable).where(eq(enrollmentsTable.courseId, courseId));
  const paid = userId === null ? 0 : await totalPaidForCourse(userId, courseId);
  const [grant] = userId === null ? [] : await db
    .select({ fullAccess: enrollmentsTable.fullAccess })
    .from(enrollmentsTable)
    .where(and(eq(enrollmentsTable.userId, userId), eq(enrollmentsTable.courseId, courseId)))
    .limit(1);
  const { modules: moduleAccess, progress } = progressFor(course, modules, paid, !!grant?.fullAccess);
  return {
    ...courseSummary(course, modules.reduce((n, m) => n + m.lessonCount, 0), enrolled.length),
    instructor: course.instructor,
    instructorRole: course.instructorRole,
    paymentPlan: { name: course.planName, amountPerDay: course.planAmountPerDay, description: course.planDescription },
    progress,
    modules: moduleAccess,
    overviewHtml: course.overviewHtml ?? "",
  };
}

export async function enroll(userId: number, courseId: number) {
  const [existing] = await db
    .select({ id: enrollmentsTable.id })
    .from(enrollmentsTable)
    .where(and(eq(enrollmentsTable.userId, userId), eq(enrollmentsTable.courseId, courseId)))
    .limit(1);
  if (!existing) await db.insert(enrollmentsTable).values({ userId, courseId, createdAt: new Date() });
}

export async function paymentsFor(where: { userId?: number } = {}) {
  const rows = await db
    .select({ payment: paymentsTable, courseTitle: coursesTable.title })
    .from(paymentsTable)
    .innerJoin(coursesTable, eq(paymentsTable.courseId, coursesTable.id))
    .where(where.userId ? eq(paymentsTable.userId, where.userId) : undefined)
    .orderBy(desc(paymentsTable.createdAt), desc(paymentsTable.id));
  return rows.map(({ payment, courseTitle }) => ({
    id: payment.id,
    userId: payment.userId,
    courseId: payment.courseId,
    courseTitle,
    amount: payment.amount,
    status: payment.status,
    date: payment.createdAt.toISOString(),
    phoneNumber: payment.phoneNumber,
    receipt: payment.receipt,
    checkoutRequestId: payment.checkoutRequestId,
  }));
}

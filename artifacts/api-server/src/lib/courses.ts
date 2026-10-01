import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  coursesTable, db, enrollmentsTable, lessonsTable, modulesTable, paymentsTable,
  type Course, type Module,
} from "@workspace/db";
import { getSiteSettings } from "../routes/site-settings";
import { type AccessRule, daysToFinish, type LessonForPricing, lessonAccess, type PricedLesson, priceLessons } from "./pricing";

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

/** A course's lessons in the order students meet them: by module, then by lesson. */
export async function courseLessons(modules: Module[]): Promise<LessonForPricing[]> {
  if (modules.length === 0) return [];
  const rows = await db
    .select({ id: lessonsTable.id, moduleId: lessonsTable.moduleId, title: lessonsTable.title, kind: lessonsTable.kind, priceOverride: lessonsTable.priceOverride })
    .from(lessonsTable)
    .where(inArray(lessonsTable.moduleId, modules.map((m) => m.id)))
    .orderBy(asc(lessonsTable.order), asc(lessonsTable.id));
  return modules.flatMap((m) => rows.filter((r) => r.moduleId === m.id));
}

/** Free courses and admin-granted places are open; "paid" courses open in one go; Lipa Pole Pole lesson by lesson. */
export const accessRule = (course: Course, fullAccess: boolean): AccessRule =>
  course.paymentModel === "free" || fullAccess ? "open" : course.paymentModel === "paid" ? "pay-in-full" : "pay-as-you-go";

/** fullAccess: an admin enrolled this student with the whole course unlocked (scholarship, staff). */
export function progressFor(course: Course, modules: Module[], lessons: PricedLesson[], totalPaid: number, fullAccess = false) {
  const rule = accessRule(course, fullAccess);
  const paid = rule === "open" ? course.price : totalPaid;
  const lessonsWithAccess = lessons.map((l) => ({
    id: l.id, moduleId: l.moduleId, title: l.title, kind: l.kind, price: l.price, opensAt: l.opensAt,
    ...lessonAccess(l, paid, rule, course.price),
  }));
  const withAccess = modules.map((module) => {
    const own = lessonsWithAccess.filter((l) => l.moduleId === module.id);
    // A module is open once any of its lessons is; a module without lessons yet keeps its old unlock amount.
    const unlocked = own.length ? own.some((l) => l.unlocked) : rule === "open" || paid >= module.unlockAmount;
    const amountToOpen = unlocked ? 0 : own.length ? own[0]!.amountToOpen : Math.max(0, module.unlockAmount - paid);
    return {
      id: module.id,
      title: module.title,
      description: module.description,
      order: module.order,
      // The total paid at which this module opens.
      unlockAmount: own.length ? own[0]!.opensAt : module.unlockAmount,
      unlocked,
      amountToOpen,
      lessonsOpen: own.filter((l) => l.unlocked).length,
      lessonCount: module.lessonCount,
      duration: module.duration,
      status: unlocked ? "unlocked" : "locked",
    };
  });
  const nextLesson = lessonsWithAccess.find((l) => !l.unlocked);
  const nextModule = withAccess.find((m) => !m.unlocked);
  const percentagePaid = course.price === 0 ? 100 : Math.min(100, (paid / course.price) * 100);
  return {
    modules: withAccess,
    lessons: lessonsWithAccess,
    progress: {
      coursePrice: course.price,
      totalPaid: paid,
      remaining: Math.max(0, course.price - paid),
      percentagePaid: Number(percentagePaid.toFixed(2)),
      unlockedModules: withAccess.filter((m) => m.unlocked).length,
      totalModules: withAccess.length,
      unlockedLessons: lessonsWithAccess.filter((l) => l.unlocked).length,
      totalLessons: lessonsWithAccess.length,
      nextLesson: nextLesson ? { id: nextLesson.id, title: nextLesson.title, moduleId: nextLesson.moduleId, amountToOpen: nextLesson.amountToOpen } : null,
      nextModule: nextLesson?.title ?? nextModule?.title ?? null,
      // The next thing a payment opens: the next lesson, or (before a course has lessons) the next module.
      amountToUnlock: nextLesson ? nextLesson.amountToOpen : nextModule ? nextModule.amountToOpen : null,
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
  const [mine] = userId === null ? [] : await db
    .select({ fullAccess: enrollmentsTable.fullAccess, planId: enrollmentsTable.planId })
    .from(enrollmentsTable)
    .where(and(eq(enrollmentsTable.userId, userId), eq(enrollmentsTable.courseId, courseId)))
    .limit(1);
  const { paymentPlans } = await getSiteSettings();
  const openStep = Math.min(...paymentPlans.map((p) => p.amountPerDay));
  const priced = priceLessons(course.price, await courseLessons(modules), openStep);
  const { modules: moduleAccess, lessons, progress } = progressFor(course, modules, priced, paid, !!mine?.fullAccess);
  // The plan the student picked (else the cheapest), and how long each plan takes to pay off the rest.
  const plans = paymentPlans.map((p) => ({ ...p, daysToFinish: daysToFinish(progress.remaining, p.amountPerDay) }));
  const plan = plans.find((p) => p.id === mine?.planId) ?? null;
  const shown = plan ?? plans.reduce((a, b) => (b.amountPerDay < a.amountPerDay ? b : a));
  return {
    ...courseSummary(course, modules.reduce((n, m) => n + m.lessonCount, 0), enrolled.length),
    instructor: course.instructor,
    instructorRole: course.instructorRole,
    paymentPlan: {
      name: shown.name,
      amountPerDay: shown.amountPerDay,
      description: course.paymentModel === "lipa_pole_pole"
        ? "Every payment opens the next lessons. Pay daily at your plan's pace, or more whenever you like."
        : course.planDescription,
    },
    plans,
    planId: plan?.id ?? null,
    progress,
    modules: moduleAccess,
    lessons,
    overviewHtml: course.overviewHtml ?? "",
    certificateRule: course.certificateRule,
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

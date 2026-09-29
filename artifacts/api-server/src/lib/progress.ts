// Learning progress: which activities a student has done, whether a course is finished, and
// awarding certificates by each course's rule.
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { coursesTable, db, lessonCompletionsTable, lessonsTable, modulesTable, quizAttemptsTable } from "@workspace/db";
import { awardIfEligible, getSettings, issueCertificate } from "./exams";

export type CertificateRule = "completion" | "exams" | "manual";

/** Every activity in a course, in order. */
export async function courseActivities(courseId: number) {
  return db.select({ id: lessonsTable.id, kind: lessonsTable.kind, moduleId: lessonsTable.moduleId })
    .from(lessonsTable).innerJoin(modulesTable, eq(lessonsTable.moduleId, modulesTable.id))
    .where(eq(modulesTable.courseId, courseId))
    .orderBy(asc(modulesTable.order), asc(lessonsTable.order));
}

/**
 * Which activities this student has done: reading activities once opened, exams once passed
 * (or, for practice exams that don't count towards the certificate, once submitted).
 */
export async function userProgress(userId: number, courseId: number) {
  const activities = await courseActivities(courseId);
  const ids = activities.map((a) => a.id);
  const done = new Set<number>();
  const examScores: number[] = [];
  if (ids.length) {
    const viewed = await db.select({ lessonId: lessonCompletionsTable.lessonId }).from(lessonCompletionsTable)
      .where(and(eq(lessonCompletionsTable.userId, userId), inArray(lessonCompletionsTable.lessonId, ids)));
    const quizIds = activities.filter((a) => a.kind === "quiz").map((a) => a.id);
    // Opening counts only for reading activities; exams are done through their attempts.
    for (const v of viewed) if (!quizIds.includes(v.lessonId)) done.add(v.lessonId);
    if (quizIds.length) {
      const attempts = await db.select({ lessonId: quizAttemptsTable.lessonId, passed: quizAttemptsTable.passed, percent: quizAttemptsTable.percent })
        .from(quizAttemptsTable)
        .where(and(eq(quizAttemptsTable.userId, userId), inArray(quizAttemptsTable.lessonId, quizIds), isNotNull(quizAttemptsTable.submittedAt)));
      for (const qid of quizIds) {
        const mine = attempts.filter((a) => a.lessonId === qid);
        const counts = (await getSettings(qid)).requiredForCertificate;
        if (counts ? mine.some((a) => a.passed) : mine.length > 0) done.add(qid);
        if (counts && mine.some((a) => a.passed)) examScores.push(Math.max(...mine.map((a) => a.percent ?? 0)));
      }
    }
  }
  const total = activities.length;
  const count = activities.filter((a) => done.has(a.id)).length;
  return {
    total, done: count, doneIds: done,
    percent: total ? Math.round((count / total) * 100) : 0,
    complete: total > 0 && count === total,
    averageExamScore: examScores.length ? Math.round((examScores.reduce((a, b) => a + b, 0) / examScores.length) * 10) / 10 : null,
    modules: [...new Set(activities.map((a) => a.moduleId))].map((moduleId) => {
      const mine = activities.filter((a) => a.moduleId === moduleId);
      return { moduleId, total: mine.length, done: mine.filter((a) => done.has(a.id)).length };
    }),
  };
}

/** Records that a student opened a reading activity (pages, files, links, packages). */
export async function markViewed(userId: number, lessonId: number) {
  await db.insert(lessonCompletionsTable).values({ userId, lessonId, completedAt: new Date() })
    .onDuplicateKeyUpdate({ set: { userId } });
}

/** Issues the course certificate if this student now meets the course's rule. */
export async function checkCompletion(userId: number, courseId: number) {
  const [course] = await db.select({ rule: coursesTable.certificateRule }).from(coursesTable).where(eq(coursesTable.id, courseId)).limit(1);
  const rule = (course?.rule ?? "completion") as CertificateRule;
  if (rule === "manual") return null;
  if (rule === "exams") return awardIfEligible(userId, courseId);
  const progress = await userProgress(userId, courseId);
  if (!progress.complete) return null;
  return issueCertificate(userId, courseId, "auto", progress.averageExamScore);
}

/** Consecutive days (Nairobi time) with learning activity, ending today or yesterday. */
export async function learningStreak(userId: number) {
  const views = await db.select({ at: lessonCompletionsTable.completedAt }).from(lessonCompletionsTable).where(eq(lessonCompletionsTable.userId, userId));
  const exams = await db.select({ at: quizAttemptsTable.submittedAt }).from(quizAttemptsTable)
    .where(and(eq(quizAttemptsTable.userId, userId), isNotNull(quizAttemptsTable.submittedAt)));
  const day = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
  const days = new Set([...views.map((v) => day(v.at)), ...exams.map((e) => day(e.at!))]);
  const cursor = new Date();
  if (!days.has(day(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (days.has(day(cursor))) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 1); }
  return streak;
}

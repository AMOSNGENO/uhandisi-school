import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { certificatesTable, db, enrollmentsTable, lessonsTable, modulesTable, quizAttemptsTable, usersTable } from "@workspace/db";
import { requireAdmin, requireAuth } from "../lib/auth";
import { lessonForViewer } from "../lib/access";
import { publicOrigin } from "../lib/mailer";
import { userProgress } from "../lib/progress";
import { renderCertificate } from "./admin-certificates";
import {
  attemptResult, certificateExams, ExamError, getQuestions, getSettings, issueCertificate, quizOverview, saveAnswers, saveQuiz,
  startAttempt, submitAttempt,
} from "../lib/exams";

const router: IRouter = Router();
const Id = z.coerce.number().int().positive();
const idOf = (v: unknown) => {
  const r = Id.safeParse(v);
  if (!r.success) throw new ExamError(400, "Invalid id.");
  return r.data;
};

function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out);
    } catch (e) {
      if (e instanceof ExamError) res.status(e.status).json({ error: e.message });
      else { req.log.error({ err: e }, "exam route failed"); res.status(500).json({ error: "Something went wrong. Try again." }); }
    }
  };
}

async function checkAccess(req: Request, lessonId: number) {
  if (!Number.isInteger(lessonId) || !(await lessonForViewer(req.user!, lessonId))) throw new ExamError(403, "This exam is locked. Unlock its section first.");
}

// ---------------------------------------------------------------- Students

router.get("/quizzes/:lessonId", requireAuth, handle(async (req) => {
  const id = Number(req.params.lessonId);
  await checkAccess(req, id);
  return quizOverview(id, req.user!.id);
}));

router.post("/quizzes/:lessonId/attempts", requireAuth, handle(async (req) => {
  const id = Number(req.params.lessonId);
  await checkAccess(req, id);
  return startAttempt(id, req.user!.id);
}));

router.patch("/attempts/:id", requireAuth, handle(async (req) => {
  await saveAnswers(Number(req.params.id), req.user!.id, req.body?.answers);
  return { saved: true };
}));

router.post("/attempts/:id/submit", requireAuth, handle(async (req) => submitAttempt(Number(req.params.id), req.user!.id, req.body?.answers)));

router.get("/attempts/:id", requireAuth, handle(async (req) => attemptResult(Number(req.params.id), req.user!.id)));

router.get("/certificates/mine", requireAuth, handle(async (req) => {
  const rows = await db.select().from(certificatesTable)
    .where(and(eq(certificatesTable.userId, req.user!.id), isNull(certificatesTable.revokedAt))).orderBy(desc(certificatesTable.issuedAt));
  return rows.map((c) => ({ code: c.code, courseId: c.courseId, courseTitle: c.courseTitle, percent: c.percent, issuedAt: c.issuedAt.toISOString() }));
}));

// The certificate's owner and admins can download it.
router.get("/certificates/:code/pdf", requireAuth, handle(async (req, res) => {
  const [cert] = await db.select().from(certificatesTable).where(eq(certificatesTable.code, String(req.params.code))).limit(1);
  if (!cert || cert.revokedAt || (cert.userId !== req.user!.id && req.user!.role !== "admin")) throw new ExamError(404, "Certificate not found.");
  const pdf = await renderCertificate(cert, `${publicOrigin(req)}/verify/${cert.code}`);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${req.query.inline !== undefined ? "inline" : "attachment"}; filename="Uhandisi-certificate-${cert.code}.pdf"`);
  res.send(pdf);
}));

// Anyone (e.g. an employer) can check a certificate by its code.
router.get("/certificates/verify/:code", handle(async (req) => {
  const [cert] = await db.select().from(certificatesTable).where(eq(certificatesTable.code, String(req.params.code).toUpperCase())).limit(1);
  if (!cert) return { valid: false };
  return {
    valid: !cert.revokedAt, revoked: !!cert.revokedAt, code: cert.code, studentName: cert.studentName, courseTitle: cert.courseTitle,
    percent: cert.percent, issuedAt: cert.issuedAt.toISOString(),
  };
}));

// ---------------------------------------------------------------- Admin

const SettingsBody = z.object({
  passMark: z.number().int().min(0).max(100),
  timeLimitMinutes: z.number().int().min(1).max(600).nullable(),
  maxAttempts: z.number().int().min(1).max(100).nullable(),
  shuffle: z.boolean(),
  showAnswers: z.enum(["after_submit", "after_pass", "never"]),
  requiredForCertificate: z.boolean(),
});
const QuestionBody = z.object({
  id: z.number().int().positive().optional(),
  type: z.enum(["single", "multiple"]),
  text: z.string().max(10_000),
  points: z.number().int(),
  explanation: z.string().max(10_000).nullable().optional(),
  options: z.array(z.object({ id: z.number().int().positive().optional(), text: z.string().max(2_000), correct: z.boolean() })).max(20),
});

router.get("/admin/lessons/:id/quiz", requireAdmin, handle(async (req) => {
  const id = idOf(req.params.id);
  const questions = await getQuestions(id);
  return {
    settings: await getSettings(id),
    questions: questions.map((q) => ({ id: q.id, type: q.type, text: q.text, points: q.points, explanation: q.explanation, options: q.options.map((o) => ({ id: o.id, text: o.text, correct: o.isCorrect })) })),
  };
}));

router.put("/admin/lessons/:id/quiz", requireAdmin, handle(async (req) => {
  const id = idOf(req.params.id);
  const body = z.object({ settings: SettingsBody, questions: z.array(QuestionBody).max(300) }).safeParse(req.body);
  if (!body.success) throw new ExamError(400, "Some exam settings are invalid: " + body.error.issues[0]?.message);
  const [lesson] = await db.select({ kind: lessonsTable.kind }).from(lessonsTable).where(eq(lessonsTable.id, id)).limit(1);
  if (!lesson || lesson.kind !== "quiz") throw new ExamError(404, "Exam not found.");
  await saveQuiz(id, body.data.settings, body.data.questions);
  return { saved: true, questions: (await getQuestions(id)).length };
}));

router.get("/admin/lessons/:id/attempts", requireAdmin, handle(async (req) => {
  const id = idOf(req.params.id);
  const rows = await db.select({ a: quizAttemptsTable, name: usersTable.name, email: usersTable.email }).from(quizAttemptsTable)
    .innerJoin(usersTable, eq(quizAttemptsTable.userId, usersTable.id))
    .where(and(eq(quizAttemptsTable.lessonId, id), isNotNull(quizAttemptsTable.submittedAt))).orderBy(desc(quizAttemptsTable.submittedAt));
  return rows.map(({ a, name, email }) => ({ id: a.id, name, email, submittedAt: a.submittedAt!.toISOString(), percent: a.percent, passed: !!a.passed, score: a.scorePoints, maxScore: a.maxPoints }));
}));

// Gradebook: each learner's best result per exam, and their certificate.
router.get("/admin/courses/:id/results", requireAdmin, handle(async (req) => {
  const courseId = idOf(req.params.id);
  const exams = await certificateExams(courseId);
  const allQuizIds = (await db.select({ id: lessonsTable.id, title: lessonsTable.title }).from(lessonsTable)
    .innerJoin(modulesTable, eq(lessonsTable.moduleId, modulesTable.id))
    .where(and(eq(modulesTable.courseId, courseId), eq(lessonsTable.kind, "quiz")))
    .orderBy(asc(modulesTable.order), asc(lessonsTable.order)));
  const quizIds = allQuizIds.map((q) => q.id);
  const attempts = quizIds.length ? await db.select().from(quizAttemptsTable)
    .where(and(inArray(quizAttemptsTable.lessonId, quizIds), isNotNull(quizAttemptsTable.submittedAt))) : [];
  const enrolled = await db.select({ userId: enrollmentsTable.userId }).from(enrollmentsTable).where(eq(enrollmentsTable.courseId, courseId));
  const userIds = [...new Set([...enrolled.map((e) => e.userId), ...attempts.map((a) => a.userId)])];
  const users = userIds.length ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, userIds)) : [];
  const certs = await db.select().from(certificatesTable).where(and(eq(certificatesTable.courseId, courseId), isNull(certificatesTable.revokedAt)));
  const progressBy = new Map<number, { done: number; total: number; percent: number }>();
  for (const u of users) { const p = await userProgress(u.id, courseId); progressBy.set(u.id, { done: p.done, total: p.total, percent: p.percent }); }
  return {
    quizzes: allQuizIds.map((q) => ({ ...q, countsForCertificate: exams.some((e) => e.id === q.id) })),
    students: users.sort((a, b) => a.name.localeCompare(b.name)).map((u) => {
      const results = Object.fromEntries(quizIds.map((qid) => {
        const mine = attempts.filter((a) => a.userId === u.id && a.lessonId === qid);
        if (!mine.length) return [qid, null];
        return [qid, { best: Math.max(...mine.map((a) => a.percent ?? 0)), passed: mine.some((a) => a.passed), attempts: mine.length }];
      }));
      const cert = certs.find((c) => c.userId === u.id);
      return { ...u, results, progress: progressBy.get(u.id), certificate: cert ? { id: cert.id, code: cert.code, issuedBy: cert.issuedBy, issuedAt: cert.issuedAt.toISOString() } : null };
    }),
  };
}));

router.post("/admin/courses/:id/certificates", requireAdmin, handle(async (req) => {
  const courseId = idOf(req.params.id);
  const userId = idOf(req.body?.userId);
  const cert = await issueCertificate(userId, courseId, "admin", null);
  return { code: cert.code };
}));

router.delete("/admin/certificates/:id", requireAdmin, handle(async (req) => {
  await db.update(certificatesTable).set({ revokedAt: new Date() }).where(eq(certificatesTable.id, idOf(req.params.id)));
  return { revoked: true };
}));

export default router;

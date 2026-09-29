// Exams (Moodle-style quizzes) and certificates. Grading happens only here: students never
// receive which options are correct until their attempt is submitted (and only if allowed).
import { randomBytes, randomInt } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  certificatesTable, coursesTable, db, lessonsTable, modulesTable, questionOptionsTable, questionsTable,
  quizAttemptsTable, quizSettingsTable, usersTable,
} from "@workspace/db";
import { checkCompletion } from "./progress";
import { enroll } from "./courses";

export type QuizSettings = {
  passMark: number; timeLimitMinutes: number | null; maxAttempts: number | null; shuffle: boolean;
  showAnswers: "after_submit" | "after_pass" | "never"; requiredForCertificate: boolean;
};
export const defaultSettings: QuizSettings = {
  passMark: 50, timeLimitMinutes: null, maxAttempts: null, shuffle: false, showAnswers: "after_submit", requiredForCertificate: true,
};
export type QuestionInput = {
  id?: number; type: "single" | "multiple"; text: string; points: number; explanation?: string | null;
  options: Array<{ id?: number; text: string; correct: boolean }>;
};

// Submissions this long after the deadline are still accepted (slow networks).
const GRACE_MS = 60_000;

export class ExamError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function getSettings(lessonId: number): Promise<QuizSettings> {
  const [s] = await db.select().from(quizSettingsTable).where(eq(quizSettingsTable.lessonId, lessonId)).limit(1);
  return s ? { ...defaultSettings, ...s, showAnswers: s.showAnswers as QuizSettings["showAnswers"] } : defaultSettings;
}

/** Questions with their options (including which are correct). Admin/grading use only. */
export async function getQuestions(lessonId: number) {
  const questions = await db.select().from(questionsTable).where(eq(questionsTable.lessonId, lessonId)).orderBy(asc(questionsTable.order), asc(questionsTable.id));
  if (questions.length === 0) return [];
  const options = await db.select().from(questionOptionsTable)
    .where(inArray(questionOptionsTable.questionId, questions.map((q) => q.id)))
    .orderBy(asc(questionOptionsTable.order), asc(questionOptionsTable.id));
  return questions.map((q) => ({ ...q, options: options.filter((o) => o.questionId === q.id) }));
}

export function validateQuestions(questions: QuestionInput[]) {
  questions.forEach((q, i) => {
    const n = `Question ${i + 1}`;
    if (!q.text.trim()) throw new ExamError(400, `${n} has no text.`);
    const opts = q.options.filter((o) => o.text.trim());
    if (opts.length < 2) throw new ExamError(400, `${n} needs at least two answer options.`);
    const right = opts.filter((o) => o.correct).length;
    if (q.type === "single" && right !== 1) throw new ExamError(400, `${n} is single-answer, so exactly one option must be marked correct.`);
    if (q.type === "multiple" && right < 1) throw new ExamError(400, `${n} needs at least one correct option.`);
    if (!(q.points >= 1 && q.points <= 100)) throw new ExamError(400, `${n}: points must be between 1 and 100.`);
  });
}

/** Saves settings and the full question list: existing ids are updated, new ones added, missing ones removed. */
export async function saveQuiz(lessonId: number, settings: QuizSettings, questions: QuestionInput[]) {
  validateQuestions(questions);
  await db.transaction(async (tx) => {
    await tx.insert(quizSettingsTable).values({ lessonId, ...settings }).onDuplicateKeyUpdate({ set: settings });
    const existing = await tx.select({ id: questionsTable.id }).from(questionsTable).where(eq(questionsTable.lessonId, lessonId));
    const keep = new Set(questions.map((q) => q.id).filter(Boolean));
    const gone = existing.map((e) => e.id).filter((id) => !keep.has(id));
    if (gone.length) await tx.delete(questionsTable).where(inArray(questionsTable.id, gone));
    for (const [i, q] of questions.entries()) {
      const fields = { lessonId, order: i + 1, type: q.type, text: q.text.trim(), points: Math.round(q.points), explanation: q.explanation?.trim() || null };
      let qid = q.id && existing.some((e) => e.id === q.id) ? q.id : undefined;
      if (qid) await tx.update(questionsTable).set(fields).where(eq(questionsTable.id, qid));
      else qid = (await tx.insert(questionsTable).values(fields))[0].insertId;
      // Options keep their ids, so students in the middle of an attempt aren't affected by an edit.
      const opts = q.options.filter((o) => o.text.trim());
      const current = await tx.select({ id: questionOptionsTable.id }).from(questionOptionsTable).where(eq(questionOptionsTable.questionId, qid));
      const keepOpts = new Set(opts.map((o) => o.id).filter((id) => id && current.some((c) => c.id === id)));
      const dropOpts = current.map((c) => c.id).filter((id) => !keepOpts.has(id));
      if (dropOpts.length) await tx.delete(questionOptionsTable).where(inArray(questionOptionsTable.id, dropOpts));
      for (const [j, o] of opts.entries()) {
        const optFields = { questionId: qid, order: j + 1, text: o.text.trim(), isCorrect: o.correct };
        if (o.id && keepOpts.has(o.id)) await tx.update(questionOptionsTable).set(optFields).where(eq(questionOptionsTable.id, o.id));
        else await tx.insert(questionOptionsTable).values(optFields);
      }
    }
  });
}

type Layout = Array<{ q: number; o: number[] }>;
type Answers = Record<string, number[]>;

function shuffled<T>(list: T[]) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

async function quizLesson(lessonId: number) {
  const [l] = await db.select({ id: lessonsTable.id, kind: lessonsTable.kind, title: lessonsTable.title, courseId: modulesTable.courseId })
    .from(lessonsTable).innerJoin(modulesTable, eq(lessonsTable.moduleId, modulesTable.id)).where(eq(lessonsTable.id, lessonId)).limit(1);
  if (!l || l.kind !== "quiz") throw new ExamError(404, "Exam not found.");
  return l;
}

/** What a student sees before starting: rules, their attempts, best result. No questions. */
export async function quizOverview(lessonId: number, userId: number) {
  const lesson = await quizLesson(lessonId);
  const settings = await getSettings(lessonId);
  const questions = await getQuestions(lessonId);
  const attempts = await db.select().from(quizAttemptsTable)
    .where(and(eq(quizAttemptsTable.lessonId, lessonId), eq(quizAttemptsTable.userId, userId))).orderBy(desc(quizAttemptsTable.id));
  const finished = attempts.filter((a) => a.submittedAt);
  const open = attempts.find((a) => !a.submittedAt && (!a.deadline || a.deadline.getTime() + GRACE_MS > Date.now()));
  const best = finished.reduce<number | null>((m, a) => (a.percent !== null && (m === null || a.percent > m) ? a.percent : m), null);
  const cert = await activeCertificate(userId, lesson.courseId);
  return {
    title: lesson.title, settings, questionCount: questions.length,
    totalPoints: questions.reduce((n, q) => n + q.points, 0),
    attemptsUsed: finished.length,
    attemptsLeft: settings.maxAttempts === null ? null : Math.max(0, settings.maxAttempts - finished.length),
    best, passed: finished.some((a) => a.passed),
    openAttemptId: open?.id ?? null,
    attempts: finished.map((a) => ({ id: a.id, submittedAt: a.submittedAt!.toISOString(), percent: a.percent, passed: !!a.passed })),
    certificate: cert ? { code: cert.code } : null,
  };
}

/** Starts (or resumes) an attempt and returns its questions without any answer key. */
export async function startAttempt(lessonId: number, userId: number) {
  const lesson = await quizLesson(lessonId);
  // Taking an exam means taking part in the course (no-op if already enrolled).
  await enroll(userId, lesson.courseId);
  const settings = await getSettings(lessonId);
  const questions = await getQuestions(lessonId);
  if (questions.length === 0) throw new ExamError(400, "This exam has no questions yet.");
  const mine = await db.select().from(quizAttemptsTable).where(and(eq(quizAttemptsTable.lessonId, lessonId), eq(quizAttemptsTable.userId, userId)));
  let attempt = mine.find((a) => !a.submittedAt);
  if (attempt && attempt.deadline && attempt.deadline.getTime() + GRACE_MS < Date.now()) {
    await submitAttempt(attempt.id, userId); // time ran out while away: mark what was saved
    attempt = undefined;
  }
  if (!attempt) {
    const used = (await db.select({ id: quizAttemptsTable.id }).from(quizAttemptsTable)
      .where(and(eq(quizAttemptsTable.lessonId, lessonId), eq(quizAttemptsTable.userId, userId), isNotNull(quizAttemptsTable.submittedAt)))).length;
    if (settings.maxAttempts !== null && used >= settings.maxAttempts) throw new ExamError(403, "You have used all your attempts for this exam.");
    const order = settings.shuffle ? shuffled(questions) : questions;
    const layout: Layout = order.map((q) => ({ q: q.id, o: (settings.shuffle ? shuffled(q.options) : q.options).map((o) => o.id) }));
    const now = new Date();
    const deadline = settings.timeLimitMinutes ? new Date(now.getTime() + settings.timeLimitMinutes * 60_000) : null;
    const [r] = await db.insert(quizAttemptsTable).values({ lessonId, userId, startedAt: now, deadline, layout: JSON.stringify(layout), answers: "{}" });
    [attempt] = await db.select().from(quizAttemptsTable).where(eq(quizAttemptsTable.id, r.insertId)).limit(1);
  }
  const byId = new Map(questions.map((q) => [q.id, q]));
  const layout = JSON.parse(attempt!.layout) as Layout;
  return {
    id: attempt!.id,
    deadline: attempt!.deadline?.toISOString() ?? null,
    serverNow: new Date().toISOString(),
    answers: JSON.parse(attempt!.answers || "{}") as Answers,
    questions: layout.filter((l) => byId.has(l.q)).map((l) => {
      const q = byId.get(l.q)!;
      const opts = new Map(q.options.map((o) => [o.id, o]));
      return { id: q.id, type: q.type, text: q.text, points: q.points, options: l.o.filter((id) => opts.has(id)).map((id) => ({ id, text: opts.get(id)!.text })) };
    }),
  };
}

async function ownAttempt(attemptId: number, userId: number) {
  const [a] = await db.select().from(quizAttemptsTable).where(eq(quizAttemptsTable.id, attemptId)).limit(1);
  if (!a || a.userId !== userId) throw new ExamError(404, "Attempt not found.");
  return a;
}

const cleanAnswers = (answers: unknown): Answers => {
  const out: Answers = {};
  if (answers && typeof answers === "object") {
    for (const [k, v] of Object.entries(answers as Record<string, unknown>)) {
      if (/^\d+$/.test(k) && Array.isArray(v)) out[k] = v.filter((x) => Number.isInteger(x)).slice(0, 50) as number[];
    }
  }
  return out;
};

/** Autosave while answering. Refused once the attempt is submitted or out of time. */
export async function saveAnswers(attemptId: number, userId: number, answers: unknown) {
  const a = await ownAttempt(attemptId, userId);
  if (a.submittedAt) throw new ExamError(409, "This attempt has already been submitted.");
  if (a.deadline && a.deadline.getTime() + GRACE_MS < Date.now()) throw new ExamError(409, "Time is up for this attempt.");
  await db.update(quizAttemptsTable).set({ answers: JSON.stringify(cleanAnswers(answers)) }).where(eq(quizAttemptsTable.id, attemptId));
}

/** Marks one question: single = right or wrong; multiple = (right ticks − wrong ticks) ÷ correct options. */
export function markQuestion(type: string, correctIds: number[], chosen: number[]) {
  const correct = new Set(correctIds);
  const picked = [...new Set(chosen)];
  if (correct.size === 0) return 0;
  if (type === "single") return picked.length === 1 && correct.has(picked[0]!) ? 1 : 0;
  const right = picked.filter((id) => correct.has(id)).length;
  const wrong = picked.length - right;
  return Math.max(0, (right - wrong) / correct.size);
}

export async function submitAttempt(attemptId: number, userId: number, answers?: unknown) {
  const a = await ownAttempt(attemptId, userId);
  if (a.submittedAt) return attemptResult(attemptId, userId);
  const late = !!a.deadline && a.deadline.getTime() + GRACE_MS < Date.now();
  // After the deadline only answers saved in time count.
  const given = answers !== undefined && !late ? cleanAnswers(answers) : (JSON.parse(a.answers || "{}") as Answers);
  const settings = await getSettings(a.lessonId);
  const questions = new Map((await getQuestions(a.lessonId)).map((q) => [q.id, q]));
  const layout = JSON.parse(a.layout) as Layout;
  let score = 0;
  let max = 0;
  const review = layout.filter((l) => questions.has(l.q)).map((l) => {
    const q = questions.get(l.q)!;
    const chosen = (given[String(q.id)] ?? []).filter((id) => q.options.some((o) => o.id === id));
    const fraction = markQuestion(q.type, q.options.filter((o) => o.isCorrect).map((o) => o.id), chosen);
    score += fraction * q.points;
    max += q.points;
    const byId = new Map(q.options.map((o) => [o.id, o]));
    return {
      questionId: q.id, type: q.type, text: q.text, points: q.points, earned: Math.round(fraction * q.points * 100) / 100,
      explanation: q.explanation, chosen,
      options: l.o.filter((id) => byId.has(id)).map((id) => ({ id, text: byId.get(id)!.text, correct: byId.get(id)!.isCorrect })),
    };
  });
  const percent = max ? Math.round((score / max) * 1000) / 10 : 0;
  const passed = percent >= settings.passMark;
  const [done] = await db.update(quizAttemptsTable).set({
    submittedAt: new Date(), answers: JSON.stringify(given), scorePoints: Math.round(score * 100) / 100, maxPoints: max,
    percent, passed, review: JSON.stringify(review),
  }).where(and(eq(quizAttemptsTable.id, attemptId), isNull(quizAttemptsTable.submittedAt)));
  if (done.affectedRows) await checkCompletion(userId, (await quizLesson(a.lessonId)).courseId);
  return attemptResult(attemptId, userId);
}

/** A finished attempt's result, with the answer review if the exam's settings allow it. */
export async function attemptResult(attemptId: number, userId: number) {
  const a = await ownAttempt(attemptId, userId);
  if (!a.submittedAt) throw new ExamError(409, "This attempt hasn't been submitted yet.");
  const settings = await getSettings(a.lessonId);
  const showReview = settings.showAnswers === "after_submit" || (settings.showAnswers === "after_pass" && !!a.passed);
  const lesson = await quizLesson(a.lessonId);
  const cert = await activeCertificate(userId, lesson.courseId);
  return {
    id: a.id, lessonId: a.lessonId, submittedAt: a.submittedAt.toISOString(), percent: a.percent ?? 0, passed: !!a.passed,
    score: a.scorePoints ?? 0, maxScore: a.maxPoints ?? 0, passMark: settings.passMark,
    review: showReview ? JSON.parse(a.review || "[]") : null,
    reviewHidden: !showReview ? (settings.showAnswers === "after_pass" ? "Correct answers are shown once you pass." : "Correct answers aren't shown for this exam.") : null,
    certificate: cert ? { code: cert.code } : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------------------------

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => "UHS-" + Array.from(randomBytes(8), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");

export async function activeCertificate(userId: number, courseId: number) {
  const [c] = await db.select().from(certificatesTable)
    .where(and(eq(certificatesTable.userId, userId), eq(certificatesTable.courseId, courseId), isNull(certificatesTable.revokedAt))).limit(1);
  return c;
}

/** The exams in a course that count towards its certificate. */
export async function certificateExams(courseId: number) {
  const quizzes = await db.select({ id: lessonsTable.id, title: lessonsTable.title })
    .from(lessonsTable).innerJoin(modulesTable, eq(lessonsTable.moduleId, modulesTable.id))
    .where(and(eq(modulesTable.courseId, courseId), eq(lessonsTable.kind, "quiz")))
    .orderBy(asc(modulesTable.order), asc(lessonsTable.order));
  const out = [];
  for (const q of quizzes) if ((await getSettings(q.id)).requiredForCertificate) out.push(q);
  return out;
}

/** Best percent per exam for a user, or null where never passed. */
async function bestPassed(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return new Map<number, number>();
  const rows = await db.select({ lessonId: quizAttemptsTable.lessonId, percent: quizAttemptsTable.percent }).from(quizAttemptsTable)
    .where(and(eq(quizAttemptsTable.userId, userId), inArray(quizAttemptsTable.lessonId, lessonIds), eq(quizAttemptsTable.passed, true)));
  const best = new Map<number, number>();
  for (const r of rows) best.set(r.lessonId, Math.max(best.get(r.lessonId) ?? 0, r.percent ?? 0));
  return best;
}

export async function issueCertificate(userId: number, courseId: number, issuedBy: "auto" | "admin", percent: number | null) {
  const existing = await activeCertificate(userId, courseId);
  if (existing) return existing;
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const [course] = await db.select({ title: coursesTable.title }).from(coursesTable).where(eq(coursesTable.id, courseId)).limit(1);
  if (!user || !course) throw new ExamError(404, "Student or course not found.");
  for (let tries = 0; tries < 5; tries++) {
    try {
      await db.insert(certificatesTable).values({
        code: newCode(), userId, courseId, studentName: user.name, courseTitle: course.title, percent, issuedBy, issuedAt: new Date(),
      });
      return (await activeCertificate(userId, courseId))!;
    } catch (e) {
      if ((e as { code?: string }).code !== "ER_DUP_ENTRY") throw e; // code collision: try another
    }
  }
  throw new ExamError(500, "Could not create a certificate code.");
}

/** Issued automatically once every certificate exam in the course is passed. */
export async function awardIfEligible(userId: number, courseId: number) {
  const exams = await certificateExams(courseId);
  if (exams.length === 0) return null;
  const best = await bestPassed(userId, exams.map((e) => e.id));
  if (!exams.every((e) => best.has(e.id))) return null;
  const avg = Math.round((exams.reduce((n, e) => n + best.get(e.id)!, 0) / exams.length) * 10) / 10;
  return issueCertificate(userId, courseId, "auto", avg);
}

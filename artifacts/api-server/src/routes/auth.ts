import { Router, type IRouter } from "express";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, hashPassword, sessionsTable, usersTable, verifyPassword } from "@workspace/db";
import { endSession, requireAuth, SESSION_COOKIE, startSession, toPublicUser } from "../lib/auth";
import { CODE_TTL_MINUTES, createResetCode, resetWithCode, sendResetCodeEmail } from "../lib/password-reset";

const router: IRouter = Router();

const RegisterBody = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(190),
  phone: z.string().trim().max(30).optional(),
  password: z.string().min(8).max(200),
});

const LoginBody = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1),
});

router.post("/auth/register", async (req, res) => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your name, a valid email and a password of at least 8 characters." });
    return;
  }
  const { name, email, phone, password } = parsed.data;
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }
  // New sign-ups are always students; admins grant other roles from the dashboard.
  const [result] = await db.insert(usersTable).values({
    name, email, phone: phone || null, passwordHash: await hashPassword(password), role: "student", active: true, createdAt: new Date(),
  });
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, result.insertId)).limit(1);
  await startSession(res, user!.id);
  res.status(201).json(toPublicUser(user!));
});

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your email and password." });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.data.email)).limit(1);
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Wrong email or password." });
    return;
  }
  if (!user.active) {
    res.status(403).json({ error: "This account has been disabled. Contact support." });
    return;
  }
  await startSession(res, user.id);
  res.json(toPublicUser(user));
});

router.post("/auth/logout", async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});

router.get("/auth/me", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not logged in." });
    return;
  }
  res.json(req.user);
});

// Students edit their own name and phone; the email is their login, so only an admin changes it.
router.patch("/auth/me", requireAuth, async (req, res) => {
  const body = z.object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(30).nullable().optional(),
  }).safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Enter your full name (at least 2 characters)." });
  const changes = { ...body.data, ...(body.data.phone !== undefined ? { phone: body.data.phone || null } : {}) };
  if (Object.keys(changes).length) await db.update(usersTable).set(changes).where(eq(usersTable.id, req.user!.id));
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
  res.json(toPublicUser(user!));
});

const NewPassword = z.string().min(8, "The new password must be at least 8 characters.").max(200);

// Changing the password keeps this browser signed in and logs every other device out.
router.post("/auth/password", requireAuth, async (req, res) => {
  const body = z.object({ currentPassword: z.string().min(1, "Enter your current password."), newPassword: NewPassword }).safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.issues[0]!.message });
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
  if (!user || !(await verifyPassword(body.data.currentPassword, user.passwordHash))) {
    return void res.status(400).json({ error: "Your current password is not right." });
  }
  await db.update(usersTable).set({ passwordHash: await hashPassword(body.data.newPassword) }).where(eq(usersTable.id, user.id));
  const current = req.cookies?.[SESSION_COOKIE];
  await db.delete(sessionsTable).where(and(eq(sessionsTable.userId, user.id), typeof current === "string" ? ne(sessionsTable.id, current) : undefined));
  res.status(204).end();
});

// Forgot password: emails a 6-digit code. The reply is the same whether or not the email has an
// account, so this can't be used to find out who studies here.
const forgotHits = new Map<string, number[]>();
router.post("/auth/forgot-password", async (req, res) => {
  const ip = req.ip ?? "?";
  const now = Date.now();
  const hits = (forgotHits.get(ip) ?? []).filter((t) => now - t < 15 * 60 * 1000);
  if (hits.length >= 10) return void res.status(429).json({ error: "Too many requests. Wait a few minutes and try again." });
  if (forgotHits.size > 5000) forgotHits.clear();
  forgotHits.set(ip, [...hits, now]);

  const email = z.string().trim().toLowerCase().email().max(190).safeParse(req.body?.email);
  if (!email.success) return void res.status(400).json({ error: "Enter the email address you signed up with." });
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.data)).limit(1);
  if (user?.active) {
    const code = await createResetCode(user.id);
    if (code) await sendResetCodeEmail(user, code);
  }
  res.json({ ok: true, minutes: CODE_TTL_MINUTES });
});

// The code from the email plus a new password; a right code signs the person straight in.
const resetHits = new Map<string, number[]>();
router.post("/auth/reset-password", async (req, res) => {
  const ip = req.ip ?? "?";
  const now = Date.now();
  const hits = (resetHits.get(ip) ?? []).filter((t) => now - t < 15 * 60 * 1000);
  if (hits.length >= 20) return void res.status(429).json({ error: "Too many tries. Wait a few minutes and try again." });
  if (resetHits.size > 5000) resetHits.clear();
  resetHits.set(ip, [...hits, now]);

  const body = z.object({
    email: z.string().trim().toLowerCase().email("Enter the email address you signed up with.").max(190),
    code: z.string().transform((c) => c.replace(/\s/g, "")),
    password: NewPassword,
  }).safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.issues[0]!.message });
  const result = await resetWithCode(body.data.email, body.data.code, body.data.password);
  if ("error" in result) return void res.status(400).json({ error: result.error });
  await startSession(res, result.user.id);
  res.json(toPublicUser(result.user));
});

export default router;

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, hashPassword, usersTable, verifyPassword } from "@workspace/db";
import { endSession, startSession, toPublicUser } from "../lib/auth";

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

export default router;

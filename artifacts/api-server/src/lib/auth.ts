import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, sessionsTable, usersTable, type User } from "@workspace/db";

export const SESSION_COOKIE = "uhandisi_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type PublicUser = Pick<User, "id" | "name" | "email" | "phone" | "role">;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role };
}

export async function startSession(res: Response, userId: number) {
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessionsTable).values({ id, userId, expiresAt });
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function endSession(req: Request, res: Response) {
  const id = req.cookies?.[SESSION_COOKIE];
  if (typeof id === "string") await db.delete(sessionsTable).where(eq(sessionsTable.id, id));
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** Attaches req.user when the request carries a valid session cookie. Never rejects. */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const id = req.cookies?.[SESSION_COOKIE];
  if (typeof id === "string" && id.length === 64) {
    const [row] = await db
      .select({ user: usersTable })
      .from(sessionsTable)
      .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
      .where(and(eq(sessionsTable.id, id), gt(sessionsTable.expiresAt, new Date())))
      .limit(1);
    if (row && row.user.active) req.user = toPublicUser(row.user);
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Please log in." });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Please log in." });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admins only." });
    return;
  }
  next();
}

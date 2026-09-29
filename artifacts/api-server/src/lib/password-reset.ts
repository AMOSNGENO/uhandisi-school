import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, hashPassword, passwordResetsTable, sessionsTable, usersTable, type User } from "@workspace/db";
import { sendMail } from "./mailer";

const RESET_TTL_MS = 60 * 60 * 1000;
// At most this many unused links per person per hour, so nobody can flood an inbox.
const MAX_PER_HOUR = 3;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const resetUrl = (origin: string, token: string) => `${origin}/reset-password?token=${token}`;

/** Creates a one-time reset link for the user; null when they already asked too often this hour. */
export async function createResetToken(userId: number, { force = false } = {}) {
  if (!force) {
    const [recent] = await db.select({ n: sql<number>`COUNT(*)` }).from(passwordResetsTable)
      .where(and(eq(passwordResetsTable.userId, userId), gt(passwordResetsTable.createdAt, new Date(Date.now() - RESET_TTL_MS))));
    if (Number(recent?.n ?? 0) >= MAX_PER_HOUR) return null;
  }
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  await db.insert(passwordResetsTable).values({ tokenHash: hashToken(token), userId, createdAt: now, expiresAt: new Date(now.getTime() + RESET_TTL_MS) });
  return token;
}

export function sendResetEmail(user: Pick<User, "name" | "email">, url: string) {
  return sendMail(user.email, "Reset your Uhandisi School password", {
    greeting: `Hi ${user.name.split(/\s+/)[0]},`,
    paragraphs: ["Someone (hopefully you) asked to reset the password for your Uhandisi School account. Choose a new one with the button below. The link works once, for the next hour."],
    button: { label: "Choose a new password", url },
    footer: "Didn't ask for this? You can ignore this email; your password stays the same.",
  });
}

/** The active account a reset token belongs to, if the token is still usable. */
export async function userForToken(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const [row] = await db.select({ user: usersTable }).from(passwordResetsTable)
    .innerJoin(usersTable, eq(passwordResetsTable.userId, usersTable.id))
    .where(and(eq(passwordResetsTable.tokenHash, hashToken(token)), isNull(passwordResetsTable.usedAt), gt(passwordResetsTable.expiresAt, new Date())))
    .limit(1);
  return row && row.user.active ? row.user : null;
}

/** Sets the new password, uses up every outstanding link and logs the person out everywhere. */
export async function completeReset(token: string, password: string) {
  const user = await userForToken(token);
  if (!user) return null;
  const now = new Date();
  // Claim the token first so the same link can't be used twice at once.
  const [claimed] = await db.update(passwordResetsTable).set({ usedAt: now })
    .where(and(eq(passwordResetsTable.tokenHash, hashToken(token)), isNull(passwordResetsTable.usedAt)));
  if (!claimed.affectedRows) return null;
  await db.update(usersTable).set({ passwordHash: await hashPassword(password) }).where(eq(usersTable.id, user.id));
  await db.update(passwordResetsTable).set({ usedAt: now }).where(and(eq(passwordResetsTable.userId, user.id), isNull(passwordResetsTable.usedAt)));
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, user.id));
  return user;
}

/** Email addresses shown on the reset page are partly hidden: am***@gmail.com */
export const maskEmail = (email: string) => email.replace(/^(.{1,2})[^@]*/, (_m, start: string) => `${start}***`);

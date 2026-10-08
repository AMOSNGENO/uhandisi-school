import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, hashPassword, passwordResetsTable, sessionsTable, usersTable, type User } from "@workspace/db";
import { sendMail } from "./mailer";

export const CODE_TTL_MINUTES = 15;
const CODE_TTL_MS = CODE_TTL_MINUTES * 60 * 1000;
// At most this many codes per person per hour, so nobody can flood an inbox.
const MAX_PER_HOUR = 3;
// Wrong guesses allowed per code before it stops working.
const MAX_ATTEMPTS = 5;

// Only a hash is stored. The creation time (whole seconds, as the DATETIME column keeps it) is mixed in,
// so the same 6 digits sent again later still give a different key.
const codeKey = (userId: number, createdAt: Date, code: string) =>
  createHash("sha256").update(`${userId}:${Math.floor(createdAt.getTime() / 1000)}:${code}`).digest("hex");

/** Creates a 6-digit reset code for the user (earlier ones stop working); null when they asked too often this hour. */
export async function createResetCode(userId: number, { force = false } = {}) {
  if (!force) {
    const [recent] = await db.select({ n: sql<number>`COUNT(*)` }).from(passwordResetsTable)
      .where(and(eq(passwordResetsTable.userId, userId), gt(passwordResetsTable.createdAt, new Date(Date.now() - 60 * 60 * 1000))));
    if (Number(recent?.n ?? 0) >= MAX_PER_HOUR) return null;
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db.update(passwordResetsTable).set({ usedAt: now }).where(and(eq(passwordResetsTable.userId, userId), isNull(passwordResetsTable.usedAt)));
  await db.insert(passwordResetsTable).values({ tokenHash: codeKey(userId, now, code), userId, createdAt: now, expiresAt: new Date(now.getTime() + CODE_TTL_MS) });
  return code;
}

export function sendResetCodeEmail(user: Pick<User, "name" | "email">, code: string) {
  return sendMail(user.email, `${code} is your Uhandisi School reset code`, {
    greeting: `Hi ${user.name.split(/\s+/)[0]},`,
    paragraphs: [`Someone (hopefully you) asked to reset the password for your Uhandisi School account. Enter this code on the reset page to choose a new password. It works once, for the next ${CODE_TTL_MINUTES} minutes.`],
    code,
    footer: "Didn't ask for this? You can ignore this email; your password stays the same. Never share this code with anyone.",
  });
}

const WRONG = "That code is wrong or has expired. Check the latest email, or ask for a new code.";

/**
 * Checks the code and, when right, sets the new password, uses up the code and logs the person out
 * everywhere else. Returns the user, or an error message.
 */
export async function resetWithCode(email: string, code: string, password: string): Promise<{ user: User } | { error: string }> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user?.active || !/^\d{6}$/.test(code)) return { error: WRONG };
  const [pending] = await db.select().from(passwordResetsTable)
    .where(and(eq(passwordResetsTable.userId, user.id), isNull(passwordResetsTable.usedAt), gt(passwordResetsTable.expiresAt, new Date())))
    .orderBy(desc(passwordResetsTable.createdAt)).limit(1);
  if (!pending) return { error: WRONG };

  if (pending.tokenHash !== codeKey(user.id, pending.createdAt, code)) {
    const attempts = pending.attempts + 1;
    await db.update(passwordResetsTable)
      .set({ attempts, ...(attempts >= MAX_ATTEMPTS ? { usedAt: new Date() } : {}) })
      .where(eq(passwordResetsTable.tokenHash, pending.tokenHash));
    return { error: attempts >= MAX_ATTEMPTS ? "Too many wrong tries. Ask for a new code." : WRONG };
  }

  // Claim the code first so it can't be used twice at once.
  const [claimed] = await db.update(passwordResetsTable).set({ usedAt: new Date() })
    .where(and(eq(passwordResetsTable.tokenHash, pending.tokenHash), isNull(passwordResetsTable.usedAt)));
  if (!claimed.affectedRows) return { error: WRONG };
  await db.update(usersTable).set({ passwordHash: await hashPassword(password) }).where(eq(usersTable.id, user.id));
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, user.id));
  return { user };
}

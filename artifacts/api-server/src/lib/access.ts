import { eq } from "drizzle-orm";
import { db, lessonsTable, modulesTable, type Lesson } from "@workspace/db";
import type { PublicUser } from "./auth";
import { getCourseForUser } from "./courses";

// A package page pulls in dozens of assets, so granted access is remembered for a minute.
// Refusals are never cached: a student who just paid or was enrolled gets in straight away.
const cache = new Map<string, number>();
const TTL_MS = 60_000;

/** Call after changing who is enrolled, so removed access stops at once. */
export const clearAccessCache = () => cache.clear();

/** The lesson, if this user may open it: admins always, others once their payments have opened it. */
export async function lessonForViewer(user: PublicUser, lessonId: number): Promise<Lesson | null> {
  const [row] = await db
    .select({ lesson: lessonsTable, courseId: modulesTable.courseId })
    .from(lessonsTable)
    .innerJoin(modulesTable, eq(lessonsTable.moduleId, modulesTable.id))
    .where(eq(lessonsTable.id, lessonId))
    .limit(1);
  if (!row) return null;
  if (user.role === "admin") return row.lesson;

  const key = `${user.id}:${lessonId}`;
  if ((cache.get(key) ?? 0) > Date.now()) return row.lesson;

  const course = await getCourseForUser(row.courseId, user.id);
  const ok = !!course?.lessons.find((l) => l.id === lessonId)?.unlocked;
  if (!ok) return null;
  if (cache.size > 5000) cache.clear();
  cache.set(key, Date.now() + TTL_MS);
  return row.lesson;
}

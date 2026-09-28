// Imports courses from a Moodle site into this app. READ-ONLY on Moodle: only SELECT queries run
// against its database, and files are fetched with Moodle's web-service download (or copied from a
// moodledata folder). Re-running updates what changed; prices and visibility set here are kept.
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { and, eq } from "drizzle-orm";
import { coursesTable, db, lessonsTable, modulesTable, type Lesson } from "@workspace/db";
import { fileTypeFor, installFile, installPackage, MAX_FILE, MAX_PACKAGE } from "../routes/admin-content";
import { detectPublicType, savePublic } from "../routes/uploads";
import { newKey, privateDir } from "./storage";

const cfg = () => ({
  dbUrl: process.env.MOODLE_DB_URL ?? "",
  prefix: process.env.MOODLE_DB_PREFIX || "mdl_",
  ssl: process.env.MOODLE_DB_SSL === "true",
  siteUrl: (process.env.MOODLE_URL ?? "").replace(/\/+$/, ""),
  token: process.env.MOODLE_TOKEN ?? "",
  dataDir: process.env.MOODLE_DATA_DIR ?? "",
});

export class MoodleError extends Error {}

let pool: Pool | null = null;
function moodleDb(): Pool {
  const c = cfg();
  if (!c.dbUrl) throw new MoodleError("Moodle isn't connected: set MOODLE_DB_URL in artifacts/api-server/.env and restart.");
  if (!/^[a-z0-9_]+$/i.test(c.prefix)) throw new MoodleError("MOODLE_DB_PREFIX may only contain letters, digits and _.");
  pool ??= mysql.createPool({
    uri: c.dbUrl, connectionLimit: 3, connectTimeout: 15_000, timezone: "Z",
    ...(c.ssl ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  return pool;
}

/** SELECT against Moodle; {x} in the SQL becomes the prefixed table name (e.g. {course} → mdl_course). */
async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!/^\s*select\b/i.test(sql)) throw new MoodleError("Only SELECT queries run against Moodle.");
  const prefix = cfg().prefix;
  const [rows] = await moodleDb().query<RowDataPacket[]>(sql.replace(/\{(\w+)\}/g, (_, t) => `\`${prefix}${t}\``), params);
  return rows as T[];
}

const filesAccess = () => {
  const c = cfg();
  return c.dataDir ? "moodledata folder" : c.siteUrl && c.token ? "web service" : null;
};

export async function moodleStatus() {
  const c = cfg();
  if (!c.dbUrl) return { configured: false, connected: false, files: filesAccess(), error: null as string | null };
  try {
    const [site] = await q<{ fullname: string }>("SELECT fullname FROM {course} WHERE id = 1");
    const [release] = await q<{ value: string }>("SELECT value FROM {config} WHERE name = 'release'");
    return { configured: true, connected: true, site: site?.fullname ?? "", release: release?.value ?? "", files: filesAccess(), error: null };
  } catch (e) {
    return { configured: true, connected: false, files: filesAccess(), error: describe(e) };
  }
}

function describe(e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.code === "ENOTFOUND") return `Can't reach the Moodle database server (${err.code}). Check the host, and that remote MySQL access allows this computer's IP.`;
  if (err.code === "ER_ACCESS_DENIED_ERROR") return "The Moodle database refused the username or password.";
  if (err.code === "ER_BAD_DB_ERROR") return "That database name doesn't exist on the Moodle server.";
  if (err.code === "ER_NO_SUCH_TABLE") return "Connected, but no Moodle tables were found. Check MOODLE_DB_PREFIX (usually mdl_).";
  return err.message ?? "Unknown error";
}

const SUPPORTED = new Set(["page", "label", "url", "resource", "scorm", "imscp", "book"]);

export async function listMoodleCourses() {
  const courses = await q<{ id: number; fullname: string; shortname: string; visible: number; category: string | null }>(
    "SELECT c.id, c.fullname, c.shortname, c.visible, cc.name AS category FROM {course} c LEFT JOIN {course_categories} cc ON cc.id = c.category WHERE c.id <> 1 ORDER BY c.fullname",
  );
  const counts = await q<{ course: number; modname: string; n: number }>(
    "SELECT cm.course, m.name AS modname, COUNT(*) AS n FROM {course_modules} cm JOIN {modules} m ON m.id = cm.module WHERE cm.deletioninprogress = 0 GROUP BY cm.course, m.name",
  );
  const imported = new Map((await db.select({ id: coursesTable.id, moodleId: coursesTable.moodleId }).from(coursesTable)).filter((c) => c.moodleId).map((c) => [c.moodleId!, c.id]));
  return courses.map((c) => {
    const mine = counts.filter((x) => x.course === c.id);
    return {
      moodleId: c.id, title: c.fullname, shortname: c.shortname, category: c.category ?? "", visible: !!c.visible,
      importable: mine.filter((x) => SUPPORTED.has(x.modname)).reduce((n, x) => n + Number(x.n), 0),
      skipped: mine.filter((x) => !SUPPORTED.has(x.modname)).map((x) => `${x.n} ${x.modname}`),
      importedAs: imported.get(c.id) ?? null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

type MFile = { id: number; contenthash: string; contextid: number; component: string; filearea: string; itemid: number; filepath: string; filename: string; filesize: number; mimetype: string | null };

const fileRows = (contextId: number, component: string, filearea: string, itemid?: number) =>
  q<MFile>(
    `SELECT id, contenthash, contextid, component, filearea, itemid, filepath, filename, filesize, mimetype FROM {files}
     WHERE contextid = ? AND component = ? AND filearea = ? AND filename <> '.'${itemid === undefined ? "" : " AND itemid = ?"}
     ORDER BY sortorder DESC, id DESC`,
    itemid === undefined ? [contextId, component, filearea] : [contextId, component, filearea, itemid],
  );

/** Downloads (or copies) one Moodle file to a temp path, refusing anything over maxBytes. */
async function fetchFile(f: MFile, maxBytes: number): Promise<string> {
  if (f.filesize > maxBytes) throw new MoodleError(`${f.filename} is ${Math.round(f.filesize / 1048576)} MB, over the ${Math.round(maxBytes / 1048576)} MB limit.`);
  const temp = path.join(privateDir, `${newKey()}.moodle`);
  const c = cfg();
  if (c.dataDir) {
    const src = path.join(c.dataDir, "filedir", f.contenthash.slice(0, 2), f.contenthash.slice(2, 4), f.contenthash);
    await copyFile(src, temp).catch(() => { throw new MoodleError(`${f.filename} isn't in the moodledata folder (${src}).`); });
    return temp;
  }
  if (!c.siteUrl || !c.token) throw new MoodleError("No file access: set MOODLE_URL and MOODLE_TOKEN (or MOODLE_DATA_DIR) to import files.");
  const url = `${c.siteUrl}/webservice/pluginfile.php/${f.contextid}/${f.component}/${f.filearea}/${f.itemid}${f.filepath}${encodeURIComponent(f.filename)}?token=${encodeURIComponent(c.token)}&forcedownload=1`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new MoodleError(`Moodle refused to send ${f.filename} (HTTP ${res.status}). Check the token and that web services are enabled.`);
  if ((res.headers.get("content-type") || "").includes("application/json")) {
    const body = await res.text();
    throw new MoodleError(`Moodle refused to send ${f.filename}: ${body.slice(0, 160)}`);
  }
  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _e, done) { bytes += chunk.length; done(bytes > maxBytes ? new MoodleError(`${f.filename} is over the size limit.`) : null, chunk); },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), limit, createWriteStream(temp));
  } catch (e) {
    await rm(temp, { force: true });
    throw e;
  }
  return temp;
}

/** Moodle HTML refers to its own files as @@PLUGINFILE@@/name. Images/PDFs are copied here; other links are dropped. */
async function rewriteFiles(html: string | null, contextId: number, component: string, filearea: string, itemid: number, log: Logger) {
  if (!html) return "";
  if (!html.includes("@@PLUGINFILE@@") || !filesAccess()) return html.replace(/@@PLUGINFILE@@\/[^"'\s)<>]*/g, "#");
  const files = await fileRows(contextId, component, filearea, itemid);
  const urls = new Map<string, string>();
  for (const m of new Set(html.match(/@@PLUGINFILE@@\/[^"'\s)<>?#]+/g) ?? [])) {
    const wanted = decodeURIComponent(m.slice("@@PLUGINFILE@@".length));
    const f = files.find((x) => `${x.filepath}${x.filename}` === wanted);
    if (!f) continue;
    try {
      const temp = await fetchFile(f, 10 * 1024 * 1024);
      const body = await readFile(temp);
      await rm(temp, { force: true });
      const type = detectPublicType(body);
      if (type) urls.set(m, await savePublic(body, type.ext));
    } catch (e) {
      log(`  ⚠ couldn't copy embedded file ${f.filename}: ${(e as Error).message}`);
    }
  }
  return html.replace(/@@PLUGINFILE@@\/[^"'\s)<>?#]+/g, (m) => urls.get(m) ?? "#");
}

const plain = (html: string | null, max = 300) =>
  (html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ").trim().slice(0, max);

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

type Logger = (line: string) => void;

async function upsertLesson(moduleId: number, ref: string, order: number, fields: Partial<Lesson>): Promise<Lesson> {
  const [existing] = await db.select().from(lessonsTable).where(eq(lessonsTable.moodleRef, ref)).limit(1);
  const now = new Date();
  if (existing) {
    await db.update(lessonsTable).set({ ...fields, moduleId, order, updatedAt: now }).where(eq(lessonsTable.id, existing.id));
  } else {
    await db.insert(lessonsTable).values({ contentHtml: "", title: "Untitled", ...fields, moduleId, order, moodleRef: ref, createdAt: now, updatedAt: now });
  }
  const [row] = await db.select().from(lessonsTable).where(eq(lessonsTable.moodleRef, ref)).limit(1);
  return row!;
}

/** Brings one uploaded file/package across, unless Moodle's copy hasn't changed since last time. */
async function importUpload(lesson: Lesson, f: MFile, kind: "file" | "package", log: Logger) {
  if (lesson.moodleHash === f.contenthash && lesson.storageKey) return "unchanged";
  if (kind === "file" && !fileTypeFor(f.filename)) throw new MoodleError(`${f.filename}: this file type can't be shown to students.`);
  const temp = await fetchFile(f, kind === "package" ? MAX_PACKAGE : MAX_FILE);
  try {
    const size = (await stat(temp)).size;
    if (kind === "package") {
      const r = await installPackage(lesson, temp, f.filename, size, { moodleHash: f.contenthash });
      return `${r.scorm ? "SCORM" : "IMS"} package, ${r.items} items`;
    }
    await installFile(lesson, temp, f.filename, size, { moodleHash: f.contenthash });
    return `${f.filename}, ${Math.max(1, Math.round(size / 1024))} KB`;
  } finally {
    await rm(temp, { force: true });
  }
}

export async function importCourse(moodleId: number, log: Logger) {
  const [mc] = await q<{ id: number; fullname: string; summary: string | null; visible: number; category: string | null }>(
    "SELECT c.id, c.fullname, c.summary, c.visible, cc.name AS category FROM {course} c LEFT JOIN {course_categories} cc ON cc.id = c.category WHERE c.id = ?", [moodleId],
  );
  if (!mc || mc.id === 1) throw new MoodleError(`Moodle course ${moodleId} not found.`);
  log(`Course “${mc.fullname}”`);
  const [courseCtx] = await q<{ id: number }>("SELECT id FROM {context} WHERE contextlevel = 50 AND instanceid = ?", [moodleId]);
  const [fee] = await q<{ cost: string | null; currency: string | null }>(
    "SELECT cost, currency FROM {enrol} WHERE courseid = ? AND enrol IN ('fee', 'paypal') AND status = 0 ORDER BY id LIMIT 1", [moodleId],
  );
  const price = Math.round(Number(fee?.cost ?? 0)) || 0;

  const overviewHtml = courseCtx ? await rewriteFiles(mc.summary, courseCtx.id, "course", "summary", 0, log) : mc.summary ?? "";
  const content = {
    title: mc.fullname.slice(0, 190),
    category: (mc.category || "Imported from Moodle").slice(0, 120),
    description: plain(mc.summary) || mc.fullname,
    overviewHtml,
  };
  let [course] = await db.select().from(coursesTable).where(eq(coursesTable.moodleId, moodleId)).limit(1);
  if (course) {
    await db.update(coursesTable).set(content).where(eq(coursesTable.id, course.id));
    log("  updated existing course (price and visibility kept)");
  } else {
    await db.insert(coursesTable).values({
      ...content, moodleId, published: !!mc.visible, createdAt: new Date(),
      paymentModel: price > 0 ? "paid" : "free", price,
      planName: price > 0 ? "Full course" : "Free", planAmountPerDay: 0, planDescription: price > 0 ? "One payment opens the whole course." : "",
    });
    [course] = await db.select().from(coursesTable).where(eq(coursesTable.moodleId, moodleId)).limit(1);
    log(`  created (${price > 0 ? `paid, ${price} ${fee?.currency ?? ""}`.trim() : "free"}; ${mc.visible ? "published" : "hidden"} like in Moodle)`);
  }

  // Course image: the first image in "Course image".
  if (courseCtx && filesAccess()) {
    const [img] = (await fileRows(courseCtx.id, "course", "overviewfiles")).filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.mimetype ?? ""));
    if (img) {
      try {
        const temp = await fetchFile(img, 10 * 1024 * 1024);
        const body = await readFile(temp);
        await rm(temp, { force: true });
        const type = detectPublicType(body);
        if (type) { await db.update(coursesTable).set({ imageUrl: await savePublic(body, type.ext) }).where(eq(coursesTable.id, course!.id)); log("  course image copied"); }
      } catch (e) { log(`  ⚠ course image: ${(e as Error).message}`); }
    }
  }

  const sections = await q<{ id: number; section: number; name: string | null; summary: string | null; sequence: string | null; visible: number }>(
    "SELECT id, section, name, summary, sequence, visible FROM {course_sections} WHERE course = ? ORDER BY section", [moodleId],
  );
  const cms = await q<{ id: number; instance: number; visible: number; modname: string }>(
    "SELECT cm.id, cm.instance, cm.visible, m.name AS modname FROM {course_modules} cm JOIN {modules} m ON m.id = cm.module WHERE cm.course = ? AND cm.deletioninprogress = 0", [moodleId],
  );
  const cmById = new Map(cms.map((cm) => [cm.id, cm]));
  const ctxRows = cms.length ? await q<{ id: number; instanceid: number }>(
    `SELECT id, instanceid FROM {context} WHERE contextlevel = 70 AND instanceid IN (${cms.map(() => "?").join(",")})`, cms.map((c) => c.id),
  ) : [];
  const ctxOf = new Map(ctxRows.map((c) => [c.instanceid, c.id]));

  let sectionOrder = 0;
  const counts = { added: 0, unchanged: 0, skipped: 0 };
  for (const s of sections) {
    if (!s.visible) continue;
    const items = (s.sequence ?? "").split(",").map(Number).map((id) => cmById.get(id)).filter((cm): cm is NonNullable<typeof cm> => !!cm && !!cm.visible);
    const usable = items.filter((cm) => SUPPORTED.has(cm.modname));
    for (const cm of items.filter((x) => !SUPPORTED.has(x.modname))) { counts.skipped++; log(`  – skipped a ${cm.modname} (not supported yet)`); }
    if (usable.length === 0) continue;

    const ref = `section:${s.id}`;
    const sectionTitle = (s.name || (s.section === 0 ? "General" : `Topic ${s.section}`)).slice(0, 190);
    let [mod] = await db.select().from(modulesTable).where(and(eq(modulesTable.courseId, course!.id), eq(modulesTable.moodleRef, ref))).limit(1);
    sectionOrder++;
    if (mod) {
      await db.update(modulesTable).set({ title: sectionTitle, description: plain(s.summary, 500), order: sectionOrder }).where(eq(modulesTable.id, mod.id));
    } else {
      await db.insert(modulesTable).values({
        courseId: course!.id, title: sectionTitle, description: plain(s.summary, 500), order: sectionOrder, moodleRef: ref,
        // Paid courses: the first section is a free preview, the rest open once the course is paid for.
        unlockAmount: course!.paymentModel === "free" || s.section === 0 ? 0 : course!.price,
      });
      [mod] = await db.select().from(modulesTable).where(and(eq(modulesTable.courseId, course!.id), eq(modulesTable.moodleRef, ref))).limit(1);
    }
    log(`  Section “${sectionTitle}”`);

    let order = 0;
    for (const cm of usable) {
      const ctx = ctxOf.get(cm.id) ?? 0;
      try {
        if (cm.modname === "book") {
          const [book] = await q<{ name: string }>("SELECT name FROM {book} WHERE id = ?", [cm.instance]);
          const chapters = await q<{ id: number; title: string; content: string }>("SELECT id, title, content FROM {book_chapters} WHERE bookid = ? AND hidden = 0 ORDER BY pagenum", [cm.instance]);
          for (const ch of chapters) {
            await upsertLesson(mod!.id, `chapter:${ch.id}`, ++order, {
              kind: "page", title: `${book?.name ?? "Book"}: ${ch.title}`.slice(0, 190), contentHtml: await rewriteFiles(ch.content, ctx, "mod_book", "chapter", ch.id, log),
            });
          }
          counts.added += chapters.length;
          log(`    ✓ book “${book?.name}”: ${chapters.length} chapters`);
          continue;
        }
        const table = cm.modname;
        const [inst] = await q<{ name: string; intro: string | null; content?: string; externalurl?: string }>(
          `SELECT * FROM {${table}} WHERE id = ?`, [cm.instance],
        );
        if (!inst) { counts.skipped++; continue; }
        const title = (inst.name || cm.modname).slice(0, 190);
        const ref2 = `cm:${cm.id}`;
        if (cm.modname === "page" || cm.modname === "label") {
          const html = cm.modname === "page" ? await rewriteFiles(inst.content ?? "", ctx, "mod_page", "content", 0, log) : await rewriteFiles(inst.intro, ctx, "mod_label", "intro", 0, log);
          await upsertLesson(mod!.id, ref2, ++order, { kind: "page", title, contentHtml: html });
          log(`    ✓ ${cm.modname} “${title}”`);
        } else if (cm.modname === "url") {
          const external = /^https?:\/\//i.test(inst.externalurl ?? "") ? inst.externalurl!.slice(0, 1000) : null;
          await upsertLesson(mod!.id, ref2, ++order, { kind: "url", title, externalUrl: external, contentHtml: await rewriteFiles(inst.intro, ctx, "mod_url", "intro", 0, log) });
          log(`    ✓ link “${title}”`);
        } else {
          const [component, area, kind] = cm.modname === "resource" ? ["mod_resource", "content", "file" as const]
            : cm.modname === "scorm" ? ["mod_scorm", "package", "package" as const] : ["mod_imscp", "backup", "package" as const];
          const intro = await rewriteFiles(inst.intro, ctx, component, "intro", 0, log);
          const lesson = await upsertLesson(mod!.id, ref2, ++order, { kind, title, contentHtml: kind === "file" ? intro : "" });
          const [f] = (await fileRows(ctx, component, area)).filter((x) => kind === "file" || /\.zip$/i.test(x.filename));
          if (!f) { log(`    ⚠ ${cm.modname} “${title}”: no file found in Moodle`); continue; }
          if (!filesAccess()) { log(`    ⚠ ${cm.modname} “${title}”: added without its file (no file access configured)`); continue; }
          const result = await importUpload(lesson, f, kind, log);
          if (result === "unchanged") counts.unchanged++;
          log(`    ✓ ${cm.modname === "resource" ? "file" : cm.modname === "scorm" ? "SCORM" : "IMS package"} “${title}”: ${result}`);
        }
        counts.added++;
      } catch (e) {
        counts.skipped++;
        log(`    ⚠ ${cm.modname} #${cm.id}: ${(e as Error).message}`);
      }
    }
  }
  log(`  Done: ${counts.added} items imported${counts.unchanged ? ` (${counts.unchanged} files unchanged)` : ""}, ${counts.skipped} skipped.`);
  return course!.id;
}

// Imports can take minutes (large packages), so they run as a background job the page polls.
type Job = { id: string; status: "running" | "done" | "failed"; log: string[]; courseIds: number[] };
const jobs = new Map<string, Job>();

export function startImport(moodleIds: number[]) {
  if ([...jobs.values()].some((j) => j.status === "running")) throw new MoodleError("An import is already running. Wait for it to finish.");
  const job: Job = { id: randomBytes(8).toString("hex"), status: "running", log: [], courseIds: [] };
  jobs.set(job.id, job);
  const log = (line: string) => { job.log.push(line); };
  (async () => {
    for (const id of moodleIds) {
      try { job.courseIds.push(await importCourse(id, log)); } catch (e) { log(`⚠ Course ${id}: ${e instanceof MoodleError ? e.message : describe(e)}`); }
    }
    job.status = "done";
    log("Import finished.");
  })().catch((e) => { job.status = "failed"; log(`Import stopped: ${describe(e)}`); });
  return job.id;
}

export const getJob = (id: string) => jobs.get(id);

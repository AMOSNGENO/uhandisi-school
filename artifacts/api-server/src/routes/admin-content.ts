import path from "node:path";
import { rename, rm } from "node:fs/promises";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, lessonsTable, type Lesson } from "@workspace/db";
import { requireAdmin } from "../lib/auth";
import {
  extractZip, newKey, packagesDir, privateDir, readPackage, removeStored, saveRequestBody, UploadError,
} from "../lib/storage";

const router: IRouter = Router();

// File resources: documents, slides, spreadsheets, media. Anything that could run in the browser
// (HTML, SVG, scripts) is refused.
export const fileTypes: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  odp: "application/vnd.oasis.opendocument.presentation",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
export const MAX_FILE = 200 * 1024 * 1024;
export const MAX_PACKAGE = 300 * 1024 * 1024;

export const fileTypeFor = (name: string) => fileTypes[path.extname(name).slice(1).toLowerCase()];

/** Moves a downloaded/uploaded temp file into private storage as this activity's file. */
export async function installFile(lesson: Lesson, tempPath: string, name: string, size: number, extra: Partial<Lesson> = {}) {
  const ext = path.extname(name).slice(1).toLowerCase();
  const type = fileTypes[ext];
  if (!type) throw new UploadError(415, `Files of type .${ext || "?"} can't be used. Use PDF, Word, PowerPoint, Excel, text, zip, audio, video or images.`);
  const key = `${newKey()}.${ext}`;
  await rename(tempPath, path.join(privateDir, key));
  await removeStored(lesson.kind, lesson.storageKey);
  await db.update(lessonsTable).set({
    kind: "file", fileName: name, fileType: type, fileSize: size, storageKey: key,
    packageEntry: null, packageToc: null, updatedAt: new Date(), ...extra,
  }).where(eq(lessonsTable.id, lesson.id));
  return { fileName: name, fileType: type, fileSize: size };
}

/** Unpacks an IMS content package / SCORM zip and makes it this activity's package. */
export async function installPackage(lesson: Lesson, zipPath: string, name: string, size: number, extra: Partial<Lesson> = {}) {
  const key = newKey();
  const dir = path.join(packagesDir, key);
  try {
    const files = await extractZip(zipPath, dir);
    const pkg = await readPackage(dir);
    const prefix = (href: string | null) => (href && pkg.root ? `${pkg.root}/${href}` : href);
    const toc = pkg.toc.map((t) => ({ ...t, href: prefix(t.href) }));
    await removeStored(lesson.kind, lesson.storageKey);
    await db.update(lessonsTable).set({
      kind: "package", fileName: name.slice(0, 200), fileType: pkg.scorm ? "scorm" : "ims", fileSize: size, storageKey: key,
      packageEntry: prefix(pkg.entry), packageToc: JSON.stringify(toc), updatedAt: new Date(), ...extra,
    }).where(eq(lessonsTable.id, lesson.id));
    return { title: pkg.title, scorm: pkg.scorm, items: toc.length, files };
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
}

async function lessonOr404(id: number, res: import("express").Response) {
  const [lesson] = await db.select().from(lessonsTable).where(eq(lessonsTable.id, id)).limit(1);
  if (!lesson) res.status(404).json({ error: "Activity not found" });
  return lesson;
}

function fail(res: import("express").Response, e: unknown) {
  if (e instanceof UploadError) res.status(e.status).json({ error: e.message });
  else res.status(500).json({ error: "The upload failed. Try again." });
}

const fileNameFrom = (req: import("express").Request, fallback: string) =>
  decodeURIComponent(String(req.headers["x-file-name"] || fallback)).replace(/[\\/]/g, "_").slice(0, 200);

// The browser sends the file as the raw body; its name travels in X-File-Name (URI-encoded).
router.post("/admin/lessons/:id/file", requireAdmin, async (req, res) => {
  const lesson = await lessonOr404(Number(req.params.id), res);
  if (!lesson) return;
  const name = fileNameFrom(req, "");
  if (!fileTypeFor(name)) {
    req.resume();
    res.status(415).json({ error: `Files of type .${path.extname(name).slice(1) || "?"} can't be uploaded. Use PDF, Word, PowerPoint, Excel, text, zip, audio, video or images.` });
    return;
  }
  const temp = path.join(privateDir, `${newKey()}.upload`);
  try {
    const size = await saveRequestBody(req, temp, MAX_FILE);
    res.json(await installFile(lesson, temp, name, size));
  } catch (e) {
    await rm(temp, { force: true });
    fail(res, e);
  }
});

// IMS content package / SCORM: unpack, read imsmanifest.xml, keep the table of contents.
router.post("/admin/lessons/:id/package", requireAdmin, async (req, res) => {
  const lesson = await lessonOr404(Number(req.params.id), res);
  if (!lesson) return;
  const zipPath = path.join(privateDir, `${newKey()}.upload.zip`);
  try {
    const size = await saveRequestBody(req, zipPath, MAX_PACKAGE);
    res.json(await installPackage(lesson, zipPath, fileNameFrom(req, "package.zip"), size));
  } catch (e) {
    fail(res, e);
  } finally {
    await rm(zipPath, { force: true });
  }
});

export default router;

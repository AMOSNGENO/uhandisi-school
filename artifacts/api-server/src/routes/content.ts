import path from "node:path";
import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import { lessonForViewer } from "../lib/access";
import { packagesDir, privateDir, safeJoin } from "../lib/storage";

const router: IRouter = Router();

// Types a browser can show itself; everything else downloads.
const inline = /^(application\/pdf|image\/(png|jpeg|gif|webp)|video\/(mp4|webm)|audio\/(mpeg|mp4|wav|ogg)|text\/plain)$/;

// A "File" resource, for students who have unlocked its module.
router.get("/content/file/:lessonId", requireAuth, async (req, res) => {
  const lesson = await lessonForViewer(req.user!, Number(req.params.lessonId));
  if (!lesson || lesson.kind !== "file" || !lesson.storageKey) {
    res.status(404).json({ error: "File not found, or its module is locked." });
    return;
  }
  const type = lesson.fileType || "application/octet-stream";
  const name = lesson.fileName || "download";
  // PDFs are read in the book reader and never offered as a download; other files can be saved.
  const disposition = type === "application/pdf" || (inline.test(type) && req.query.download === undefined) ? "inline" : "attachment";
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.sendFile(path.join(privateDir, lesson.storageKey));
});

// Files inside an unpacked IMS content package / SCORM zip. The package's pages load their own
// images, scripts and styles through this route too, so each request is checked (and cached).
router.get("/content/package/:lessonId/*path", requireAuth, async (req, res) => {
  const lesson = await lessonForViewer(req.user!, Number(req.params.lessonId));
  if (!lesson || lesson.kind !== "package" || !lesson.storageKey) {
    res.status(404).send("Not found");
    return;
  }
  const rest = ([] as string[]).concat((req.params as { path?: string | string[] }).path ?? []).join("/");
  const target = safeJoin(path.join(packagesDir, lesson.storageKey), rest);
  if (!target) {
    res.status(400).send("Bad path");
    return;
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(target, { maxAge: "1h", dotfiles: "deny" }, (err) => {
    if (err && !res.headersSent) res.status(404).send("Not found");
  });
});

export default router;

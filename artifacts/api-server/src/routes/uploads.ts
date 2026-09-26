import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/auth";

// Files live next to the built server (artifacts/api-server/uploads) unless UPLOAD_DIR says otherwise.
export const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../uploads");
mkdirSync(uploadDir, { recursive: true });

// Only formats we can recognise by their first bytes. SVG is deliberately excluded: it can carry script.
const allowed: Record<string, { ext: string; matches: (b: Buffer) => boolean }> = {
  "image/png": { ext: "png", matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/jpeg": { ext: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/gif": { ext: "gif", matches: (b) => b.subarray(0, 4).toString("latin1") === "GIF8" },
  "image/webp": { ext: "webp", matches: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  "application/pdf": { ext: "pdf", matches: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
};

const MAX_BYTES = 10 * 1024 * 1024;

const router: IRouter = Router();

// The browser sends the file itself as the request body, with its type in Content-Type.
router.post(
  "/admin/uploads",
  requireAdmin,
  express.raw({ type: () => true, limit: MAX_BYTES }),
  async (req, res) => {
    const type = (req.headers["content-type"] || "").split(";")[0]!.trim().toLowerCase();
    const kind = allowed[type];
    const body = req.body as Buffer;
    if (!kind) {
      res.status(415).json({ error: "Upload a PNG, JPEG, GIF or WebP image, or a PDF." });
      return;
    }
    if (!Buffer.isBuffer(body) || body.length === 0 || !kind.matches(body)) {
      res.status(400).json({ error: "That file doesn't look like a real " + kind.ext.toUpperCase() + "." });
      return;
    }
    const name = `${randomBytes(16).toString("hex")}.${kind.ext}`;
    await writeFile(path.join(uploadDir, name), body);
    res.status(201).json({ url: `/api/uploads/${name}` });
  },
);

// Public, so course images show for guests too. Names are random, so they can't be guessed.
router.use(
  "/uploads",
  express.static(uploadDir, {
    fallthrough: false,
    maxAge: "30d",
    immutable: true,
    setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
  }),
);

export default router;

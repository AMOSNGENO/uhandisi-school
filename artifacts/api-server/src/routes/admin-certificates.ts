import path from "node:path";
import { readFile, rename, rm } from "node:fs/promises";
import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import { certificatesTable, certificateTemplatesTable, coursesTable, db, type Certificate, type CertificateTemplate } from "@workspace/db";
import { requireAdmin } from "../lib/auth";
import { publicOrigin } from "../lib/mailer";
import { certificatePdf, certificateValues, defaultFields, FONTS, templatePdf, type TemplateField } from "../lib/certificate-pdf";
import { newKey, privateDir, saveRequestBody, UploadError } from "../lib/storage";

const router: IRouter = Router();
router.use("/admin/certificate-templates", requireAdmin);

const MAX_TEMPLATE = 20 * 1024 * 1024;
const templateFile = (t: CertificateTemplate) => path.join(privateDir, t.storageKey);
const parseFields = (t: CertificateTemplate) => JSON.parse(t.fields) as TemplateField[];

/** The template a course's certificates use: its own, else the default, else none (built-in design). */
export async function templateForCourse(courseId: number) {
  const [course] = await db.select({ templateId: coursesTable.certificateTemplateId }).from(coursesTable).where(eq(coursesTable.id, courseId)).limit(1);
  if (course?.templateId) {
    const [own] = await db.select().from(certificateTemplatesTable).where(eq(certificateTemplatesTable.id, course.templateId)).limit(1);
    if (own) return own;
  }
  const [fallback] = await db.select().from(certificateTemplatesTable).where(eq(certificateTemplatesTable.isDefault, true)).limit(1);
  return fallback ?? null;
}

/** Draws a certificate with its course's template, or the built-in design when there is none. */
export async function renderCertificate(cert: Certificate, verifyUrl: string) {
  const tpl = await templateForCourse(cert.courseId);
  if (!tpl) return certificatePdf(cert, verifyUrl);
  return templatePdf(
    { kind: tpl.kind, bytes: await readFile(templateFile(tpl)), pageWidth: tpl.pageWidth, pageHeight: tpl.pageHeight, fields: parseFields(tpl) },
    certificateValues(cert, verifyUrl),
    `Certificate ${cert.code}`,
  );
}

const view = (t: CertificateTemplate, courses = 0) => ({
  id: t.id, name: t.name, kind: t.kind, pageWidth: t.pageWidth, pageHeight: t.pageHeight, fields: parseFields(t),
  isDefault: t.isDefault, createdAt: t.createdAt.toISOString(), courses,
});

async function templateOr404(req: Request, res: Response) {
  const id = Number(req.params.id);
  const [t] = Number.isInteger(id) ? await db.select().from(certificateTemplatesTable).where(eq(certificateTemplatesTable.id, id)).limit(1) : [];
  if (!t) res.status(404).json({ error: "Template not found" });
  return t;
}

router.get("/admin/certificate-templates", async (_req, res) => {
  const templates = await db.select().from(certificateTemplatesTable).orderBy(certificateTemplatesTable.id);
  const usage = await db.select({ id: coursesTable.certificateTemplateId, n: sql<number>`COUNT(*)` }).from(coursesTable).groupBy(coursesTable.certificateTemplateId);
  res.json(templates.map((t) => view(t, Number(usage.find((u) => u.id === t.id)?.n ?? 0))));
});

// Upload a design: the raw file body, its name in X-File-Name and the template name in X-Template-Name.
router.post("/admin/certificate-templates", async (req, res) => {
  const key = newKey();
  const temp = path.join(privateDir, `${key}.upload`);
  try {
    await saveRequestBody(req, temp, MAX_TEMPLATE);
    const bytes = await readFile(temp);
    let kind: "pdf" | "image";
    let ext: string;
    let width: number;
    let height: number;
    if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
      // Must open and be embeddable (password-protected PDFs aren't).
      let doc: PDFDocument;
      try {
        doc = await PDFDocument.load(bytes);
        const probe = await PDFDocument.create();
        await probe.embedPdf(bytes, [0]);
      } catch {
        throw new UploadError(400, "That PDF can't be used: it may be password-protected or damaged. Export it again without a password.");
      }
      const first = doc.getPage(0);
      ({ width, height } = first.getSize());
      kind = "pdf";
      ext = "pdf";
    } else {
      const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!isPng && !isJpg) throw new UploadError(415, "Upload the design as a PDF, PNG or JPEG.");
      const probe = await PDFDocument.create();
      const img = isPng ? await probe.embedPng(bytes) : await probe.embedJpg(bytes);
      // Images are placed on a page 842 points wide (A4 landscape width), keeping their shape.
      width = 842;
      height = Math.round((842 * img.height) / img.width);
      kind = "image";
      ext = isPng ? "png" : "jpg";
    }
    const storageKey = `${key}.${ext}`;
    await rename(temp, path.join(privateDir, storageKey));
    const [{ n }] = await db.select({ n: sql<number>`COUNT(*)` }).from(certificateTemplatesTable);
    const name = decodeURIComponent(String(req.headers["x-template-name"] || req.headers["x-file-name"] || "Certificate design")).slice(0, 120) || "Certificate design";
    const [r] = await db.insert(certificateTemplatesTable).values({
      name, kind, storageKey, pageWidth: width, pageHeight: height, fields: JSON.stringify(defaultFields(width)),
      isDefault: Number(n) === 0, createdAt: new Date(),
    });
    const [t] = await db.select().from(certificateTemplatesTable).where(eq(certificateTemplatesTable.id, r.insertId)).limit(1);
    res.status(201).json(view(t!));
  } catch (e) {
    await rm(temp, { force: true });
    if (e instanceof UploadError) res.status(e.status).json({ error: e.message });
    else { req.log.error({ err: e }, "template upload failed"); res.status(500).json({ error: "The upload failed. Try again." }); }
  }
});

router.get("/admin/certificate-templates/:id", async (req, res) => {
  const t = await templateOr404(req, res);
  if (t) res.json(view(t));
});

const FieldBody = z.object({
  id: z.string().min(1).max(40),
  label: z.string().max(60),
  text: z.string().max(300),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  // Font size for text; width in points for a QR code.
  size: z.number().min(4).max(400),
  font: z.enum(Object.keys(FONTS) as [keyof typeof FONTS, ...Array<keyof typeof FONTS>]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  align: z.enum(["left", "center", "right"]),
  visible: z.boolean(),
  type: z.enum(["text", "qr"]).optional(),
});

router.patch("/admin/certificate-templates/:id", async (req, res) => {
  const t = await templateOr404(req, res);
  if (!t) return;
  const body = z.object({ name: z.string().trim().min(1).max(120).optional(), fields: z.array(FieldBody).max(30).optional(), isDefault: z.literal(true).optional() }).safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid template: " + body.error.issues[0]?.message });
  if (body.data.isDefault) await db.update(certificateTemplatesTable).set({ isDefault: false });
  await db.update(certificateTemplatesTable).set({
    ...(body.data.name ? { name: body.data.name } : {}),
    ...(body.data.fields ? { fields: JSON.stringify(body.data.fields) } : {}),
    ...(body.data.isDefault ? { isDefault: true } : {}),
  }).where(eq(certificateTemplatesTable.id, t.id));
  const [updated] = await db.select().from(certificateTemplatesTable).where(eq(certificateTemplatesTable.id, t.id)).limit(1);
  res.json(view(updated!));
});

router.delete("/admin/certificate-templates/:id", async (req, res) => {
  const t = await templateOr404(req, res);
  if (!t) return;
  // Courses using it fall back to the default template (or the built-in design).
  await db.update(coursesTable).set({ certificateTemplateId: null }).where(eq(coursesTable.certificateTemplateId, t.id));
  await db.delete(certificateTemplatesTable).where(eq(certificateTemplatesTable.id, t.id));
  await rm(templateFile(t), { force: true });
  res.status(204).end();
});

// The uploaded design itself, for the placement editor.
router.get("/admin/certificate-templates/:id/background", async (req, res) => {
  const t = await templateOr404(req, res);
  if (!t) return;
  res.setHeader("Content-Type", t.kind === "pdf" ? "application/pdf" : t.storageKey.endsWith(".png") ? "image/png" : "image/jpeg");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.sendFile(templateFile(t));
});

// A certificate drawn with sample details, exactly as students will get it.
router.get("/admin/certificate-templates/:id/preview", async (req, res) => {
  const t = await templateOr404(req, res);
  if (!t) return;
  const sample = { studentName: "Wanjiru Kamau", courseTitle: "Data Analytics", issuedAt: new Date(), percent: 86, code: "UHS-SAMPLE01" };
  const origin = publicOrigin(req);
  const pdf = await templatePdf(
    { kind: t.kind, bytes: await readFile(templateFile(t)), pageWidth: t.pageWidth, pageHeight: t.pageHeight, fields: parseFields(t) },
    certificateValues(sample, `${origin}/verify/${sample.code}`),
    `Preview: ${t.name}`,
  );
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="certificate-preview.pdf"`);
  res.send(pdf);
});

// Every certificate issued, newest first (admin overview).
router.get("/admin/certificates", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(certificatesTable).orderBy(desc(certificatesTable.issuedAt)).limit(500);
  res.json(rows.map((c) => ({
    id: c.id, code: c.code, studentName: c.studentName, courseTitle: c.courseTitle, courseId: c.courseId, percent: c.percent,
    issuedBy: c.issuedBy, issuedAt: c.issuedAt.toISOString(), revoked: !!c.revokedAt,
  })));
});

export default router;

// Draws a certificate as an A4-landscape PDF (pdf-lib, no browser needed).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { Certificate } from "@workspace/db";

const navy = rgb(11 / 255, 45 / 255, 92 / 255);
const blue = rgb(17 / 255, 85 / 255, 204 / 255);
const sand = rgb(202 / 255, 185 / 255, 154 / 255);
const grey = rgb(91 / 255, 106 / 255, 125 / 255);

// The site logo (override with CERT_LOGO=path/to/logo.png).
const logoPath = process.env.CERT_LOGO
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../uhandisi-school/public/images/uhandisi-logo.png");

// The built-in PDF fonts only cover Western European characters; others are simplified or dropped.
const safe = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E\xA0-\xFF]/g, "").trim();

function centered(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color = navy, maxWidth = 720) {
  let s = size;
  while (s > 10 && font.widthOfTextAtSize(text, s) > maxWidth) s -= 1;
  const w = font.widthOfTextAtSize(text, s);
  page.drawText(text, { x: (page.getWidth() - w) / 2, y, size: s, font, color });
}

function spaced(text: string) {
  return text.split("").join(" ");
}

export async function certificatePdf(cert: Certificate, verifyUrl: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certificate ${cert.code}`);
  pdf.setAuthor("Uhandisi School");
  pdf.setSubject(`${safe(cert.studentName)}: ${safe(cert.courseTitle)}`);
  const page = pdf.addPage([842, 595]);
  const { width, height } = page.getSize();
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const serifItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 22, y: 22, width: width - 44, height: height - 44, borderColor: navy, borderWidth: 5 });
  page.drawRectangle({ x: 34, y: 34, width: width - 68, height: height - 68, borderColor: sand, borderWidth: 1.5 });

  let top = height - 88;
  if (existsSync(logoPath)) {
    try {
      const logo = await pdf.embedPng(await readFile(logoPath));
      const w = 190;
      const h = (logo.height / logo.width) * w;
      page.drawImage(logo, { x: (width - w) / 2, y: top - h, width: w, height: h });
      top -= h + 24;
    } catch { /* not a PNG: skip the logo */ }
  }

  centered(page, spaced("CERTIFICATE OF COMPLETION"), top - 6, sansBold, 13, blue);
  centered(page, "This is to certify that", top - 46, serifItalic, 16, grey);
  centered(page, safe(cert.studentName) || "Student", top - 98, serif, 42, navy, 680);
  page.drawLine({ start: { x: width / 2 - 220, y: top - 112 }, end: { x: width / 2 + 220, y: top - 112 }, thickness: 1, color: sand });
  centered(page, "has successfully completed the course", top - 142, serifItalic, 16, grey);
  centered(page, safe(cert.courseTitle), top - 180, sansBold, 24, navy, 700);
  if (cert.percent !== null && cert.percent !== undefined) {
    centered(page, `with a final score of ${Math.round(cert.percent)}%`, top - 208, sans, 13, grey);
  }

  // Footer: date, issuer, code.
  // Without a score line there's more room, so the footer moves up to keep the page balanced.
  const baseY = cert.percent === null || cert.percent === undefined ? 126 : 104;
  const issued = cert.issuedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const block = (label: string, value: string, cx: number) => {
    page.drawLine({ start: { x: cx - 95, y: baseY + 20 }, end: { x: cx + 95, y: baseY + 20 }, thickness: 0.8, color: navy });
    const vw = sansBold.widthOfTextAtSize(value, 12);
    page.drawText(value, { x: cx - vw / 2, y: baseY + 26, size: 12, font: sansBold, color: navy });
    const lw = sans.widthOfTextAtSize(label, 9);
    page.drawText(label, { x: cx - lw / 2, y: baseY + 6, size: 9, font: sans, color: grey });
  };
  block("Date of issue", issued, 200);
  block("Issued by", "Uhandisi School", width / 2);
  block("Certificate code", cert.code, width - 200);
  centered(page, `Verify this certificate at ${verifyUrl}`, 52, sans, 9, grey, 740);

  return Buffer.from(await pdf.save());
}

// ---------------------------------------------------------------------------------------------
// Admin-designed templates: an uploaded PDF page or image as the background, with text fields.
// ---------------------------------------------------------------------------------------------

export const FONTS = {
  helvetica: StandardFonts.Helvetica,
  "helvetica-bold": StandardFonts.HelveticaBold,
  times: StandardFonts.TimesRoman,
  "times-bold": StandardFonts.TimesRomanBold,
  "times-italic": StandardFonts.TimesRomanItalic,
  courier: StandardFonts.Courier,
} as const;
export type FontKey = keyof typeof FONTS;

/** A text box on the template. x/y are fractions of the page (y = the text's baseline, from the top). */
export type TemplateField = {
  id: string; label: string; text: string; x: number; y: number; size: number; font: FontKey;
  color: string; align: "left" | "center" | "right"; visible: boolean;
};

export type CertificateValues = { name: string; course: string; date: string; score: string; code: string; verify_url: string };

/** Sensible starting positions for a new template; the admin drags them into place. */
export function defaultFields(width: number): TemplateField[] {
  const s = (f: number) => Math.round(width * f);
  const f = (id: string, label: string, text: string, y: number, size: number, font: FontKey, color = "#0B2D5C"): TemplateField =>
    ({ id, label, text, x: 0.5, y, size, font, color, align: "center", visible: true });
  return [
    f("name", "Student name", "{name}", 0.46, s(0.05), "times-bold"),
    f("course", "Course", "{course}", 0.58, s(0.028), "helvetica-bold"),
    f("date", "Date", "Issued on {date}", 0.68, s(0.016), "helvetica", "#5b6a7d"),
    f("score", "Score", "Final score: {score}%", 0.73, s(0.016), "helvetica", "#5b6a7d"),
    f("code", "Certificate code", "Certificate code: {code}", 0.86, s(0.013), "helvetica-bold"),
    f("verify", "Verify link", "Verify at {verify_url}", 0.9, s(0.011), "helvetica", "#5b6a7d"),
  ];
}

export function fillPlaceholders(text: string, values: CertificateValues) {
  return text.replace(/\{(name|course|date|score|code|verify_url)\}/g, (_, k: keyof CertificateValues) => values[k] ?? "");
}
// A field that uses a value we don't have (e.g. {score} on a hand-issued certificate) is left out.
const usesEmptyValue = (text: string, values: CertificateValues) =>
  [...text.matchAll(/\{(name|course|date|score|code|verify_url)\}/g)].some((m) => !values[m[1] as keyof CertificateValues]);

function hexColor(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0x0b2d5c;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export type TemplateSource = { kind: string; bytes: Buffer; pageWidth: number; pageHeight: number; fields: TemplateField[] };

export async function templatePdf(tpl: TemplateSource, values: CertificateValues, title = "Certificate") {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor("Uhandisi School");
  const page = pdf.addPage([tpl.pageWidth, tpl.pageHeight]);
  if (tpl.kind === "pdf") {
    const [bg] = await pdf.embedPdf(tpl.bytes, [0]);
    page.drawPage(bg!, { x: 0, y: 0, width: tpl.pageWidth, height: tpl.pageHeight });
  } else {
    const isPng = tpl.bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const img = isPng ? await pdf.embedPng(tpl.bytes) : await pdf.embedJpg(tpl.bytes);
    page.drawImage(img, { x: 0, y: 0, width: tpl.pageWidth, height: tpl.pageHeight });
  }
  const fonts = new Map<FontKey, PDFFont>();
  for (const f of tpl.fields) {
    if (!f.visible || usesEmptyValue(f.text, values)) continue;
    const text = safe(fillPlaceholders(f.text, values));
    if (!text) continue;
    const key = (f.font in FONTS ? f.font : "helvetica") as FontKey;
    if (!fonts.has(key)) fonts.set(key, await pdf.embedFont(FONTS[key]));
    const font = fonts.get(key)!;
    // Shrink long names/titles so they stay on the page.
    let size = Math.max(4, Math.min(200, f.size));
    const room = f.align === "center" ? 2 * Math.min(f.x, 1 - f.x) * tpl.pageWidth : f.align === "left" ? (1 - f.x) * tpl.pageWidth : f.x * tpl.pageWidth;
    while (size > 6 && font.widthOfTextAtSize(text, size) > room * 0.96) size -= 0.5;
    const w = font.widthOfTextAtSize(text, size);
    const x = f.x * tpl.pageWidth - (f.align === "center" ? w / 2 : f.align === "right" ? w : 0);
    page.drawText(text, { x, y: tpl.pageHeight - f.y * tpl.pageHeight, size, font, color: hexColor(f.color) });
  }
  return Buffer.from(await pdf.save());
}

export function certificateValues(cert: Pick<Certificate, "studentName" | "courseTitle" | "issuedAt" | "percent" | "code">, verifyUrl: string): CertificateValues {
  return {
    name: cert.studentName,
    course: cert.courseTitle,
    date: cert.issuedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    score: cert.percent === null || cert.percent === undefined ? "" : String(Math.round(cert.percent)),
    code: cert.code,
    verify_url: verifyUrl,
  };
}

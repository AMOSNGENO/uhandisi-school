import type { Request } from "express";
import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

// Email goes out over SMTP (Gmail, Zoho, your web host's mail server...). Until SMTP_HOST is set,
// nothing is sent and admins hand out reset links themselves from Admin → Users.
export const isMailConfigured = () => !!process.env.SMTP_HOST;

let transport: Transporter | null = null;
function transporter() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

const LOCAL_HOST = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/;

/**
 * The site address for links in certificates (QR codes) and messages. It's the address the request
 * came in on, so links keep working whichever domain the site is served from (a stale PUBLIC_URL
 * once pointed every link at a domain that wasn't serving the app). PUBLIC_URL is only used for
 * requests from this PC (localhost).
 */
export function publicOrigin(req: Request) {
  const host = req.host;
  if (host && !LOCAL_HOST.test(host)) return `https://${host}`;
  return (process.env.PUBLIC_URL || `${req.protocol}://${host}`).replace(/\/+$/, "");
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Sends a short email with an optional code or button. Returns false (and logs why) when it couldn't be sent. */
export async function sendMail(to: string, subject: string, body: { greeting: string; paragraphs: string[]; code?: string; button?: { label: string; url: string }; footer?: string }) {
  if (!isMailConfigured()) {
    logger.info({ to, subject }, "email not sent: SMTP is not configured");
    return false;
  }
  const text = [body.greeting, "", ...body.paragraphs.flatMap((p) => [p, ""]), ...(body.code ? [`Your code: ${body.code}`, ""] : []), ...(body.button ? [`${body.button.label}: ${body.button.url}`, ""] : []), body.footer ?? "", "Uhandisi School"].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1d2125;line-height:1.55">
  <p style="font-size:18px;font-weight:bold;color:#b01e23;margin:0 0 18px">Uhandisi School</p>
  <p>${escapeHtml(body.greeting)}</p>
  ${body.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n  ")}
  ${body.code ? `<p style="margin:26px 0;font-family:'Courier New',monospace;font-size:32px;font-weight:bold;letter-spacing:8px;background:#f4f1ec;border-radius:8px;padding:14px 0;text-align:center">${escapeHtml(body.code)}</p>` : ""}
  ${body.button ? `<p style="margin:26px 0"><a href="${escapeHtml(body.button.url)}" style="background:#b01e23;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px;display:inline-block">${escapeHtml(body.button.label)}</a></p>
  <p style="font-size:12px;color:#6a737b">If the button doesn't work, copy this link into your browser:<br>${escapeHtml(body.button.url)}</p>` : ""}
  ${body.footer ? `<p style="font-size:12px;color:#6a737b">${escapeHtml(body.footer)}</p>` : ""}
</div>`;
  try {
    await transporter().sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, html });
    lastError = "";
    return true;
  } catch (err) {
    logger.error({ err, to, subject }, "email failed to send");
    lastError = err instanceof Error ? err.message : String(err);
    return false;
  }
}

// The mail server's reason for the most recent failure, shown to admins so they needn't dig through logs.
let lastError = "";
export const lastMailError = () => lastError;

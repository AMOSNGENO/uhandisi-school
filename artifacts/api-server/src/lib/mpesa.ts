// Safaricom Daraja (M-Pesa Express / STK push).
// Configured from Admin → Payments (saved in site_settings as "mpesa"), falling back to
// environment variables (see artifacts/api-server/.env.example).
// With no credentials set, payments are recorded as pending and confirmed by an admin.

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, siteSettingsTable } from "@workspace/db";

type MpesaEnv = "sandbox" | "production";

// Safaricom's public test paybill and its passkey (Daraja → Test credentials). Same for every sandbox app.
const SANDBOX_SHORTCODE = "174379";
const SANDBOX_PASSKEY = "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";

// Settings an admin can save from the dashboard; each overrides the .env line of the same name.
export const MPESA_FIELDS = [
  "MPESA_ENV", "MPESA_TRANSACTION_TYPE", "MPESA_SHORTCODE", "MPESA_TILL_NUMBER",
  "MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_PASSKEY", "MPESA_CALLBACK_URL",
] as const;
export type MpesaField = (typeof MPESA_FIELDS)[number];
export const MPESA_SECRET_FIELDS: MpesaField[] = ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_PASSKEY"];

const SETTINGS_ROW = "mpesa";
let saved: Partial<Record<MpesaField, string>> = {};
let savedLoadedAt = 0;
// Re-read now and then, so every server process sees a change saved by another.
const SAVED_TTL_MS = 30_000;

export async function loadMpesaSettings(force = false) {
  if (!force && Date.now() - savedLoadedAt < SAVED_TTL_MS) return;
  const [row] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.name, SETTINGS_ROW)).limit(1);
  try { saved = row ? JSON.parse(row.value) : {}; } catch { saved = {}; }
  savedLoadedAt = Date.now();
}

/** Merges into the saved settings. An empty string clears a field, so its .env value (if any) applies again. */
export async function saveMpesaSettings(patch: Partial<Record<MpesaField, string>>) {
  await loadMpesaSettings(true);
  const next = { ...saved };
  for (const [name, value] of Object.entries(patch) as Array<[MpesaField, string]>) {
    if (value.trim()) next[name] = value.trim(); else delete next[name];
  }
  const value = JSON.stringify(next);
  await db.insert(siteSettingsTable).values({ name: SETTINGS_ROW, value }).onDuplicateKeyUpdate({ set: { value } });
  saved = next;
  savedLoadedAt = Date.now();
  cachedToken = null;
}

/** Where each field's value comes from, without revealing secrets. */
export function mpesaSettingsView() {
  return Object.fromEntries(MPESA_FIELDS.map((name) => {
    const source = saved[name] ? "dashboard" : (process.env[name] ?? "").trim() ? "env" : null;
    const value = setting(name);
    return [name, { source, value: MPESA_SECRET_FIELDS.includes(name) ? (value ? `••••${value.slice(-4)}` : "") : value }];
  })) as Record<MpesaField, { source: "dashboard" | "env" | null; value: string }>;
}

const setting = (name: string) => (saved[name as MpesaField] || process.env[name] || "").trim();

const env = () => {
  const environment: MpesaEnv = setting("MPESA_ENV") === "production" ? "production" : "sandbox";
  const sandbox = environment === "sandbox";
  const consumerSecret = setting("MPESA_CONSUMER_SECRET");
  const publicUrl = setting("PUBLIC_URL").replace(/\/+$/, "");
  // Paybill: CustomerPayBillOnline. Till number (Buy Goods): CustomerBuyGoodsOnline, with MPESA_TILL_NUMBER as PartyB.
  const transactionType = setting("MPESA_TRANSACTION_TYPE") === "CustomerBuyGoodsOnline" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline";
  const tillNumber = setting("MPESA_TILL_NUMBER");
  return {
    environment,
    consumerKey: setting("MPESA_CONSUMER_KEY"),
    consumerSecret,
    // A till's store (head office) number; many single tills use the till number itself.
    shortcode: setting("MPESA_SHORTCODE") || (sandbox ? SANDBOX_SHORTCODE : transactionType === "CustomerBuyGoodsOnline" ? tillNumber : ""),
    passkey: setting("MPESA_PASSKEY") || (sandbox ? SANDBOX_PASSKEY : ""),
    transactionType,
    tillNumber,
    // Defaults to the site's own address, so PUBLIC_URL is enough.
    callbackUrl: setting("MPESA_CALLBACK_URL") || (publicUrl ? `${publicUrl}/api/mpesa/callback` : ""),
    // Placeholder secrets count as unset; then one is derived from the consumer secret, which only this server knows.
    callbackSecret: (/^(|replace-.*)$/.test(setting("MPESA_CALLBACK_SECRET")) ? "" : setting("MPESA_CALLBACK_SECRET"))
      || (consumerSecret ? createHash("sha256").update(`uhandisi-callback:${consumerSecret}`).digest("hex").slice(0, 40) : ""),
  };
};

const baseUrl = (environment: MpesaEnv) =>
  environment === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";

export function mpesaStatus() {
  const c = env();
  const required = {
    MPESA_CONSUMER_KEY: c.consumerKey, MPESA_CONSUMER_SECRET: c.consumerSecret, MPESA_SHORTCODE: c.shortcode,
    MPESA_PASSKEY: c.passkey,
    ...(c.transactionType === "CustomerBuyGoodsOnline" ? { MPESA_TILL_NUMBER: c.tillNumber } : {}),
  };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  // Without a callback address payments still confirm: the app asks Safaricom while the student waits.
  return { configured: missing.length === 0, environment: c.environment, missing, callbackUrl: c.callbackUrl || null };
}

// Daraja insists on an https CallBackURL even when nothing can receive it (e.g. a PC with no PUBLIC_URL).
const UNREACHABLE_CALLBACK = "https://example.com/mpesa/callback";

export const isMpesaConfigured = () => mpesaStatus().configured;

/** 07XXXXXXXX / 01XXXXXXXX / 2547XXXXXXXX / +2547XXXXXXXX -> 2547XXXXXXXX, or null if not a Kenyan mobile number. */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, "");
  const local = digits.startsWith("254") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[17]\d{8}$/.test(local) ? `254${local}` : null;
}

let cachedToken: { value: string; expiresAt: number; key: string } | null = null;

async function accessToken(): Promise<string> {
  const c = env();
  const cacheKey = `${c.environment}:${c.consumerKey}`;
  if (cachedToken && cachedToken.key === cacheKey && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const auth = Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString("base64");
  const res = await fetch(`${baseUrl(c.environment)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new MpesaError(`Safaricom rejected the consumer key/secret (HTTP ${res.status}). Check they are for ${c.environment === "production" ? "your live (Go-Live) app" : "a sandbox app"}.`);
  const data = (await res.json()) as { access_token: string; expires_in: string | number };
  // Refresh a minute early.
  cachedToken = { value: data.access_token, key: cacheKey, expiresAt: Date.now() + (Number(data.expires_in) - 60) * 1000 };
  return data.access_token;
}

export class MpesaError extends Error {}

/** Checks the keys with Safaricom by asking for an access token. Throws MpesaError if they're wrong. */
export async function checkMpesaKeys() {
  cachedToken = null;
  await accessToken();
}

function timestamp() {
  // Daraja wants YYYYMMDDHHmmss in Kenyan time (UTC+3, no DST).
  const eat = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return eat.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

async function darajaPost<T>(path: string, body: unknown): Promise<T> {
  const c = env();
  const res = await fetch(`${baseUrl(c.environment)}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { errorMessage?: string };
  if (!res.ok) throw new MpesaError(data.errorMessage || `Daraja request failed (HTTP ${res.status}).`);
  return data;
}

function password(c: ReturnType<typeof env>, ts: string) {
  return Buffer.from(`${c.shortcode}${c.passkey}${ts}`).toString("base64");
}

/** Sends the payment prompt to the customer's phone. Returns Safaricom's CheckoutRequestID. */
export async function sendStkPush(input: { phone: string; amount: number; accountReference: string; description: string }) {
  const c = env();
  const ts = timestamp();
  const callback = new URL(c.callbackUrl || UNREACHABLE_CALLBACK);
  if (c.callbackUrl) callback.searchParams.set("secret", c.callbackSecret);
  const data = await darajaPost<{ ResponseCode: string; ResponseDescription: string; CheckoutRequestID: string; CustomerMessage: string }>(
    "/mpesa/stkpush/v1/processrequest",
    {
      BusinessShortCode: c.shortcode,
      Password: password(c, ts),
      Timestamp: ts,
      TransactionType: c.transactionType,
      Amount: Math.round(input.amount),
      PartyA: input.phone,
      PartyB: c.transactionType === "CustomerBuyGoodsOnline" ? c.tillNumber : c.shortcode,
      PhoneNumber: input.phone,
      CallBackURL: callback.toString(),
      // Daraja limits: AccountReference 12 chars, TransactionDesc 13 chars.
      AccountReference: input.accountReference.slice(0, 12),
      TransactionDesc: input.description.slice(0, 13),
    },
  );
  if (data.ResponseCode !== "0") throw new MpesaError(data.ResponseDescription || "M-Pesa did not accept the request.");
  return { checkoutRequestId: data.CheckoutRequestID, customerMessage: data.CustomerMessage };
}

/** Asks Safaricom what happened to a prompt. resultCode 0 = paid; null = still waiting for the customer. */
export async function queryStkStatus(checkoutRequestId: string) {
  const c = env();
  const ts = timestamp();
  try {
    const data = await darajaPost<{ ResultCode?: string; ResultDesc?: string }>("/mpesa/stkpushquery/v1/query", {
      BusinessShortCode: c.shortcode,
      Password: password(c, ts),
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    });
    return { resultCode: data.ResultCode === undefined ? null : Number(data.ResultCode), resultDescription: data.ResultDesc ?? "" };
  } catch (e) {
    // Daraja answers "The transaction is being processed" with an error status while the prompt is open.
    if (e instanceof MpesaError && /being processed/i.test(e.message)) return { resultCode: null, resultDescription: e.message };
    throw e;
  }
}

export type CallbackResult = {
  checkoutRequestId: string;
  resultCode: number;
  resultDescription: string;
  mpesaReceipt?: string | null;
  amount?: number | null;
  phoneNumber?: string | null;
};

/** Reads Daraja's callback shape: { Body: { stkCallback: { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } } }. */
export function parseDarajaCallback(body: unknown): CallbackResult | null {
  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== "string") return null;
  const items = ((cb.CallbackMetadata as { Item?: Array<{ Name: string; Value?: unknown }> })?.Item ?? []);
  const item = (name: string) => items.find((i) => i.Name === name)?.Value;
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: Number(cb.ResultCode),
    resultDescription: String(cb.ResultDesc ?? ""),
    mpesaReceipt: item("MpesaReceiptNumber") != null ? String(item("MpesaReceiptNumber")) : null,
    amount: item("Amount") != null ? Math.round(Number(item("Amount"))) : null,
    phoneNumber: item("PhoneNumber") != null ? String(item("PhoneNumber")) : null,
  };
}

/** The callback URL carries ?secret=… so random callers can't mark payments as paid. */
export function callbackAllowed(secret: unknown) {
  const expected = env().callbackSecret;
  if (!expected) return process.env.NODE_ENV !== "production";
  return typeof secret === "string" && secret === expected;
}

// Safaricom Daraja (M-Pesa Express / STK push).
// Configured entirely from environment variables; see artifacts/api-server/.env.example.
// With no credentials set, payments are recorded as pending and confirmed by an admin.

type MpesaEnv = "sandbox" | "production";

const env = () => ({
  environment: (process.env.MPESA_ENV === "production" ? "production" : "sandbox") as MpesaEnv,
  consumerKey: process.env.MPESA_CONSUMER_KEY ?? "",
  consumerSecret: process.env.MPESA_CONSUMER_SECRET ?? "",
  shortcode: process.env.MPESA_SHORTCODE ?? "",
  passkey: process.env.MPESA_PASSKEY ?? "",
  // Paybill: CustomerPayBillOnline. Till number (Buy Goods): CustomerBuyGoodsOnline, with MPESA_TILL_NUMBER as PartyB.
  transactionType: process.env.MPESA_TRANSACTION_TYPE === "CustomerBuyGoodsOnline" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
  tillNumber: process.env.MPESA_TILL_NUMBER ?? "",
  callbackUrl: process.env.MPESA_CALLBACK_URL ?? "",
  callbackSecret: process.env.MPESA_CALLBACK_SECRET ?? "",
});

const baseUrl = (environment: MpesaEnv) =>
  environment === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";

export function mpesaStatus() {
  const c = env();
  const required = {
    MPESA_CONSUMER_KEY: c.consumerKey, MPESA_CONSUMER_SECRET: c.consumerSecret, MPESA_SHORTCODE: c.shortcode,
    MPESA_PASSKEY: c.passkey, MPESA_CALLBACK_URL: c.callbackUrl, MPESA_CALLBACK_SECRET: c.callbackSecret,
    ...(c.transactionType === "CustomerBuyGoodsOnline" ? { MPESA_TILL_NUMBER: c.tillNumber } : {}),
  };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  return { configured: missing.length === 0, environment: c.environment, missing };
}

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
  if (!res.ok) throw new MpesaError(`Daraja rejected the consumer key/secret (HTTP ${res.status}).`);
  const data = (await res.json()) as { access_token: string; expires_in: string | number };
  // Refresh a minute early.
  cachedToken = { value: data.access_token, key: cacheKey, expiresAt: Date.now() + (Number(data.expires_in) - 60) * 1000 };
  return data.access_token;
}

export class MpesaError extends Error {}

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
  const callback = new URL(c.callbackUrl);
  callback.searchParams.set("secret", c.callbackSecret);
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

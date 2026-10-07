import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  CreateStkPushBody,
  CreateStkPushResponse,
  ProcessMpesaCallbackBody,
  ProcessMpesaCallbackResponse,
} from "@workspace/api-zod";
import { coursesTable, db, paymentsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { enroll } from "../lib/courses";
import { logger } from "../lib/logger";
import {
  callbackAllowed, isMpesaConfigured, loadMpesaSettings, MpesaError, normalizeKenyanPhone, parseDarajaCallback, queryStkStatus,
  sendStkPush, type CallbackResult,
} from "../lib/mpesa";

const router: IRouter = Router();

// M-Pesa settings saved from the dashboard (cached; re-read every 30 seconds).
router.use(["/payments", "/mpesa"], async (_req, _res, next) => {
  try { await loadMpesaSettings(); next(); } catch (e) { next(e); }
});

/** Applies an M-Pesa result to the matching pending payment. Returns whether it was credited. */
export async function applyMpesaResult(result: CallbackResult) {
  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.checkoutRequestId, result.checkoutRequestId))
    .limit(1);
  if (!payment) return { found: false, credited: false };
  // Only a pending payment can change; repeated callbacks are ignored.
  if (payment.status !== "pending") return { found: true, credited: false };

  if (result.resultCode === 0) {
    await db
      .update(paymentsTable)
      .set({
        status: "completed",
        receipt: result.mpesaReceipt ?? null,
        phoneNumber: result.phoneNumber ?? payment.phoneNumber,
        amount: result.amount ?? payment.amount,
      })
      .where(eq(paymentsTable.id, payment.id));
    return { found: true, credited: true };
  }
  // 1032 = customer cancelled the prompt; anything else is a failure.
  await db
    .update(paymentsTable)
    .set({ status: result.resultCode === 1032 ? "cancelled" : "failed" })
    .where(eq(paymentsTable.id, payment.id));
  return { found: true, credited: false };
}

router.post("/payments/stk-push", requireAuth, async (req, res) => {
  const parsed = CreateStkPushBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const phone = normalizeKenyanPhone(parsed.data.phoneNumber);
  if (!phone) {
    res.status(400).json({ error: "Enter a Safaricom number like 0712 345 678." });
    return;
  }

  const [course] = await db
    .select({ id: coursesTable.id, title: coursesTable.title })
    .from(coursesTable)
    .where(and(eq(coursesTable.id, parsed.data.courseId), eq(coursesTable.published, true)))
    .limit(1);
  if (!course) {
    res.status(400).json({ error: "Course not found" });
    return;
  }

  let checkoutRequestId = `manual_${Date.now()}_${req.user!.id}`;
  let message = "Payment recorded. An administrator will confirm it.";
  if (isMpesaConfigured()) {
    try {
      const sent = await sendStkPush({
        phone,
        amount: parsed.data.amount,
        accountReference: `UHS${course.id}U${req.user!.id}`,
        description: "Uhandisi fees",
      });
      checkoutRequestId = sent.checkoutRequestId;
      message = sent.customerMessage || "Payment request sent to your phone.";
    } catch (e) {
      req.log.error({ err: e }, "STK push failed");
      res.status(502).json({ error: e instanceof MpesaError ? `M-Pesa: ${e.message}` : "Could not reach M-Pesa. Try again." });
      return;
    }
  }

  const [result] = await db.insert(paymentsTable).values({
    userId: req.user!.id,
    courseId: course.id,
    amount: parsed.data.amount,
    status: "pending",
    phoneNumber: phone,
    receipt: null,
    checkoutRequestId,
    createdAt: new Date(),
  });
  await enroll(req.user!.id, course.id);

  res.status(202).json(CreateStkPushResponse.parse({ id: result.insertId, status: "pending", message, checkoutRequestId }));
});

// When each payment was last asked about, so a waiting browser can't flood Daraja (it rate-limits).
const lastQueried = new Map<number, number>();
const QUERY_GAP_MS = 5000;

// The payment screen polls this while the student answers the prompt. If the callback hasn't
// arrived (or can't, e.g. on a PC), it asks Safaricom directly, so payments confirm either way.
router.get("/payments/:id/status", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "Invalid payment id" });
  const find = async () => (await db
    .select()
    .from(paymentsTable)
    .where(and(eq(paymentsTable.id, id), eq(paymentsTable.userId, req.user!.id)))
    .limit(1))[0];
  let payment = await find();
  if (!payment) return void res.status(404).json({ error: "Payment not found" });

  let message = "";
  const viaMpesa = payment.checkoutRequestId && !payment.checkoutRequestId.startsWith("manual_");
  const due = Date.now() - (lastQueried.get(id) ?? 0) >= QUERY_GAP_MS;
  if (payment.status === "pending" && viaMpesa && isMpesaConfigured() && due) {
    lastQueried.set(id, Date.now());
    try {
      const status = await queryStkStatus(payment.checkoutRequestId!);
      message = status.resultDescription;
      if (status.resultCode !== null) {
        await applyMpesaResult({ checkoutRequestId: payment.checkoutRequestId!, resultCode: status.resultCode, resultDescription: status.resultDescription });
        payment = (await find()) ?? payment;
      }
    } catch (e) {
      // Not fatal: the callback may still arrive, and the next poll tries again.
      req.log.warn({ err: e, paymentId: id }, "STK status query failed");
    }
  }
  if (payment.status !== "pending") lastQueried.delete(id);
  res.json({ id: payment.id, status: payment.status, receipt: payment.receipt, amount: payment.amount, message });
});

// Safaricom calls this with the result of each prompt. MPESA_CALLBACK_URL (or PUBLIC_URL) must point here, publicly reachable.
router.post("/mpesa/callback", async (req, res) => {
  if (!callbackAllowed(req.query.secret)) {
    logger.warn({ ip: req.ip }, "Rejected M-Pesa callback with a missing or wrong secret");
    res.status(403).json({ ResultCode: 1, ResultDesc: "Forbidden" });
    return;
  }

  const daraja = parseDarajaCallback(req.body);
  if (daraja) {
    const outcome = await applyMpesaResult(daraja);
    logger.info({ checkoutRequestId: daraja.checkoutRequestId, resultCode: daraja.resultCode, ...outcome }, "M-Pesa callback");
    // Daraja only needs an acknowledgement.
    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    return;
  }

  // Simplified shape from the API spec, handy for testing by hand.
  const parsed = ProcessMpesaCallbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const outcome = await applyMpesaResult(parsed.data);
  res.json(ProcessMpesaCallbackResponse.parse({ accepted: outcome.found, credited: outcome.credited }));
});

export default router;

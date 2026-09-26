import { Router, type IRouter } from "express";
import {
  CreateStkPushBody,
  CreateStkPushResponse,
  ProcessMpesaCallbackBody,
  ProcessMpesaCallbackResponse,
} from "@workspace/api-zod";
import { createPendingPayment, payments } from "../lib/uhandisi-data";

const router: IRouter = Router();

router.post("/payments/stk-push", (req, res) => {
  const parsed = CreateStkPushBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const payment = createPendingPayment(parsed.data);
  if (!payment) {
    res.status(400).json({ error: "Course not found" });
    return;
  }

  res.status(202).json(
    CreateStkPushResponse.parse({
      id: payment.id,
      status: "pending",
      message: "Payment request sent to your phone.",
      checkoutRequestId: payment.checkoutRequestId,
    }),
  );
});

router.post("/mpesa/callback", (req, res) => {
  const parsed = ProcessMpesaCallbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const payment = payments.find((item) => item.checkoutRequestId === parsed.data.checkoutRequestId);
  if (!payment) {
    res.json(ProcessMpesaCallbackResponse.parse({ accepted: false, credited: false }));
    return;
  }

  if (payment.status !== "pending") {
    res.json(ProcessMpesaCallbackResponse.parse({ accepted: true, credited: false }));
    return;
  }

  if (parsed.data.resultCode === 0) {
    payment.status = "completed";
    payment.receipt = parsed.data.mpesaReceipt ?? null;
    payment.phoneNumber = parsed.data.phoneNumber ?? payment.phoneNumber;
    payment.amount = parsed.data.amount ?? payment.amount;
    res.json(ProcessMpesaCallbackResponse.parse({ accepted: true, credited: true }));
    return;
  }

  payment.status = "failed";
  res.json(ProcessMpesaCallbackResponse.parse({ accepted: true, credited: false }));
});

export default router;
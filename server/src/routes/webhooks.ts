import { Router } from "express";
import { applyWebhookEvent } from "../lib/payments/webhook-process.js";

const router = Router();

router.post("/payments/:provider", async (req, res) => {
  try {
    const result = await applyWebhookEvent(req.params.provider, req.body, {
      headers: req.headers as Record<string, unknown>,
    });
    res.json(result);
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 400;
    res.status(status).json({ error: err instanceof Error ? err.message : "Webhook failed" });
  }
});

export default router;

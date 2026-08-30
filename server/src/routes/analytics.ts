import { Router } from "express";
import { ingestUsageEvents } from "../lib/analytics/events.js";

const router = Router();

router.post("/events", async (req, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  const count = await ingestUsageEvents(events);
  res.json({ accepted: count });
});

export default router;

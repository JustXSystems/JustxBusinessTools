import { Router } from "express";
import { listAuditEvents } from "../../lib/auth/branch-access.js";

const router = Router();

router.get("/", async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json({ events: await listAuditEvents(limit) });
});

export default router;

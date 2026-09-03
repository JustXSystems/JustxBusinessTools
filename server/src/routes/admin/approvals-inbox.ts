import { Router } from "express";
import { loadPendingInbox } from "../../lib/admin/pending-inbox.js";

const router = Router();

router.get("/inbox", async (_req, res) => {
  const { items, summary } = await loadPendingInbox();
  res.json({
    items,
    summary: {
      total: summary.total,
      profiles: summary.profiles,
      users: summary.users,
      paymentOps: summary.deskOps,
      upiClaims: summary.upiClaims,
      upiAmountInr: summary.upiAmountInr,
    },
  });
});

export default router;

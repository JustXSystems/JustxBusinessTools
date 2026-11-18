import { Router } from "express";
import { listAdminOrganizations } from "../../lib/admin/tenant-guard.js";

const router = Router();

/** Platform Admin Console org directory (for explicit org pickers). */
router.get("/", async (_req, res) => {
  res.json({ organizations: await listAdminOrganizations() });
});

export default router;

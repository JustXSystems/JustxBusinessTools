import { Router } from "express";
import { pool } from "../db.js";
import { getProcessRole } from "../lib/process-role.js";

const router = Router();

/**
 * Public status payload for /status page and deploy probes.
 * Does not expose secrets — only liveness signals.
 */
router.get("/", async (_req, res) => {
  let db: "ok" | "error" = "ok";
  try {
    await pool.query("SELECT 1");
  } catch {
    db = "error";
  }
  const ok = db === "ok";
  res.status(ok ? 200 : 503).json({
    ok,
    service: "justx-api",
    db,
    role: getProcessRole(),
    checkedAt: new Date().toISOString(),
    components: {
      api: "ok",
      database: db,
    },
  });
});

export default router;

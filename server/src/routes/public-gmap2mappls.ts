import { Router } from "express";
import { resolveGmap2Mappls, resolveMeta } from "../lib/gmap2mappls/resolve.js";

const router = Router();

router.get("/meta", (_req, res) => {
  res.json(resolveMeta());
});

router.post("/resolve", async (req, res) => {
  const input = String(req.body?.input ?? req.body?.q ?? "").trim();
  const result = await resolveGmap2Mappls(input);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

export default router;

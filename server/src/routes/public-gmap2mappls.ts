import { Router } from "express";
import { resolveGmap2Mappls, resolveMeta } from "../lib/gmap2mappls/resolve.js";
import { getActiveProfileId, getActiveUserId } from "../lib/request-context.js";
import { licensedOrIncluded } from "../lib/tool-licenses.js";

const PINWAY_TOOL_ID = "gmap2mappls";

const router = Router();

router.get("/meta", (_req, res) => {
  res.json(resolveMeta());
});

router.post("/resolve", async (req, res) => {
  const userId = getActiveUserId();
  if (!userId) {
    res.status(401).json({
      ok: false,
      error: "Sign in to use Google Maps to Mappls. New accounts get 14 days free.",
      code: "auth_required",
    });
    return;
  }

  const profileId = getActiveProfileId();
  const entitled = await licensedOrIncluded(profileId, PINWAY_TOOL_ID);
  if (!entitled) {
    res.status(402).json({
      ok: false,
      error: "Google Maps to Mappls needs an active trial or subscription (₹100/mo or ₹1000/yr).",
      code: "license_required",
      toolId: PINWAY_TOOL_ID,
    });
    return;
  }

  const input = String(req.body?.input ?? req.body?.q ?? "").trim();
  const result = await resolveGmap2Mappls(input);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

export default router;

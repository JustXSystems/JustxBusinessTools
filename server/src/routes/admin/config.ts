import { Router } from "express";
import { getPlatformBranding, savePlatformBranding } from "../../lib/config/branding.js";
import { getPoweredBy, savePoweredBy } from "../../lib/config/powered-by.js";
import { getEffectiveConfig, listToolDefinitions, publishToolDefinition } from "../../lib/config/effective.js";

const router = Router();

router.get("/effective", async (_req, res) => {
  res.json(await getEffectiveConfig());
});

router.get("/tools", async (_req, res) => {
  res.json({ tools: await listToolDefinitions() });
});

router.post("/tools/:toolId", async (req, res) => {
  const definition = req.body?.definition;
  if (!definition || typeof definition !== "object") {
    res.status(400).json({ error: "definition object required" });
    return;
  }
  const result = await publishToolDefinition(req.params.toolId, definition as Record<string, unknown>);
  res.json(result);
});

router.get("/platform", async (_req, res) => {
  const { pool } = await import("../../db.js");
  const [rows] = await pool.query(`SELECT config_key, value FROM platform_config`);
  const config: Record<string, unknown> = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const r = row as { config_key: string; value: string | Record<string, unknown> };
    config[r.config_key] =
      typeof r.value === "string" ? JSON.parse(r.value) : r.value;
  }
  if (!config.branding) {
    config.branding = await getPlatformBranding();
  }
  if (!config.powered_by) {
    config.powered_by = await getPoweredBy();
  }
  res.json({ config });
});

router.put("/branding", async (req, res) => {
  try {
    const branding = await savePlatformBranding({
      logo: req.body?.logo,
      logoUrl: req.body?.logoUrl,
      appName: req.body?.appName,
      tagline: req.body?.tagline,
      splashDurationMs: req.body?.splashDurationMs,
      splashAnimation: req.body?.splashAnimation,
      splashIntensity: req.body?.splashIntensity,
      splashShowProgress: req.body?.splashShowProgress,
      clearLogo: Boolean(req.body?.clearLogo),
      installName: req.body?.installName,
      installIcon: req.body?.installIcon,
      installIconUrl: req.body?.installIconUrl,
      installIconBg: req.body?.installIconBg,
      clearInstallIcon: Boolean(req.body?.clearInstallIcon),
    });
    res.json({ branding });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Save failed" });
  }
});

router.put("/powered-by", async (req, res) => {
  try {
    const text = String(req.body?.text ?? "").trim();
    if (!text) {
      res.status(400).json({ error: "Footer text is required" });
      return;
    }
    const poweredBy = await savePoweredBy({
      text,
      locked: req.body?.locked == null ? true : Boolean(req.body.locked),
    });
    res.json({ poweredBy });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Save failed" });
  }
});

export default router;

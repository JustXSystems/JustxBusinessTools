import { Router } from "express";
import { getPlatformBranding, savePlatformBranding } from "../../lib/config/branding.js";
import { getPoweredBy, savePoweredBy } from "../../lib/config/powered-by.js";
import {
  getRegistrationCopy,
  saveRegistrationCopy,
} from "../../lib/config/registration-copy.js";
import { getImsLayout, saveImsLayout } from "../../lib/config/ims-layout.js";
import { getToolGrouping, saveToolGrouping } from "../../lib/config/tool-grouping.js";
import {
  getPublicHome,
  parsePublicHome,
  savePublicHome,
  signPublicHomeMedia,
} from "../../lib/config/public-home.js";
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
  if (!config.registration_copy) {
    config.registration_copy = await getRegistrationCopy();
  }
  if (!config.tool_grouping) {
    config.tool_grouping = await getToolGrouping();
  }
  if (!config.ims_layout) {
    config.ims_layout = await getImsLayout();
  }
  if (!config.public_home) {
    config.public_home = signPublicHomeMedia(await getPublicHome());
  } else {
    config.public_home = signPublicHomeMedia(parsePublicHome(config.public_home));
  }
  res.json({ config });
});

router.get("/public-home", async (_req, res) => {
  res.json({ publicHome: signPublicHomeMedia(await getPublicHome()) });
});

router.put("/public-home", async (req, res) => {
  try {
    if (req.body?.reset) {
      const { DEFAULT_PUBLIC_HOME } = await import("../../lib/config/public-home.js");
      const publicHome = await savePublicHome(structuredClone(DEFAULT_PUBLIC_HOME));
      res.json({ publicHome });
      return;
    }
    const publicHome = await savePublicHome(req.body?.publicHome ?? req.body ?? {});
    res.json({ publicHome });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Save failed" });
  }
});

router.put("/tool-grouping", async (req, res) => {
  try {
    const toolGrouping = await saveToolGrouping({
      enabled: req.body?.enabled == null ? undefined : Boolean(req.body.enabled),
    });
    res.json({ toolGrouping });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Save failed" });
  }
});

router.get("/ims-layout", async (_req, res) => {
  res.json({ imsLayout: await getImsLayout() });
});

router.put("/ims-layout", async (req, res) => {
  try {
    const imsLayout = await saveImsLayout({
      contentWidthPct: req.body?.contentWidthPct == null ? undefined : Number(req.body.contentWidthPct),
    });
    res.json({ imsLayout });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Save failed" });
  }
});

router.put("/registration-copy", async (req, res) => {
  try {
    const registrationCopy = await saveRegistrationCopy(req.body ?? {});
    res.json({ registrationCopy });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Save failed" });
  }
});

router.put("/branding", async (req, res) => {
  try {
    const branding = await savePlatformBranding({
      logo: req.body?.logo,
      logoUrl: req.body?.logoUrl,
      appName: req.body?.appName,
      tagline: req.body?.tagline,
      legalName: req.body?.legalName,
      productName: req.body?.productName,
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
      publishSiteFavicon:
        req.body?.publishSiteFavicon == null ? undefined : Boolean(req.body.publishSiteFavicon),
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

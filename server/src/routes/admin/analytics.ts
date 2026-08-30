import { Router } from "express";
import { pool } from "../../db.js";
import { rollupUsageForDate } from "../../lib/analytics/events.js";
import { getActiveProfileId } from "../../lib/request-context.js";
import { orgEqualsSql, orgScopeParams } from "../../lib/platform-admin.js";

const router = Router();

router.get("/overview", async (req, res) => {
  const { getAnalyticsOverview } = await import("../../lib/analytics/events.js");
  res.json(await getAnalyticsOverview(req.query.days));
});

router.get("/breakdown", async (req, res) => {
  const { getAnalyticsBreakdown } = await import("../../lib/analytics/events.js");
  res.json(await getAnalyticsBreakdown(req.query.days));
});

router.get("/tools/:toolId", async (req, res) => {
  const { getToolAnalytics } = await import("../../lib/analytics/events.js");
  const data = await getToolAnalytics(req.params.toolId, req.query.days);
  res.json({ toolId: req.params.toolId, ...data });
});

router.get("/insights", async (req, res) => {
  const { generateInsights } = await import("../../lib/analytics/insights.js");
  res.json({ insights: await generateInsights(req.query.days) });
});

router.post("/rollup", async (req, res) => {
  const days = Number(req.body?.days ?? 30);
  const [profiles] = await pool.query(
    `SELECT id FROM business_profiles WHERE ${orgEqualsSql("organization_id")}`,
    orgScopeParams(),
  );
  const ids = (Array.isArray(profiles) ? profiles : []).map((p) => Number((p as { id: number }).id));
  const profileIds = ids.length ? ids : [getActiveProfileId()];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const profileId of profileIds) {
    for (let d = 0; d < days; d++) {
      const date = new Date(today.getTime() - d * 86400000);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      await rollupUsageForDate(key, profileId);
    }
  }

  res.json({ ok: true, profiles: profileIds.length, days });
});

export default router;

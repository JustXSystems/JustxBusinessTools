import { Router } from "express";
import {
  exportAuditCsv,
  getAuditOverview,
  listAuditActors,
  listAuditEntities,
  listEnrichedAuditEvents,
  parseAuditFilters,
} from "../../lib/audit-query.js";

const router = Router();

router.get("/overview", async (req, res) => {
  res.json(await getAuditOverview(req.query.days));
});

router.get("/actors", async (req, res) => {
  res.json({ actors: await listAuditActors(req.query.days) });
});

router.get("/entities", async (req, res) => {
  const entityType = req.query.entityType ? String(req.query.entityType) : undefined;
  res.json({ entities: await listAuditEntities(req.query.days, entityType) });
});

router.get("/export", async (req, res) => {
  const filters = parseAuditFilters(req.query as Record<string, unknown>);
  filters.limit = Math.min(5000, Math.max(filters.limit, 500));
  const csv = await exportAuditCsv(filters);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="jbt-audit-${filters.days}d.csv"`,
  );
  res.send(csv);
});

router.get("/", async (req, res) => {
  const filters = parseAuditFilters(req.query as Record<string, unknown>);
  const events = await listEnrichedAuditEvents(filters);
  res.json({
    events,
    filters: {
      days: filters.days,
      limit: filters.limit,
      category: filters.category || null,
      severity: filters.severity || null,
      highRisk: Boolean(filters.highRiskOnly),
    },
    nextBeforeId: events.length ? events[events.length - 1].id : null,
  });
});

export default router;

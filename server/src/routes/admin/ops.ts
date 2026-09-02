import { Router } from "express";
import { pool } from "../../db.js";
import { getIsPlatformAdmin, getRequestContext } from "../../lib/request-context.js";
import { listOpsErrors } from "../../lib/ops-errors.js";

const router = Router();

async function probe(url: string, timeoutMs = 2500): Promise<{ ok: boolean; status?: number; ms: number }> {
  const started = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return { ok: res.ok, status: res.status, ms: Date.now() - started };
  } catch {
    return { ok: false, ms: Date.now() - started };
  } finally {
    clearTimeout(t);
  }
}

router.get("/overview", async (_req, res) => {
  const apiPort = Number(process.env.PORT ?? 4002);
  const webOrigin =
    process.env.WEB_PUBLIC_ORIGIN?.replace(/\/$/, "") ||
    process.env.CORS_ORIGIN?.replace(/\/$/, "") ||
    "http://127.0.0.1:3002";
  const webBase = process.env.WEB_BASE_PATH || process.env.NEXT_PUBLIC_BASE_PATH || "/jbt";
  const grafanaBase = (process.env.GRAFANA_PUBLIC_URL || "").replace(/\/$/, "");
  const errorsUi = (process.env.ERRORS_UI_URL || "").replace(/\/$/, "");

  const [apiProbe, webProbe, dbCheck] = await Promise.all([
    probe(`http://127.0.0.1:${apiPort}/api/health`),
    probe(`${webOrigin}${webBase}`),
    pool
      .query("SELECT 1 AS ok")
      .then(() => ({ ok: true as const }))
      .catch(() => ({ ok: false as const })),
  ]);

  let deliveryFailed7d = 0;
  let deliveryPending7d = 0;
  try {
    const { orgEqualsSql, orgScopeParams } = await import("../../lib/platform-admin.js");
    const [rows] = await pool.query(
      `SELECT
         SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN sync_status IN ('pending', 'in_progress') THEN 1 ELSE 0 END) AS pending
       FROM artifact_deliveries
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         AND ${orgEqualsSql("organization_id")}`,
      orgScopeParams(),
    );
    const row = (Array.isArray(rows) ? rows[0] : null) as { failed?: number; pending?: number } | null;
    deliveryFailed7d = Number(row?.failed) || 0;
    deliveryPending7d = Number(row?.pending) || 0;
  } catch {
    /* optional */
  }

  let auditHighRisk7d = 0;
  try {
    const { getAuditOverview } = await import("../../lib/audit-query.js");
    const audit = await getAuditOverview(7);
    auditHighRisk7d = Number(audit.totals?.highRisk) || 0;
  } catch {
    /* optional */
  }

  const recentErrors = listOpsErrors(40);
  const ctx = getRequestContext();

  const apiPublic =
    (process.env.API_PUBLIC_URL || "").replace(/\/$/, "") ||
    `${webOrigin}${webBase}`;

  const exploreBase = grafanaBase ? `${grafanaBase}/explore` : null;

  res.json({
    generatedAt: new Date().toISOString(),
    viewer: {
      userId: ctx?.userId ?? null,
      isPlatformAdmin: getIsPlatformAdmin(),
      role: ctx?.role ?? null,
    },
    runtime: {
      api: {
        ok: apiProbe.ok && dbCheck.ok,
        db: dbCheck.ok ? "ok" : "error",
        latencyMs: apiProbe.ms,
        uptimeSec: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        role: process.env.JBT_PROCESS_ROLE ?? "all",
        nodeEnv: process.env.NODE_ENV ?? "development",
      },
      web: {
        ok: webProbe.ok,
        status: webProbe.status ?? null,
        latencyMs: webProbe.ms,
      },
    },
    signals: {
      deliveryFailed7d,
      deliveryPending7d,
      auditHighRisk7d,
      recentErrorCount: recentErrors.length,
    },
    recentErrors,
    links: {
      grafana: grafanaBase || null,
      grafanaExploreApi: exploreBase
        ? `${exploreBase}?orgId=1&left=${encodeURIComponent(
            JSON.stringify({
              datasource: "Loki",
              queries: [{ refId: "A", expr: '{service="justx-jbt-api"}' }],
              range: { from: "now-1h", to: "now" },
            }),
          )}`
        : null,
      errorsUi: errorsUi || null,
      healthPublic: `${apiPublic}/api/health`,
      runbook:
        "https://github.com/JustXSystems/JustxBusinessTools/blob/master/docs/PRODUCTION_SUPPORT.md",
      observabilityDoc:
        "https://github.com/JustXSystems/JustxBusinessTools/blob/master/docs/OBSERVABILITY.md",
    },
    config: {
      logFormat: process.env.LOG_FORMAT || (process.env.NODE_ENV === "production" ? "json" : "text"),
      sentryConfigured: Boolean(process.env.SENTRY_DSN?.trim()),
      webhookConfigured: Boolean(process.env.ERROR_WEBHOOK_URL?.trim()),
      grafanaConfigured: Boolean(grafanaBase),
    },
  });
});

export default router;

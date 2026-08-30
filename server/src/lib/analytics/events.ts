import { pool } from "../../db.js";
import { getActiveOrgId, getActiveProfileId, getActiveUserId } from "../request-context.js";
import { isPlatformAdmin } from "../platform-admin.js";

export type UsageEventInput = {
  eventType: string;
  toolId?: string | null;
  sessionId?: string | null;
  properties?: Record<string, unknown>;
  device?: string | null;
  appVersion?: string | null;
  occurredAt?: string;
};

const ROLLUP_MAP: Record<string, keyof RollupCounters> = {
  "tool.open": "opens",
  "record.create": "creates",
  "record.update": "updates",
  "record.delete": "deletes",
  "record.export": "exports",
  "doc.print": "prints",
  "calc.run": "calc_runs",
  "limit.blocked": "limit_blocks",
  "upgrade.modal": "upgrade_clicks",
};

type RollupCounters = {
  opens: number;
  creates: number;
  updates: number;
  deletes: number;
  exports: number;
  prints: number;
  calc_runs: number;
  limit_blocks: number;
  upgrade_clicks: number;
};

function orgPred(alias = ""): string {
  const col = alias ? `${alias}organization_id` : "organization_id";
  return isPlatformAdmin() ? "1=1" : `${col} = :orgId`;
}

function emptyCounters(): RollupCounters {
  return {
    opens: 0,
    creates: 0,
    updates: 0,
    deletes: 0,
    exports: 0,
    prints: 0,
    calc_runs: 0,
    limit_blocks: 0,
    upgrade_clicks: 0,
  };
}

/** `null` means lifetime (no start date). */
export function parseAnalyticsRange(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return 30;
  const s = String(raw).trim().toLowerCase();
  if (s === "all" || s === "lifetime" || s === "0") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 1) return 30;
  return Math.min(Math.floor(n), 7300);
}

function seriesGrain(days: number | null): "day" | "week" | "month" {
  if (days == null || days > 180) return "month";
  if (days > 90) return "week";
  return "day";
}

function rollupDateSql(grain: "day" | "week" | "month"): string {
  if (grain === "month") return `DATE_FORMAT(date, '%Y-%m-01')`;
  if (grain === "week") return `DATE_SUB(date, INTERVAL WEEKDAY(date) DAY)`;
  return `date`;
}

export async function ingestUsageEvents(events: UsageEventInput[]): Promise<number> {
  if (!events.length) return 0;

  const orgId = getActiveOrgId();
  const profileId = getActiveProfileId();
  const userId = getActiveUserId();

  let inserted = 0;
  for (const ev of events.slice(0, 100)) {
    await pool.query(
      `INSERT INTO usage_events
       (organization_id, business_profile_id, user_id, session_id, event_type, tool_id, properties, device, app_version, occurred_at)
       VALUES (:orgId, :profileId, :userId, :sessionId, :eventType, :toolId, :properties, :device, :appVersion, :occurredAt)`,
      {
        orgId,
        profileId,
        userId,
        sessionId: ev.sessionId ?? null,
        eventType: ev.eventType,
        toolId: ev.toolId ?? null,
        properties: ev.properties ? JSON.stringify(ev.properties) : null,
        device: ev.device ?? null,
        appVersion: ev.appVersion ?? null,
        occurredAt: ev.occurredAt ?? new Date(),
      },
    );
    inserted += 1;
  }

  const today = new Date().toISOString().slice(0, 10);
  await rollupUsageForDate(today, profileId);

  return inserted;
}

export async function rollupUsageForDate(date: string, businessProfileId?: number): Promise<void> {
  const profileId = businessProfileId ?? getActiveProfileId();
  const orgId = getActiveOrgId();

  const [rows] = await pool.query(
    `SELECT event_type, tool_id, COUNT(*) AS cnt, COUNT(DISTINCT user_id) AS users
     FROM usage_events
     WHERE business_profile_id = :profileId AND DATE(occurred_at) = :date
     GROUP BY event_type, tool_id`,
    { profileId, date },
  );

  const byTool = new Map<string, RollupCounters & { unique_users: number }>();

  for (const row of Array.isArray(rows) ? rows : []) {
    const r = row as { event_type: string; tool_id: string | null; cnt: number; users: number };
    const toolId = r.tool_id ?? "_app";
    if (!byTool.has(toolId)) {
      byTool.set(toolId, { ...emptyCounters(), unique_users: 0 });
    }
    const bucket = byTool.get(toolId)!;
    const field = ROLLUP_MAP[r.event_type];
    if (field) {
      bucket[field] += Number(r.cnt);
    }
    bucket.unique_users = Math.max(bucket.unique_users, Number(r.users));
  }

  for (const [toolId, c] of byTool) {
    await pool.query(
      `INSERT INTO usage_daily_rollups
       (date, organization_id, business_profile_id, tool_id, opens, creates, updates, deletes, exports, prints, calc_runs, limit_blocks, upgrade_clicks, unique_users)
       VALUES (:date, :orgId, :profileId, :toolId, :opens, :creates, :updates, :deletes, :exports, :prints, :calcRuns, :limitBlocks, :upgradeClicks, :uniqueUsers)
       ON DUPLICATE KEY UPDATE
         opens = :opens, creates = :creates, updates = :updates, deletes = :deletes,
         exports = :exports, prints = :prints, calc_runs = :calcRuns,
         limit_blocks = :limitBlocks, upgrade_clicks = :upgradeClicks, unique_users = :uniqueUsers`,
      {
        date,
        orgId,
        profileId,
        toolId,
        opens: c.opens,
        creates: c.creates,
        updates: c.updates,
        deletes: c.deletes,
        exports: c.exports,
        prints: c.prints,
        calcRuns: c.calc_runs,
        limitBlocks: c.limit_blocks,
        upgradeClicks: c.upgrade_clicks,
        uniqueUsers: c.unique_users,
      },
    );
  }
}

export async function getAnalyticsOverview(days: unknown = 30): Promise<{
  days: number;
  grain: "day" | "week" | "month";
  totals: RollupCounters & { unique_users: number };
  previousTotals: RollupCounters & { unique_users: number };
  uniqueUsers: number;
  previousUniqueUsers: number;
  byTool: Array<{
    toolId: string;
    opens: number;
    creates: number;
    updates: number;
    deletes: number;
    exports: number;
    prints: number;
    calcRuns: number;
    limitBlocks: number;
    uniqueUsers: number;
  }>;
  dailyCreates: Array<{ date: string; creates: number }>;
  daily: Array<{ date: string; opens: number; creates: number; exports: number; uniqueUsers: number }>;
}> {
  const orgId = getActiveOrgId();
  const range = parseAnalyticsRange(days);
  const grain = seriesGrain(range);
  const dateFilter =
    range == null
      ? orgPred()
      : `${orgPred()} AND date >= DATE_SUB(CURDATE(), INTERVAL :days DAY)`;
  const eventFilter =
    range == null
      ? orgPred()
      : `${orgPred()} AND occurred_at >= DATE_SUB(NOW(), INTERVAL :days DAY)`;
  const params = range == null ? { orgId } : { orgId, days: range };

  const [rollupRows] = await pool.query(
    `SELECT tool_id,
            SUM(opens) AS opens, SUM(creates) AS creates, SUM(updates) AS updates,
            SUM(deletes) AS deletes, SUM(exports) AS exports, SUM(prints) AS prints,
            SUM(calc_runs) AS calc_runs, SUM(limit_blocks) AS limit_blocks,
            SUM(upgrade_clicks) AS upgrade_clicks, SUM(unique_users) AS unique_users
     FROM usage_daily_rollups
     WHERE ${dateFilter}
     GROUP BY tool_id`,
    params,
  );

  const totals = { ...emptyCounters(), unique_users: 0 };
  const byTool: Array<{
    toolId: string;
    opens: number;
    creates: number;
    updates: number;
    deletes: number;
    exports: number;
    prints: number;
    calcRuns: number;
    limitBlocks: number;
    uniqueUsers: number;
  }> = [];

  for (const row of Array.isArray(rollupRows) ? rollupRows : []) {
    const r = row as Record<string, string | number>;
    byTool.push({
      toolId: String(r.tool_id),
      opens: Number(r.opens) || 0,
      creates: Number(r.creates) || 0,
      updates: Number(r.updates) || 0,
      deletes: Number(r.deletes) || 0,
      exports: Number(r.exports) || 0,
      prints: Number(r.prints) || 0,
      calcRuns: Number(r.calc_runs) || 0,
      limitBlocks: Number(r.limit_blocks) || 0,
      uniqueUsers: Number(r.unique_users) || 0,
    });
    totals.opens += Number(r.opens) || 0;
    totals.creates += Number(r.creates) || 0;
    totals.updates += Number(r.updates) || 0;
    totals.deletes += Number(r.deletes) || 0;
    totals.exports += Number(r.exports) || 0;
    totals.prints += Number(r.prints) || 0;
    totals.calc_runs += Number(r.calc_runs) || 0;
    totals.limit_blocks += Number(r.limit_blocks) || 0;
    totals.upgrade_clicks += Number(r.upgrade_clicks) || 0;
    totals.unique_users += Number(r.unique_users) || 0;
  }

  byTool.sort((a, b) => b.opens + b.creates - (a.opens + a.creates));

  const previousTotals = {
    opens: 0,
    creates: 0,
    updates: 0,
    deletes: 0,
    exports: 0,
    prints: 0,
    calc_runs: 0,
    limit_blocks: 0,
    upgrade_clicks: 0,
    unique_users: 0,
  };
  let previousUniqueUsers = 0;
  if (range != null) {
    const [prevRows] = await pool.query(
      `SELECT
              SUM(opens) AS opens, SUM(creates) AS creates, SUM(updates) AS updates,
              SUM(deletes) AS deletes, SUM(exports) AS exports, SUM(prints) AS prints,
              SUM(calc_runs) AS calc_runs, SUM(limit_blocks) AS limit_blocks,
              SUM(upgrade_clicks) AS upgrade_clicks, SUM(unique_users) AS unique_users
       FROM usage_daily_rollups
       WHERE ${orgPred()}
         AND date >= DATE_SUB(CURDATE(), INTERVAL :span DAY)
         AND date < DATE_SUB(CURDATE(), INTERVAL :days DAY)`,
      { orgId, days: range, span: range * 2 },
    );
    const prev = (Array.isArray(prevRows) ? prevRows[0] : null) as Record<string, string | number> | null;
    previousTotals.opens = Number(prev?.opens) || 0;
    previousTotals.creates = Number(prev?.creates) || 0;
    previousTotals.updates = Number(prev?.updates) || 0;
    previousTotals.deletes = Number(prev?.deletes) || 0;
    previousTotals.exports = Number(prev?.exports) || 0;
    previousTotals.prints = Number(prev?.prints) || 0;
    previousTotals.calc_runs = Number(prev?.calc_runs) || 0;
    previousTotals.limit_blocks = Number(prev?.limit_blocks) || 0;
    previousTotals.upgrade_clicks = Number(prev?.upgrade_clicks) || 0;
    previousTotals.unique_users = Number(prev?.unique_users) || 0;
    const [uniqPrev] = await pool.query(
      `SELECT COUNT(DISTINCT user_id) AS cnt FROM usage_events
       WHERE ${orgPred()}
         AND occurred_at >= DATE_SUB(NOW(), INTERVAL :span DAY)
         AND occurred_at < DATE_SUB(NOW(), INTERVAL :days DAY)`,
      { orgId, days: range, span: range * 2 },
    );
    previousUniqueUsers =
      Number((Array.isArray(uniqPrev) ? (uniqPrev[0] as { cnt: number }) : { cnt: 0 }).cnt) || 0;
  }

  const bucket = rollupDateSql(grain);
  const [dailyRows] = await pool.query(
    `SELECT ${bucket} AS bucket, SUM(opens) AS opens, SUM(creates) AS creates, SUM(exports) AS exports, SUM(unique_users) AS unique_users
     FROM usage_daily_rollups
     WHERE ${dateFilter}
     GROUP BY ${bucket} ORDER BY ${bucket}`,
    params,
  );

  let daily: Array<{ date: string; opens: number; creates: number; exports: number; uniqueUsers: number }> = (
    Array.isArray(dailyRows) ? dailyRows : []
  ).map((row) => {
    const r = row as { bucket: string; opens: number; creates: number; exports: number; unique_users: number };
    return {
      date: String(r.bucket).slice(0, 10),
      opens: Number(r.opens) || 0,
      creates: Number(r.creates) || 0,
      exports: Number(r.exports) || 0,
      uniqueUsers: Number(r.unique_users) || 0,
    };
  });

  if (grain === "day" && range != null && range <= 90) {
    const dailyMap = new Map(daily.map((d) => [d.date, d]));
    daily = [];
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      daily.push(dailyMap.get(key) ?? { date: key, opens: 0, creates: 0, exports: 0, uniqueUsers: 0 });
    }
  }

  const [uniqNow] = await pool.query(
    `SELECT COUNT(DISTINCT user_id) AS cnt FROM usage_events WHERE ${eventFilter}`,
    params,
  );
  const uniqueUsers = Number((Array.isArray(uniqNow) ? (uniqNow[0] as { cnt: number }) : { cnt: 0 }).cnt) || 0;

  return {
    days: range ?? 0,
    grain,
    totals: { ...totals, unique_users: uniqueUsers },
    previousTotals,
    uniqueUsers,
    previousUniqueUsers,
    byTool,
    dailyCreates: daily.map((d) => ({ date: d.date, creates: d.creates })),
    daily,
  };
}

export async function getAnalyticsBreakdown(days: unknown = 30): Promise<{
  devices: Array<{ device: string; count: number }>;
  hours: Array<{ hour: number; count: number }>;
  eventTypes: Array<{ eventType: string; count: number }>;
  users: Array<{ userId: number | null; label: string; count: number; tools: number }>;
  recent: Array<{
    at: string;
    eventType: string;
    toolId: string | null;
    device: string | null;
    actor: string | null;
  }>;
}> {
  const orgId = getActiveOrgId();
  const range = parseAnalyticsRange(days);
  const since =
    range == null
      ? orgPred()
      : `occurred_at >= DATE_SUB(NOW(), INTERVAL :days DAY) AND ${orgPred()}`;
  const params = range == null ? { orgId } : { orgId, days: range };
  const eventSince =
    range == null
      ? orgPred("e.")
      : `e.occurred_at >= DATE_SUB(NOW(), INTERVAL :days DAY) AND ${orgPred("e.")}`;

  const [deviceRows] = await pool.query(
    `SELECT COALESCE(NULLIF(device, ''), 'unknown') AS device, COUNT(*) AS cnt
     FROM usage_events WHERE ${since}
     GROUP BY COALESCE(NULLIF(device, ''), 'unknown')
     ORDER BY cnt DESC`,
    params,
  );
  const [hourRows] = await pool.query(
    `SELECT HOUR(occurred_at) AS hour, COUNT(*) AS cnt
     FROM usage_events WHERE ${since}
     GROUP BY HOUR(occurred_at)`,
    params,
  );
  const [typeRows] = await pool.query(
    `SELECT event_type, COUNT(*) AS cnt
     FROM usage_events WHERE ${since}
     GROUP BY event_type
     ORDER BY cnt DESC`,
    params,
  );
  const [userRows] = await pool.query(
    `SELECT e.user_id, COALESCE(NULLIF(u.name, ''), u.email, CONCAT('#', e.user_id)) AS label,
            COUNT(*) AS cnt, COUNT(DISTINCT e.tool_id) AS tools
     FROM usage_events e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE ${eventSince}
     GROUP BY e.user_id, u.name, u.email
     ORDER BY cnt DESC
     LIMIT 8`,
    params,
  );
  const [recentRows] = await pool.query(
    `SELECT e.occurred_at, e.event_type, e.tool_id, e.device, COALESCE(NULLIF(u.name, ''), u.email) AS actor
     FROM usage_events e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE ${eventSince}
     ORDER BY e.occurred_at DESC
     LIMIT 20`,
    params,
  );

  const hourMap = new Map<number, number>();
  for (const row of Array.isArray(hourRows) ? hourRows : []) {
    const r = row as { hour: number; cnt: number };
    hourMap.set(Number(r.hour), Number(r.cnt) || 0);
  }

  return {
    devices: (Array.isArray(deviceRows) ? deviceRows : []).map((row) => {
      const r = row as { device: string; cnt: number };
      return { device: String(r.device), count: Number(r.cnt) || 0 };
    }),
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hourMap.get(hour) ?? 0 })),
    eventTypes: (Array.isArray(typeRows) ? typeRows : []).map((row) => {
      const r = row as { event_type: string; cnt: number };
      return { eventType: String(r.event_type), count: Number(r.cnt) || 0 };
    }),
    users: (Array.isArray(userRows) ? userRows : []).map((row) => {
      const r = row as { user_id: number | null; label: string; cnt: number; tools: number };
      return {
        userId: r.user_id == null ? null : Number(r.user_id),
        label: String(r.label ?? "Unknown"),
        count: Number(r.cnt) || 0,
        tools: Number(r.tools) || 0,
      };
    }),
    recent: (Array.isArray(recentRows) ? recentRows : []).map((row) => {
      const r = row as {
        occurred_at: string;
        event_type: string;
        tool_id: string | null;
        device: string | null;
        actor: string | null;
      };
      return {
        at: String(r.occurred_at),
        eventType: String(r.event_type),
        toolId: r.tool_id ? String(r.tool_id) : null,
        device: r.device ? String(r.device) : null,
        actor: r.actor ? String(r.actor) : null,
      };
    }),
  };
}

export async function getToolAnalytics(toolId: string, days: unknown = 30) {
  const orgId = getActiveOrgId();
  const range = parseAnalyticsRange(days);
  const grain = seriesGrain(range);
  const bucket = rollupDateSql(grain);
  const dateFilter =
    range == null
      ? `${orgPred()} AND tool_id = :toolId`
      : `${orgPred()} AND tool_id = :toolId AND date >= DATE_SUB(CURDATE(), INTERVAL :days DAY)`;
  const params = range == null ? { orgId, toolId } : { orgId, toolId, days: range };

  const [rows] = await pool.query(
    `SELECT ${bucket} AS bucket, SUM(opens) AS opens, SUM(creates) AS creates, SUM(updates) AS updates,
            SUM(deletes) AS deletes, SUM(exports) AS exports, SUM(prints) AS prints,
            SUM(calc_runs) AS calc_runs, SUM(limit_blocks) AS limit_blocks,
            SUM(upgrade_clicks) AS upgrade_clicks, SUM(unique_users) AS unique_users
     FROM usage_daily_rollups
     WHERE ${dateFilter}
     GROUP BY ${bucket}
     ORDER BY ${bucket}`,
    params,
  );

  const series = (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, string | number>;
    return {
      date: String(r.bucket).slice(0, 10),
      opens: Number(r.opens) || 0,
      creates: Number(r.creates) || 0,
      updates: Number(r.updates) || 0,
      deletes: Number(r.deletes) || 0,
      exports: Number(r.exports) || 0,
      prints: Number(r.prints) || 0,
      calcRuns: Number(r.calc_runs) || 0,
      limitBlocks: Number(r.limit_blocks) || 0,
      upgradeClicks: Number(r.upgrade_clicks) || 0,
      uniqueUsers: Number(r.unique_users) || 0,
    };
  });
  return { grain, days: range ?? 0, series };
}

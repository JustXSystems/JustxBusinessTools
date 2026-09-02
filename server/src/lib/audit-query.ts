import {
  AUDIT_CATEGORIES,
  categorizeAuditAction,
  describeAuditEvent,
  entityAdminHref,
  HIGH_RISK_ACTIONS,
  isHighRiskAction,
  labelForAuditAction,
  severityForAuditAction,
  type AuditCategory,
  type AuditSeverity,
} from "./audit-catalog.js";
import { pool } from "../db.js";
import { isPlatformAdmin, orgEqualsSql, orgScopeParams } from "./platform-admin.js";
export type AuditEventDto = {
  id: number;
  action: string;
  label: string;
  summary: string;
  category: AuditCategory;
  severity: AuditSeverity;
  entityType: string | null;
  entityId: string | null;
  entityHref: string | null;
  userId: number | null;
  actorName: string | null;
  actorEmail: string | null;
  organizationId: number | null;
  organizationName: string | null;
  businessProfileId: number | null;
  profileName: string | null;
  diff: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  highRisk: boolean;
};

export type AuditFilters = {
  days: number;
  limit: number;
  beforeId?: number;
  category?: AuditCategory | "";
  severity?: AuditSeverity | "";
  userId?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  q?: string;
  highRiskOnly?: boolean;
  ip?: string;
};

function parseDiff(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const s = String(value ?? "");
  if (!s) return new Date(0).toISOString();
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + (s.includes("Z") ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

function mapRow(row: Record<string, unknown>): AuditEventDto {
  const action = String(row.action ?? "");
  const entityType = (row.entity_type as string | null) ?? null;
  const entityId = (row.entity_id as string | null) ?? null;
  const actorName = (row.actor_name as string | null) ?? null;
  const actorEmail = (row.actor_email as string | null) ?? null;
  const diff = parseDiff(row.diff);
  const category = categorizeAuditAction(action);
  const severity = severityForAuditAction(action);
  return {
    id: Number(row.id),
    action,
    label: labelForAuditAction(action),
    summary: describeAuditEvent({
      action,
      actorName,
      actorEmail,
      entityType,
      entityId,
      diff,
    }),
    category,
    severity,
    entityType,
    entityId,
    entityHref: entityAdminHref(entityType, entityId),
    userId: row.user_id != null ? Number(row.user_id) : null,
    actorName,
    actorEmail,
    organizationId: row.organization_id != null ? Number(row.organization_id) : null,
    organizationName: (row.organization_name as string | null) ?? null,
    businessProfileId: row.business_profile_id != null ? Number(row.business_profile_id) : null,
    profileName: (row.profile_name as string | null) ?? null,
    diff,
    ip: (row.ip as string | null) ?? null,
    createdAt: toIso(row.created_at),
    highRisk: isHighRiskAction(action),
  };
}

function clampDays(raw: unknown, fallback = 7): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(90, Math.max(1, Math.floor(n)));
}

function clampLimit(raw: unknown, fallback = 100, max = 500): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

export function parseAuditFilters(query: Record<string, unknown>): AuditFilters {
  const category = String(query.category ?? "") as AuditCategory | "";
  const severity = String(query.severity ?? "") as AuditSeverity | "";
  return {
    days: clampDays(query.days, 7),
    limit: clampLimit(query.limit, 100, 500),
    beforeId: query.beforeId ? Number(query.beforeId) : undefined,
    category: AUDIT_CATEGORIES.some((c) => c.id === category) ? category : "",
    severity: ["critical", "high", "medium", "low"].includes(severity) ? severity : "",
    userId: query.userId ? Number(query.userId) : undefined,
    action: query.action ? String(query.action) : undefined,
    entityType: query.entityType ? String(query.entityType) : undefined,
    entityId: query.entityId ? String(query.entityId) : undefined,
    q: query.q ? String(query.q).trim() : undefined,
    highRiskOnly: query.highRisk === "1" || query.highRisk === "true",
    ip: query.ip ? String(query.ip).trim() : undefined,
  };
}

type WhereBuilt = { sql: string; params: Record<string, unknown> };

function buildWhere(filters: AuditFilters, alias = "a"): WhereBuilt {
  const params: Record<string, unknown> = {
    ...orgScopeParams(),
    days: filters.days,
  };
  const parts: string[] = [
    orgEqualsSql(`${alias}.organization_id`),
    `${alias}.created_at >= (UTC_TIMESTAMP() - INTERVAL :days DAY)`,
  ];

  if (filters.beforeId && Number.isFinite(filters.beforeId)) {
    parts.push(`${alias}.id < :beforeId`);
    params.beforeId = filters.beforeId;
  }
  if (filters.userId && Number.isFinite(filters.userId)) {
    parts.push(`${alias}.user_id = :userId`);
    params.userId = filters.userId;
  }
  if (filters.action) {
    parts.push(`${alias}.action = :action`);
    params.action = filters.action;
  }
  if (filters.entityType) {
    parts.push(`${alias}.entity_type = :entityType`);
    params.entityType = filters.entityType;
  }
  if (filters.entityId) {
    parts.push(`${alias}.entity_id = :entityId`);
    params.entityId = filters.entityId;
  }
  if (filters.ip) {
    parts.push(`${alias}.ip = :ip`);
    params.ip = filters.ip;
  }
  if (filters.highRiskOnly && HIGH_RISK_ACTIONS.length) {
    parts.push(`${alias}.action IN (${HIGH_RISK_ACTIONS.map((_, i) => `:hr${i}`).join(",")})`);
    HIGH_RISK_ACTIONS.forEach((a, i) => {
      params[`hr${i}`] = a;
    });
  }
  if (filters.category) {
    const catSql = categorySql(alias, filters.category, params);
    if (catSql) parts.push(catSql);
  }
  if (filters.severity) {
    const sevActions = HIGH_RISK_ACTIONS; // refined below via JS for medium/low; SQL for high/critical
    if (filters.severity === "critical" || filters.severity === "high") {
      const list = sevActions.filter((a) => severityForAuditAction(a) === filters.severity);
      if (list.length) {
        parts.push(`${alias}.action IN (${list.map((_, i) => `:sv${i}`).join(",")})`);
        list.forEach((a, i) => {
          params[`sv${i}`] = a;
        });
      }
    }
  }
  if (filters.q) {
    parts.push(
      `(${alias}.action LIKE :q OR ${alias}.entity_type LIKE :q OR ${alias}.entity_id LIKE :q OR ${alias}.ip LIKE :q OR CAST(${alias}.diff AS CHAR) LIKE :q OR u.email LIKE :q OR u.name LIKE :q)`,
    );
    params.q = `%${filters.q}%`;
  }

  return { sql: parts.join(" AND "), params };
}

function categorySql(alias: string, category: AuditCategory, params: Record<string, unknown>): string {
  const like = (key: string, pattern: string) => {
    params[key] = pattern;
    return `${alias}.action LIKE :${key}`;
  };
  switch (category) {
    case "auth":
      return `(${like("cAuth", "auth.%")})`;
    case "team":
      return `(${like("cTeam", "team.%")})`;
    case "billing":
      return `(${[
        like("cBill1", "upi.%"),
        like("cBill2", "payment%"),
        like("cBill3", "gateway.%"),
        like("cBill4", "plan.%"),
        like("cBill5", "subscription.%"),
        like("cBill6", "sku.%"),
        like("cBill7", "bundle.%"),
      ].join(" OR ")})`;
    case "catalog":
      return `(${alias}.action IN ('tool.create','tool.update','tool.disable'))`;
    case "profile":
      return `(${like("cProf", "profile.%")})`;
    case "documents":
      return `(${[
        like("cDoc1", "document.%"),
        like("cDoc2", "quotation%"),
        like("cDoc3", "sitesurvey%"),
        like("cDoc4", "tool.record%"),
      ].join(" OR ")})`;
    case "artifacts":
      return `(${like("cArt", "artifact.%")})`;
    case "system":
      return `(${alias}.action NOT LIKE 'auth.%'
        AND ${alias}.action NOT LIKE 'team.%'
        AND ${alias}.action NOT LIKE 'upi.%'
        AND ${alias}.action NOT LIKE 'payment%'
        AND ${alias}.action NOT LIKE 'gateway.%'
        AND ${alias}.action NOT LIKE 'plan.%'
        AND ${alias}.action NOT LIKE 'subscription.%'
        AND ${alias}.action NOT LIKE 'sku.%'
        AND ${alias}.action NOT LIKE 'bundle.%'
        AND ${alias}.action NOT LIKE 'profile.%'
        AND ${alias}.action NOT LIKE 'document.%'
        AND ${alias}.action NOT LIKE 'quotation%'
        AND ${alias}.action NOT LIKE 'sitesurvey%'
        AND ${alias}.action NOT LIKE 'tool.record%'
        AND ${alias}.action NOT LIKE 'artifact.%'
        AND ${alias}.action NOT IN ('tool.create','tool.update','tool.disable'))`;
    default:
      return "";
  }
}

const SELECT_BASE = `
  SELECT a.id, a.organization_id, a.business_profile_id, a.user_id, a.action,
         a.entity_type, a.entity_id, a.diff, a.ip, a.created_at,
         u.name AS actor_name, u.email AS actor_email,
         o.name AS organization_name,
         bp.business_name AS profile_name
  FROM audit_events a
  LEFT JOIN users u ON u.id = a.user_id
  LEFT JOIN organizations o ON o.id = a.organization_id
  LEFT JOIN business_profiles bp ON bp.id = a.business_profile_id
`;

export async function listEnrichedAuditEvents(filters: AuditFilters): Promise<AuditEventDto[]> {
  const { sql, params } = buildWhere(filters);
  const [rows] = await pool.query(
    `${SELECT_BASE}
     WHERE ${sql}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT :limit`,
    { ...params, limit: filters.limit },
  );

  let events = (Array.isArray(rows) ? rows : []).map((row) => mapRow(row as Record<string, unknown>));

  // medium/low severity is derived — refine after fetch when not SQL-filtered
  if (filters.severity === "medium" || filters.severity === "low") {
    events = events.filter((e) => e.severity === filters.severity);
  }

  return events;
}

export async function exportAuditCsv(filters: AuditFilters): Promise<string> {
  const events = await listEnrichedAuditEvents({ ...filters, limit: clampLimit(filters.limit, 2000, 5000) });
  const header = [
    "id",
    "created_at",
    "action",
    "label",
    "category",
    "severity",
    "actor_name",
    "actor_email",
    "user_id",
    "entity_type",
    "entity_id",
    "profile",
    "organization",
    "ip",
    "summary",
    "diff_json",
  ];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    header.join(","),
    ...events.map((e) =>
      [
        e.id,
        e.createdAt,
        e.action,
        e.label,
        e.category,
        e.severity,
        e.actorName,
        e.actorEmail,
        e.userId,
        e.entityType,
        e.entityId,
        e.profileName,
        e.organizationName,
        e.ip,
        e.summary,
        e.diff ? JSON.stringify(e.diff) : "",
      ]
        .map(escape)
        .join(","),
    ),
  ];
  return lines.join("\n");
}

export type AuditAnomaly = {
  id: string;
  severity: AuditSeverity;
  title: string;
  body: string;
  count?: number;
  filter?: Partial<{
    category: AuditCategory;
    highRisk: boolean;
    userId: number;
    action: string;
    ip: string;
    entityType: string;
    entityId: string;
  }>;
};

export type AuditOverview = {
  days: number;
  totals: {
    events: number;
    actors: number;
    highRisk: number;
    auth: number;
    team: number;
    billing: number;
    catalog: number;
    profile: number;
    documents: number;
    artifacts: number;
    system: number;
  };
  previous: { events: number; highRisk: number; actors: number };
  byCategory: Array<{ category: AuditCategory; label: string; count: number }>;
  daily: Array<{
    date: string;
    total: number;
    auth: number;
    team: number;
    billing: number;
    other: number;
    highRisk: number;
  }>;
  hours: Array<{ hour: number; count: number }>;
  topActions: Array<{ action: string; label: string; category: AuditCategory; count: number }>;
  topActors: Array<{
    userId: number | null;
    name: string;
    email: string | null;
    count: number;
    highRisk: number;
  }>;
  anomalies: AuditAnomaly[];
  platformWide: boolean;
};

export async function getAuditOverview(daysRaw: unknown): Promise<AuditOverview> {
  const days = clampDays(daysRaw, 7);
  const params = { ...orgScopeParams(), days, prevDays: days * 2 };
  const orgPred = orgEqualsSql("a.organization_id");

  const [rawRows] = await pool.query(
    `SELECT a.action, a.user_id, a.ip, a.created_at, a.entity_type, a.entity_id,
            u.name AS actor_name, u.email AS actor_email
     FROM audit_events a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE ${orgPred}
       AND a.created_at >= (UTC_TIMESTAMP() - INTERVAL :prevDays DAY)
     ORDER BY a.created_at DESC
     LIMIT 8000`,
    params,
  );

  type Raw = {
    action: string;
    user_id: number | null;
    ip: string | null;
    created_at: string | Date;
    entity_type: string | null;
    entity_id: string | null;
    actor_name: string | null;
    actor_email: string | null;
  };

  const all = (Array.isArray(rawRows) ? rawRows : []).map((r) => r as Raw);
  const now = Date.now();
  const windowMs = days * 24 * 60 * 60 * 1000;
  const cut = now - windowMs;
  const prevCut = now - windowMs * 2;

  const current = all.filter((r) => new Date(toIso(r.created_at)).getTime() >= cut);
  const previous = all.filter((r) => {
    const t = new Date(toIso(r.created_at)).getTime();
    return t >= prevCut && t < cut;
  });

  const emptyCat = () =>
    Object.fromEntries(AUDIT_CATEGORIES.map((c) => [c.id, 0])) as Record<AuditCategory, number>;

  const totalsCat = emptyCat();
  let highRisk = 0;
  const actorSet = new Set<number>();
  const prevActorSet = new Set<number>();
  let prevHigh = 0;

  const dailyMap = new Map<
    string,
    { total: number; auth: number; team: number; billing: number; other: number; highRisk: number }
  >();
  const hourMap = new Map<number, number>();
  const actionMap = new Map<string, number>();
  const actorMap = new Map<number, { name: string; email: string | null; count: number; highRisk: number }>();
  const ipUsers = new Map<string, Set<number>>();
  const mfaDisable: Raw[] = [];
  const securityTeam: Raw[] = [];

  for (let h = 0; h < 24; h++) hourMap.set(h, 0);

  // seed daily buckets
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    dailyMap.set(key, { total: 0, auth: 0, team: 0, billing: 0, other: 0, highRisk: 0 });
  }

  for (const r of previous) {
    if (r.user_id != null) prevActorSet.add(Number(r.user_id));
    if (isHighRiskAction(r.action)) prevHigh += 1;
  }

  for (const r of current) {
    const cat = categorizeAuditAction(r.action);
    totalsCat[cat] += 1;
    if (isHighRiskAction(r.action)) highRisk += 1;
    if (r.user_id != null) actorSet.add(Number(r.user_id));

    const iso = toIso(r.created_at);
    const day = iso.slice(0, 10);
    const hour = new Date(iso).getUTCHours();
    hourMap.set(hour, (hourMap.get(hour) ?? 0) + 1);

    const bucket = dailyMap.get(day) ?? {
      total: 0,
      auth: 0,
      team: 0,
      billing: 0,
      other: 0,
      highRisk: 0,
    };
    bucket.total += 1;
    if (cat === "auth") bucket.auth += 1;
    else if (cat === "team") bucket.team += 1;
    else if (cat === "billing") bucket.billing += 1;
    else bucket.other += 1;
    if (isHighRiskAction(r.action)) bucket.highRisk += 1;
    dailyMap.set(day, bucket);

    actionMap.set(r.action, (actionMap.get(r.action) ?? 0) + 1);

    if (r.user_id != null) {
      const id = Number(r.user_id);
      const cur = actorMap.get(id) ?? {
        name: r.actor_name || r.actor_email || `User #${id}`,
        email: r.actor_email,
        count: 0,
        highRisk: 0,
      };
      cur.count += 1;
      if (isHighRiskAction(r.action)) cur.highRisk += 1;
      actorMap.set(id, cur);
    }

    if (r.ip && r.user_id != null) {
      const set = ipUsers.get(r.ip) ?? new Set();
      set.add(Number(r.user_id));
      ipUsers.set(r.ip, set);
    }

    if (r.action === "auth.mfa_disable") mfaDisable.push(r);
    if (
      ["team.suspend", "team.reset_password", "team.revoke_sessions", "team.remove", "team.role_matrix"].includes(
        r.action,
      )
    ) {
      securityTeam.push(r);
    }
  }

  const anomalies: AuditAnomaly[] = [];

  if (mfaDisable.length) {
    anomalies.push({
      id: "mfa-disable",
      severity: "critical",
      title: "MFA disabled",
      body: `${mfaDisable.length} MFA disable event${mfaDisable.length === 1 ? "" : "s"} in the last ${days} days. Confirm each was intentional.`,
      count: mfaDisable.length,
      filter: { action: "auth.mfa_disable" },
    });
  }

  if (securityTeam.length) {
    anomalies.push({
      id: "team-security",
      severity: "high",
      title: "Sensitive team changes",
      body: `${securityTeam.length} high-impact access change${securityTeam.length === 1 ? "" : "s"} (suspend, password reset, session revoke, remove, or role matrix).`,
      count: securityTeam.length,
      filter: { category: "team", highRisk: true },
    });
  }

  if (highRisk >= 8) {
    anomalies.push({
      id: "high-risk-volume",
      severity: highRisk >= 20 ? "critical" : "high",
      title: "Elevated high-risk volume",
      body: `${highRisk} high-risk admin/security events in ${days} days (prior window: ${prevHigh}).`,
      count: highRisk,
      filter: { highRisk: true },
    });
  }

  for (const [ip, users] of ipUsers) {
    if (users.size >= 4) {
      anomalies.push({
        id: `ip-multi-${ip}`,
        severity: "high",
        title: "Shared IP across many accounts",
        body: `IP ${ip} appeared on ${users.size} different users — review for shared office NAT or credential sharing.`,
        count: users.size,
        filter: { ip },
      });
      if (anomalies.length > 8) break;
    }
  }

  const billingCount = totalsCat.billing;
  if (billingCount >= 5) {
    anomalies.push({
      id: "billing-activity",
      severity: "medium",
      title: "Billing / license activity",
      body: `${billingCount} billing-related events (plans, SKUs, UPI, gateways, licenses). Useful for finance reconciliation.`,
      count: billingCount,
      filter: { category: "billing" },
    });
  }

  const driveDisc = current.filter((r) => r.action === "profile.drive_disconnect");
  if (driveDisc.length) {
    anomalies.push({
      id: "drive-disconnect",
      severity: "high",
      title: "Google Drive disconnected",
      body: `${driveDisc.length} Drive disconnect${driveDisc.length === 1 ? "" : "s"} — PDF delivery may fail until owners reconnect.`,
      count: driveDisc.length,
      filter: { action: "profile.drive_disconnect" },
    });
  }

  return {
    days,
    totals: {
      events: current.length,
      actors: actorSet.size,
      highRisk,
      auth: totalsCat.auth,
      team: totalsCat.team,
      billing: totalsCat.billing,
      catalog: totalsCat.catalog,
      profile: totalsCat.profile,
      documents: totalsCat.documents,
      artifacts: totalsCat.artifacts,
      system: totalsCat.system,
    },
    previous: {
      events: previous.length,
      highRisk: prevHigh,
      actors: prevActorSet.size,
    },
    byCategory: AUDIT_CATEGORIES.map((c) => ({
      category: c.id,
      label: c.label,
      count: totalsCat[c.id],
    })),
    daily: [...dailyMap.entries()].map(([date, v]) => ({ date, ...v })),
    hours: [...hourMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, count]) => ({ hour, count })),
    topActions: [...actionMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([actionName, count]) => ({
        action: actionName,
        label: labelForAuditAction(actionName),
        category: categorizeAuditAction(actionName),
        count,
      })),
    topActors: [...actorMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([uid, v]) => ({
        userId: uid,
        name: v.name,
        email: v.email,
        count: v.count,
        highRisk: v.highRisk,
      })),
    anomalies: anomalies.slice(0, 10),
    platformWide: isPlatformAdmin(),
  };
}

export type AuditActorPivot = {
  userId: number | null;
  name: string;
  email: string | null;
  count: number;
  highRisk: number;
  lastAt: string | null;
  byCategory: Partial<Record<AuditCategory, number>>;
};

export async function listAuditActors(daysRaw: unknown): Promise<AuditActorPivot[]> {
  const days = clampDays(daysRaw, 7);
  const [rows] = await pool.query(
    `SELECT a.user_id, a.action, a.created_at, u.name AS actor_name, u.email AS actor_email
     FROM audit_events a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE ${orgEqualsSql("a.organization_id")}
       AND a.created_at >= (UTC_TIMESTAMP() - INTERVAL :days DAY)
     ORDER BY a.created_at DESC
     LIMIT 5000`,
    { ...orgScopeParams(), days },
  );

  const map = new Map<string, AuditActorPivot>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const r = row as Record<string, unknown>;
    const userId = r.user_id != null ? Number(r.user_id) : null;
    const key = userId != null ? String(userId) : "system";
    const cur =
      map.get(key) ??
      ({
        userId,
        name: (r.actor_name as string) || (r.actor_email as string) || (userId != null ? `User #${userId}` : "System"),
        email: (r.actor_email as string | null) ?? null,
        count: 0,
        highRisk: 0,
        lastAt: null,
        byCategory: {},
      } satisfies AuditActorPivot);
    const action = String(r.action);
    const cat = categorizeAuditAction(action);
    cur.count += 1;
    if (isHighRiskAction(action)) cur.highRisk += 1;
    cur.byCategory[cat] = (cur.byCategory[cat] ?? 0) + 1;
    const at = toIso(r.created_at);
    if (!cur.lastAt || at > cur.lastAt) cur.lastAt = at;
    map.set(key, cur);
  }

  return [...map.values()].sort((a, b) => b.count - a.count);
}

export type AuditEntityPivot = {
  entityType: string;
  entityId: string;
  count: number;
  lastAt: string | null;
  lastAction: string | null;
  href: string | null;
  highRisk: number;
};

export async function listAuditEntities(daysRaw: unknown, entityType?: string): Promise<AuditEntityPivot[]> {
  const days = clampDays(daysRaw, 7);
  const params: Record<string, unknown> = { ...orgScopeParams(), days };
  let typeFilter = "";
  if (entityType) {
    typeFilter = " AND a.entity_type = :entityType";
    params.entityType = entityType;
  }

  const [rows] = await pool.query(
    `SELECT a.entity_type, a.entity_id, a.action, a.created_at
     FROM audit_events a
     WHERE ${orgEqualsSql("a.organization_id")}
       AND a.created_at >= (UTC_TIMESTAMP() - INTERVAL :days DAY)
       AND a.entity_type IS NOT NULL
       AND a.entity_id IS NOT NULL
       ${typeFilter}
     ORDER BY a.created_at DESC
     LIMIT 5000`,
    params as { orgId: number; days: number; entityType?: string },
  );

  const map = new Map<string, AuditEntityPivot>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const r = row as Record<string, unknown>;
    const entityTypeVal = String(r.entity_type);
    const entityId = String(r.entity_id);
    const key = `${entityTypeVal}:${entityId}`;
    const action = String(r.action);
    const cur =
      map.get(key) ??
      ({
        entityType: entityTypeVal,
        entityId,
        count: 0,
        lastAt: null,
        lastAction: null,
        href: entityAdminHref(entityTypeVal, entityId),
        highRisk: 0,
      } satisfies AuditEntityPivot);
    cur.count += 1;
    if (isHighRiskAction(action)) cur.highRisk += 1;
    const at = toIso(r.created_at);
    if (!cur.lastAt || at > cur.lastAt) {
      cur.lastAt = at;
      cur.lastAction = labelForAuditAction(action);
    }
    map.set(key, cur);
  }

  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 100);
}

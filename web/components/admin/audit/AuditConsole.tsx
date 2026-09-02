"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { AUDIT_CATEGORIES, type AuditCategory, type AuditSeverity } from "@/lib/audit-catalog";
import { api } from "@/lib/api";
import { apiUrl } from "@/lib/api-base";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

type AuditEvent = {
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
  organizationName: string | null;
  profileName: string | null;
  diff: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  highRisk: boolean;
};

type Overview = {
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
  anomalies: Array<{
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
  }>;
  platformWide: boolean;
};

type ActorPivot = {
  userId: number | null;
  name: string;
  email: string | null;
  count: number;
  highRisk: number;
  lastAt: string | null;
  byCategory: Partial<Record<AuditCategory, number>>;
};

type EntityPivot = {
  entityType: string;
  entityId: string;
  count: number;
  lastAt: string | null;
  lastAction: string | null;
  href: string | null;
  highRisk: number;
};

type ViewTab = "timeline" | "people" | "entities" | "feed";

const RANGES = [
  { value: 1, label: "24h" },
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
] as const;

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function dayLabel(key: string) {
  const d = new Date(`${key}T12:00:00`);
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86400000).toISOString());
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function deltaPct(now: number, prev: number) {
  if (prev === 0) return now > 0 ? 100 : 0;
  return Math.round(((now - prev) / prev) * 100);
}

function initials(name: string | null | undefined, email?: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function buildQuery(params: Record<string, string | number | boolean | undefined | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    q.set(k, String(v));
  }
  return q.toString();
}

export function AuditConsole() {
  const [days, setDays] = useState(7);
  const [tab, setTab] = useState<ViewTab>("timeline");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [actors, setActors] = useState<ActorPivot[]>([]);
  const [entities, setEntities] = useState<EntityPivot[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const [category, setCategory] = useState<AuditCategory | "">("");
  const [severity, setSeverity] = useState<AuditSeverity | "">("");
  const [highRisk, setHighRisk] = useState(false);
  const [userId, setUserId] = useState<number | "">("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [ip, setIp] = useState("");
  const [q, setQ] = useState("");
  const [searchDraft, setSearchDraft] = useState("");

  const eventQuery = useMemo(
    () =>
      buildQuery({
        days,
        limit: 150,
        category: category || undefined,
        severity: severity || undefined,
        highRisk: highRisk ? 1 : undefined,
        userId: userId || undefined,
        action: action || undefined,
        entityType: entityType || undefined,
        entityId: entityId || undefined,
        ip: ip || undefined,
        q: q || undefined,
      }),
    [days, category, severity, highRisk, userId, action, entityType, entityId, ip, q],
  );

  const load = useCallback(async () => {
    setError("");
    try {
      const [ov, ev, ac, en] = await Promise.all([
        api<Overview>(`/admin/audit/overview?days=${days}`),
        api<{ events: AuditEvent[] }>(`/admin/audit?${eventQuery}`),
        api<{ actors: ActorPivot[] }>(`/admin/audit/actors?days=${days}`),
        api<{ entities: EntityPivot[] }>(`/admin/audit/entities?days=${days}`),
      ]);
      setOverview(ov);
      setEvents(ev.events);
      setActors(ac.actors);
      setEntities(en.entities);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load audit data");
    } finally {
      setLoading(false);
    }
  }, [days, eventQuery]);

  useLiveRefresh(load, { intervalMs: 45_000, deps: [days, eventQuery] });

  const maxDaily = useMemo(() => {
    if (!overview) return 1;
    return Math.max(1, ...overview.daily.map((d) => d.total));
  }, [overview]);

  const maxHour = useMemo(() => {
    if (!overview) return 1;
    return Math.max(1, ...overview.hours.map((h) => h.count));
  }, [overview]);

  const timelineGroups = useMemo(() => {
    const map = new Map<string, AuditEvent[]>();
    for (const ev of events) {
      const key = dayKey(ev.createdAt);
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [events]);

  function applyAnomalyFilter(filter?: Overview["anomalies"][0]["filter"]) {
    if (!filter) return;
    setCategory(filter.category ?? "");
    setHighRisk(Boolean(filter.highRisk));
    setUserId(filter.userId ?? "");
    setAction(filter.action ?? "");
    setIp(filter.ip ?? "");
    setEntityType(filter.entityType ?? "");
    setEntityId(filter.entityId ?? "");
    setTab("timeline");
  }

  function clearFilters() {
    setCategory("");
    setSeverity("");
    setHighRisk(false);
    setUserId("");
    setAction("");
    setEntityType("");
    setEntityId("");
    setIp("");
    setQ("");
    setSearchDraft("");
  }

  const hasFilters = Boolean(category || severity || highRisk || userId || action || entityType || entityId || ip || q);

  async function downloadCsv() {
    setExporting(true);
    try {
      const qs = buildQuery({
        days,
        limit: 5000,
        category: category || undefined,
        severity: severity || undefined,
        highRisk: highRisk ? 1 : undefined,
        userId: userId || undefined,
        action: action || undefined,
        entityType: entityType || undefined,
        entityId: entityId || undefined,
        ip: ip || undefined,
        q: q || undefined,
      });
      const res = await fetch(apiUrl(`/api/admin/audit/export?${qs}`), {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jbt-audit-${days}d.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  if (error && !overview) return <p className="field-error">{error}</p>;
  if (!overview) return <p className="muted">Loading audit intelligence…</p>;

  const t = overview.totals;
  const p = overview.previous;

  return (
    <div className="admin-page">
      <div className="admin-stack audit-page admin-page-scroll">
      <section className="panel admin-card">
        <div className="analytics-toolbar">
          <div>
            <h2>Audit & security</h2>
            <p className="muted">
              Who changed what across sign-ins, team access, billing, and documents
              {overview.platformWide ? " · platform-wide view" : ""}.
            </p>
          </div>
          <div className="admin-form-row">
            <button type="button" className="btn btn-secondary btn-sm" disabled={exporting} onClick={() => void downloadCsv()}>
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </div>
        </div>

        <div className="analytics-range" role="tablist" aria-label="Audit range">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              role="tab"
              aria-selected={days === r.value}
              className={days === r.value ? "active" : ""}
              onClick={() => setDays(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
        {loading ? <p className="muted">Refreshing…</p> : null}
        {error ? <p className="field-error">{error}</p> : null}

        <div className="analytics-kpis audit-kpis">
          <button type="button" className={`result-card audit-kpi${highRisk ? " is-active" : ""}`} onClick={() => { setHighRisk((v) => !v); setTab("timeline"); }}>
            <span>High-risk</span>
            <strong>{t.highRisk}</strong>
            <span className={deltaPct(t.highRisk, p.highRisk) > 0 ? "analytics-delta is-up" : "analytics-delta"}>
              {deltaPct(t.highRisk, p.highRisk) > 0 ? "+" : ""}
              {deltaPct(t.highRisk, p.highRisk)}% vs prior
            </span>
          </button>
          <button type="button" className={`result-card audit-kpi${category === "auth" ? " is-active" : ""}`} onClick={() => { setCategory((c) => (c === "auth" ? "" : "auth")); setTab("timeline"); }}>
            <span>Auth</span>
            <strong>{t.auth}</strong>
            <span className="muted">Sign-in & MFA</span>
          </button>
          <button type="button" className={`result-card audit-kpi${category === "team" ? " is-active" : ""}`} onClick={() => { setCategory((c) => (c === "team" ? "" : "team")); setTab("timeline"); }}>
            <span>Team</span>
            <strong>{t.team}</strong>
            <span className="muted">Access changes</span>
          </button>
          <button type="button" className={`result-card audit-kpi${category === "billing" ? " is-active" : ""}`} onClick={() => { setCategory((c) => (c === "billing" ? "" : "billing")); setTab("timeline"); }}>
            <span>Billing</span>
            <strong>{t.billing}</strong>
            <span className="muted">Plans & payments</span>
          </button>
          <article className="result-card">
            <span>People active</span>
            <strong>{t.actors}</strong>
            <span className="muted">{t.events.toLocaleString()} events</span>
          </article>
          <button type="button" className={`result-card audit-kpi${category === "documents" ? " is-active" : ""}`} onClick={() => { setCategory((c) => (c === "documents" ? "" : "documents")); setTab("timeline"); }}>
            <span>Documents</span>
            <strong>{t.documents}</strong>
            <span className="muted">Quotes & records</span>
          </button>
        </div>
      </section>

      {overview.anomalies.length > 0 ? (
        <section className="panel admin-card audit-radar">
          <h2>Risk radar</h2>
          <p className="muted">Signals worth a look for security, support, and finance — click to filter the timeline.</p>
          <div className="audit-anomaly-grid">
            {overview.anomalies.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`audit-anomaly severity-${a.severity}`}
                onClick={() => applyAnomalyFilter(a.filter)}
              >
                <span className="audit-anomaly-sev">{a.severity}</span>
                <strong>{a.title}</strong>
                <span>{a.body}</span>
                {a.count != null ? <em>{a.count}</em> : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="analytics-grid">
        <section className="panel admin-card">
          <h2>Activity volume</h2>
          <p className="muted">Daily audit events by family (IST days)</p>
          <div className="chart-bars" role="img" aria-label="Audit volume chart">
            {overview.daily.map((d) => (
              <div
                key={d.date}
                className="chart-col"
                title={`${d.date}: ${d.total} events (${d.highRisk} high-risk)`}
              >
                <div className="chart-stack" style={{ height: `${Math.max(4, (d.total / maxDaily) * 100)}%` }}>
                  <span className="seg seg-open" style={{ flexGrow: d.auth || 0.01 }} />
                  <span className="seg seg-create" style={{ flexGrow: d.team || 0.01 }} />
                  <span className="seg seg-export" style={{ flexGrow: d.billing || 0.01 }} />
                  <span className="seg seg-other" style={{ flexGrow: d.other || 0.01 }} />
                </div>
                <span className="chart-label">
                  {new Date(`${d.date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </span>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span><i className="seg-open" /> Auth</span>
            <span><i className="seg-create" /> Team</span>
            <span><i className="seg-export" /> Billing</span>
            <span><i className="seg-other" /> Other</span>
          </div>
        </section>

        <section className="panel admin-card">
          <h2>When activity happens</h2>
          <p className="muted">UTC hour-of-day heat (useful for odd-hour admin changes)</p>
          <div className="heat-grid">
            {overview.hours.map((h) => (
              <div
                key={h.hour}
                className="heat-cell"
                style={{ opacity: 0.15 + (h.count / maxHour) * 0.85 }}
                title={`${h.hour}:00 UTC — ${h.count} events`}
              >
                {h.hour}
              </div>
            ))}
          </div>
          <h3 className="analytics-subhead">Top actions</h3>
          <ul className="admin-list">
            {overview.topActions.map((a) => (
              <li key={a.action}>
                <button type="button" className="audit-inline-link" onClick={() => { setAction(a.action); setTab("timeline"); }}>
                  {a.label}
                </button>
                <span>{a.count}</span>
              </li>
            ))}
            {overview.topActions.length === 0 ? <li className="muted">No actions in this range.</li> : null}
          </ul>
        </section>
      </div>

      <section className="panel admin-card">
        <div className="admin-tabs-bar">
          <div className="admin-tabs" role="tablist">
            {(
              [
                ["timeline", "Investigation timeline"],
                ["people", "By person"],
                ["entities", "By entity"],
                ["feed", "All events"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={tab === id ? "active" : ""}
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="audit-filters">
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setQ(searchDraft.trim());
            }}
            placeholder="Search action, email, IP, entity…"
            aria-label="Search audit"
          />
          <select value={category} onChange={(e) => setCategory(e.target.value as AuditCategory | "")} aria-label="Category">
            <option value="">All categories</option>
            {AUDIT_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as AuditSeverity | "")} aria-label="Severity">
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <label className="audit-check">
            <input type="checkbox" checked={highRisk} onChange={(e) => setHighRisk(e.target.checked)} />
            High-risk only
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQ(searchDraft.trim())}>
            Apply
          </button>
          {hasFilters ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
              Clear
            </button>
          ) : null}
        </div>

        {action || userId || ip || entityType ? (
          <p className="audit-active-filters muted">
            Focus:
            {action ? <button type="button" className="pill" onClick={() => setAction("")}>{action} ×</button> : null}
            {userId ? <button type="button" className="pill" onClick={() => setUserId("")}>user #{userId} ×</button> : null}
            {ip ? <button type="button" className="pill" onClick={() => setIp("")}>{ip} ×</button> : null}
            {entityType ? (
              <button type="button" className="pill" onClick={() => { setEntityType(""); setEntityId(""); }}>
                {entityType}{entityId ? ` #${entityId}` : ""} ×
              </button>
            ) : null}
          </p>
        ) : null}

        {tab === "timeline" || tab === "feed" ? (
          <div className={tab === "timeline" ? "audit-timeline admin-scroll-list" : "tracker-list admin-scroll-list"}>
            {events.length === 0 ? (
              <p className="muted">No audit events match these filters.</p>
            ) : tab === "timeline" ? (
              timelineGroups.map(([key, rows]) => (
                <div key={key} className="audit-day">
                  <h3 className="audit-day-label">{dayLabel(key)}</h3>
                  <ol className="audit-day-list">
                    {rows.map((ev) => (
                      <li key={ev.id} className={`audit-event severity-${ev.severity}${expanded === ev.id ? " is-open" : ""}`}>
                        <button type="button" className="audit-event-main" onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}>
                          <span className="audit-avatar" aria-hidden>{initials(ev.actorName, ev.actorEmail)}</span>
                          <span className="audit-event-body">
                            <span className="audit-event-summary">{ev.summary}</span>
                            <span className="audit-event-meta">
                              <span className={`audit-sev-chip sev-${ev.severity}`}>{ev.severity}</span>
                              <span className="pill">{AUDIT_CATEGORIES.find((c) => c.id === ev.category)?.short ?? ev.category}</span>
                              <time dateTime={ev.createdAt}>{formatWhen(ev.createdAt)} IST</time>
                              {ev.ip ? <span className="mono">{ev.ip}</span> : null}
                              {ev.profileName ? <span>{ev.profileName}</span> : null}
                            </span>
                          </span>
                        </button>
                        {expanded === ev.id ? (
                          <div className="audit-event-detail">
                            <dl className="audit-dl">
                              <div><dt>Action</dt><dd className="mono">{ev.action}</dd></div>
                              <div><dt>Actor</dt><dd>{ev.actorName || "—"} {ev.actorEmail ? `(${ev.actorEmail})` : ""}</dd></div>
                              <div><dt>Entity</dt><dd>{ev.entityType || "—"}{ev.entityId ? ` #${ev.entityId}` : ""}</dd></div>
                              {overview.platformWide && ev.organizationName ? (
                                <div><dt>Organization</dt><dd>{ev.organizationName}</dd></div>
                              ) : null}
                              <div><dt>IP</dt><dd className="mono">{ev.ip || "—"}</dd></div>
                            </dl>
                            {ev.diff ? (
                              <pre className="audit-diff">{JSON.stringify(ev.diff, null, 2)}</pre>
                            ) : (
                              <p className="muted">No change payload stored for this event.</p>
                            )}
                            <div className="admin-form-row">
                              {ev.entityHref ? (
                                <Link href={ev.entityHref} className="btn btn-ghost btn-sm">Open related admin</Link>
                              ) : null}
                              {ev.userId != null ? (
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setUserId(ev.userId!); setTab("people"); }}>
                                  Focus this person
                                </button>
                              ) : null}
                              {ev.entityType && ev.entityId ? (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => {
                                    setEntityType(ev.entityType!);
                                    setEntityId(ev.entityId!);
                                    setTab("entities");
                                  }}
                                >
                                  Focus this entity
                                </button>
                              ) : null}
                              {ev.ip ? (
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setIp(ev.ip!); navigator.clipboard?.writeText(ev.ip!).catch(() => undefined); }}>
                                  Filter IP
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </div>
              ))
            ) : (
              events.map((ev) => (
                <div key={ev.id} className="tracker-row audit-feed-row">
                  <div className="tracker-row-main">
                    <span className="tracker-row-title">{ev.label}</span>
                    <span className="tracker-row-sub">{ev.summary}</span>
                  </div>
                  <div className="audit-feed-meta">
                    <span className={`audit-sev-chip sev-${ev.severity}`}>{ev.severity}</span>
                    <span>{formatWhen(ev.createdAt)}</span>
                    <span className="mono">{ev.ip || "—"}</span>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setExpanded(ev.id); setTab("timeline"); }}>
                    Inspect
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === "people" ? (
          <div className="tracker-list admin-scroll-list">
            {actors.length === 0 ? (
              <p className="muted">No actors in this range.</p>
            ) : (
              actors.map((a) => (
                <div key={String(a.userId ?? a.email ?? a.name)} className="tracker-row audit-actor-row">
                  <span className="audit-avatar lg" aria-hidden>{initials(a.name, a.email)}</span>
                  <div className="tracker-row-main">
                    <span className="tracker-row-title">{a.name}</span>
                    <span className="tracker-row-sub">
                      {a.email || "No email"}
                      {a.lastAt ? ` · last ${formatWhen(a.lastAt)}` : ""}
                    </span>
                    <div className="audit-cat-pills">
                      {AUDIT_CATEGORIES.filter((c) => (a.byCategory[c.id] ?? 0) > 0).map((c) => (
                        <span key={c.id} className="pill">{c.short} {a.byCategory[c.id]}</span>
                      ))}
                    </div>
                  </div>
                  <div className="audit-actor-stats">
                    <strong>{a.count}</strong>
                    <span className="muted">events</span>
                    {a.highRisk ? <span className="pill pill-warning">{a.highRisk} high-risk</span> : null}
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      if (a.userId != null) setUserId(a.userId);
                      setTab("timeline");
                    }}
                  >
                    View timeline
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}

        {tab === "entities" ? (
          <div className="tracker-list admin-scroll-list">
            {entities.length === 0 ? (
              <p className="muted">No entity-linked events in this range.</p>
            ) : (
              entities.map((e) => (
                <div key={`${e.entityType}:${e.entityId}`} className="tracker-row">
                  <div className="tracker-row-main">
                    <span className="tracker-row-title">{e.entityType.replace(/_/g, " ")} #{e.entityId}</span>
                    <span className="tracker-row-sub">
                      {e.lastAction || "—"}
                      {e.lastAt ? ` · ${formatWhen(e.lastAt)}` : ""}
                    </span>
                  </div>
                  <div className="audit-actor-stats">
                    <strong>{e.count}</strong>
                    <span className="muted">events</span>
                    {e.highRisk ? <span className="pill pill-warning">{e.highRisk} high-risk</span> : null}
                  </div>
                  <div className="admin-form-row">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setEntityType(e.entityType);
                        setEntityId(e.entityId);
                        setTab("timeline");
                      }}
                    >
                      History
                    </button>
                    {e.href ? (
                      <Link href={e.href} className="btn btn-ghost btn-sm">Open</Link>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}
      </section>

      <section className="panel admin-card">
        <h2>Category mix</h2>
        <p className="muted">How audit volume breaks down for this window — click a bar to filter.</p>
        <ul className="funnel audit-category-funnel">
          {overview.byCategory.map((c) => {
            const max = Math.max(1, ...overview.byCategory.map((x) => x.count));
            return (
              <li key={c.category}>
                <button
                  type="button"
                  className="audit-funnel-hit"
                  onClick={() => {
                    setCategory(c.category);
                    setTab("timeline");
                  }}
                >
                  <div className="funnel-bar" style={{ width: `${Math.max(8, (c.count / max) * 100)}%` }} />
                  <span>{c.label}</span>
                  <strong>{c.count.toLocaleString()}</strong>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      </div>
    </div>
  );
}

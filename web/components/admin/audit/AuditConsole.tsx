"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  ChartLegend,
  DataTable,
  FilterChip,
  Grid,
  KpiCard,
  PersonCell,
  ProgressBar,
  SearchInput,
  Segmented,
  Select,
  type BosBadgeTone,
  type BosColumn,
} from "@/components/bos";
import {
  AdminEmpty,
  AdminErrorState,
  AdminPage,
  AdminPageSkeleton,
  AdminSection,
  AdminTabs,
} from "@/components/admin/ui";
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

const RANGE_OPTIONS = RANGES.map((r) => ({ value: String(r.value), label: r.label }));

const VIEW_OPTIONS = [
  { value: "timeline", label: "Investigation timeline" },
  { value: "people", label: "By person" },
  { value: "entities", label: "By entity" },
  { value: "feed", label: "All events" },
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

function severityTone(sev: AuditSeverity): BosBadgeTone {
  if (sev === "critical" || sev === "high") return "coral";
  if (sev === "medium") return "amber";
  return "neutral";
}

function severityAvatarTone(sev: AuditSeverity) {
  if (sev === "critical" || sev === "high") return "var(--bos-coral)";
  if (sev === "medium") return "var(--bos-amber)";
  return undefined;
}

function categoryShort(id: AuditCategory) {
  return AUDIT_CATEGORIES.find((c) => c.id === id)?.short ?? id;
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

  if (error && !overview) {
    return (
      <AdminPage title="Audit & security" sub="Who changed what">
        <AdminErrorState message={error} onRetry={load} />
      </AdminPage>
    );
  }
  if (!overview) return <AdminPageSkeleton cards={6} />;

  const t = overview.totals;
  const p = overview.previous;
  const highRiskDelta = deltaPct(t.highRisk, p.highRisk);
  const categoryMax = Math.max(1, ...overview.byCategory.map((x) => x.count));

  function pickCategory(id: AuditCategory) {
    setCategory((c) => (c === id ? "" : id));
    setTab("timeline");
  }

  const feedColumns: ReadonlyArray<BosColumn<AuditEvent>> = [
    {
      key: "when",
      header: "When",
      mono: true,
      width: 130,
      cell: (ev) => <time dateTime={ev.createdAt}>{formatWhen(ev.createdAt)}</time>,
    },
    {
      key: "event",
      header: "Event",
      cell: (ev) => (
        <div>
          <div className="admin-cc-cell-title">{ev.label}</div>
          <div className="admin-cc-cell-sub">{ev.summary}</div>
        </div>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      cell: (ev) => (
        <Badge auto tone={severityTone(ev.severity)}>
          {ev.severity}
        </Badge>
      ),
    },
    { key: "ip", header: "IP", mono: true, cell: (ev) => ev.ip || "—" },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (ev) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setExpanded(ev.id);
            setTab("timeline");
          }}
        >
          Inspect
        </Button>
      ),
    },
  ];

  const actorColumns: ReadonlyArray<BosColumn<ActorPivot>> = [
    {
      key: "person",
      header: "Person",
      cell: (a) => (
        <PersonCell
          avatar={<Avatar size="sm">{initials(a.name, a.email)}</Avatar>}
          name={a.name}
          role={`${a.email || "No email"}${a.lastAt ? ` · last ${formatWhen(a.lastAt)}` : ""}`}
        />
      ),
    },
    {
      key: "mix",
      header: "Activity",
      cell: (a) => (
        <div className="admin-cc-badge-row" style={{ marginTop: 0 }}>
          {AUDIT_CATEGORIES.filter((c) => (a.byCategory[c.id] ?? 0) > 0).map((c) => (
            <Badge key={c.id} auto tone="neutral">
              {c.short} {a.byCategory[c.id]}
            </Badge>
          ))}
        </div>
      ),
    },
    { key: "count", header: "Events", align: "right", cell: (a) => a.count.toLocaleString() },
    {
      key: "risk",
      header: "High-risk",
      align: "right",
      cell: (a) =>
        a.highRisk ? (
          <Badge auto tone="amber">
            {a.highRisk}
          </Badge>
        ) : (
          "—"
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (a) => (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (a.userId != null) setUserId(a.userId);
            setTab("timeline");
          }}
        >
          View timeline
        </Button>
      ),
    },
  ];

  const entityColumns: ReadonlyArray<BosColumn<EntityPivot>> = [
    {
      key: "entity",
      header: "Entity",
      cell: (e) => (
        <div>
          <div className="admin-cc-cell-title">
            {e.entityType.replace(/_/g, " ")} #{e.entityId}
          </div>
          <div className="admin-cc-cell-sub">
            {e.lastAction || "—"}
            {e.lastAt ? ` · ${formatWhen(e.lastAt)}` : ""}
          </div>
        </div>
      ),
    },
    { key: "count", header: "Events", align: "right", cell: (e) => e.count.toLocaleString() },
    {
      key: "risk",
      header: "High-risk",
      align: "right",
      cell: (e) =>
        e.highRisk ? (
          <Badge auto tone="amber">
            {e.highRisk}
          </Badge>
        ) : (
          "—"
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (e) => (
        <div className="admin-cc-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEntityType(e.entityType);
              setEntityId(e.entityId);
              setTab("timeline");
            }}
          >
            History
          </Button>
          {e.href ? (
            <Link href={e.href}>
              <Button variant="ghost" size="sm">
                Open
              </Button>
            </Link>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <AdminPage
      title="Audit & security"
      sub={`Who changed what across sign-ins, team access, billing, and documents${
        overview.platformWide ? " · platform-wide view" : ""
      }.`}
      toolbar={
        <>
          <Segmented
            role="radio"
            size="sm"
            scroll
            aria-label="Audit range"
            options={RANGE_OPTIONS}
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
          />
          {loading ? (
            <Badge auto tone="blue">
              Refreshing…
            </Badge>
          ) : null}
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => void load()}>
            Refresh
          </Button>
          <Button variant="secondary" size="sm" icon="download" disabled={exporting} onClick={() => void downloadCsv()}>
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </>
      }
    >
      {error ? <AdminErrorState title="Refresh failed" message={error} onRetry={load} /> : null}

      <Grid cols={6} min={150} gap={12}>
        <button
          type="button"
          className={`admin-cc-kpi-btn${highRisk ? " is-selected" : ""}`}
          onClick={() => {
            setHighRisk((v) => !v);
            setTab("timeline");
          }}
        >
          <KpiCard
            label="High-risk"
            value={t.highRisk}
            chip={{ color: "rose", glyph: "!" }}
            delta={`${highRiskDelta > 0 ? "+" : ""}${highRiskDelta}% vs prior`}
            deltaTone={highRiskDelta > 0 ? "warn" : "muted"}
          />
        </button>
        <button
          type="button"
          className={`admin-cc-kpi-btn${category === "auth" ? " is-selected" : ""}`}
          onClick={() => pickCategory("auth")}
        >
          <KpiCard
            label="Auth"
            value={t.auth}
            chip={{ color: "blue", glyph: "◎" }}
            delta="Sign-in & MFA"
            deltaTone="muted"
          />
        </button>
        <button
          type="button"
          className={`admin-cc-kpi-btn${category === "team" ? " is-selected" : ""}`}
          onClick={() => pickCategory("team")}
        >
          <KpiCard
            label="Team"
            value={t.team}
            chip={{ color: "mint", glyph: "👤" }}
            delta="Access changes"
            deltaTone="muted"
          />
        </button>
        <button
          type="button"
          className={`admin-cc-kpi-btn${category === "billing" ? " is-selected" : ""}`}
          onClick={() => pickCategory("billing")}
        >
          <KpiCard
            label="Billing"
            value={t.billing}
            chip={{ color: "amber", glyph: "₹" }}
            delta="Plans & payments"
            deltaTone="muted"
          />
        </button>
        <KpiCard
          label="People active"
          value={t.actors}
          chip={{ color: "lavender", glyph: "▣" }}
          delta={`${t.events.toLocaleString()} events`}
          deltaTone="muted"
          interactive={false}
        />
        <button
          type="button"
          className={`admin-cc-kpi-btn${category === "documents" ? " is-selected" : ""}`}
          onClick={() => pickCategory("documents")}
        >
          <KpiCard
            label="Documents"
            value={t.documents}
            chip={{ color: "sage", glyph: "▤" }}
            delta="Quotes & records"
            deltaTone="muted"
          />
        </button>
      </Grid>

      {overview.anomalies.length > 0 ? (
        <AdminSection
          title="Risk radar"
          description="Signals worth a look for security, support, and finance — click to filter the timeline."
          actions={<Badge tone="amber">{overview.anomalies.length} signals</Badge>}
        >
          <Grid cols={3} min={240} gap={12}>
            {overview.anomalies.map((a) => (
              <button
                key={a.id}
                type="button"
                className="admin-cc-kpi-btn"
                onClick={() => applyAnomalyFilter(a.filter)}
              >
                <Card interactive>
                  <div className="admin-cc-hub">
                    <div className="admin-cc-hub-top">
                      <Badge auto tone={severityTone(a.severity)}>
                        {a.severity}
                      </Badge>
                      {a.count != null ? <span className="admin-cc-attention-count">{a.count}</span> : null}
                    </div>
                    <strong>{a.title}</strong>
                    <p className="admin-cc-hub-desc">{a.body}</p>
                  </div>
                </Card>
              </button>
            ))}
          </Grid>
        </AdminSection>
      ) : null}

      <Grid cols={2} template="1.35fr 1fr" min={280} gap={14}>
        <AdminSection title="Activity volume" description="Daily audit events by family (IST days).">
          {overview.daily.length === 0 ? (
            <AdminEmpty title="No activity in this range" />
          ) : (
            <>
              <div className="admin-cc-stackchart" role="img" aria-label="Audit volume chart">
                {overview.daily.map((d) => (
                  <div
                    key={d.date}
                    className="admin-cc-stackchart-col"
                    title={`${d.date}: ${d.total} events (${d.highRisk} high-risk)`}
                  >
                    <div className="admin-cc-stackchart-track">
                      <div
                        className="admin-cc-stackchart-bar"
                        style={{ height: `${Math.max(4, (d.total / maxDaily) * 100)}%` }}
                      >
                        <span className="is-auth" style={{ flexGrow: d.auth || 0.01 }} />
                        <span className="is-team" style={{ flexGrow: d.team || 0.01 }} />
                        <span className="is-billing" style={{ flexGrow: d.billing || 0.01 }} />
                        <span className="is-other" style={{ flexGrow: d.other || 0.01 }} />
                      </div>
                    </div>
                    <span className="admin-cc-stackchart-label">
                      {new Date(`${d.date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </span>
                  </div>
                ))}
              </div>
              <ChartLegend
                items={[
                  { label: "Auth", tone: "blue" },
                  { label: "Team", tone: "emerald" },
                  { label: "Billing", tone: "amber" },
                  { label: "Other", tone: "faint" },
                ]}
              />
            </>
          )}
        </AdminSection>

        <AdminSection
          title="When activity happens"
          description="UTC hour-of-day heat (useful for odd-hour admin changes)."
        >
          <div className="admin-cc-heat">
            {overview.hours.map((h) => (
              <div
                key={h.hour}
                className="admin-cc-heat-cell"
                style={{
                  background: `color-mix(in srgb, var(--bos-blue) ${Math.round(
                    10 + (h.count / maxHour) * 80,
                  )}%, transparent)`,
                }}
                title={`${h.hour}:00 UTC — ${h.count} events`}
              >
                {h.hour}
              </div>
            ))}
          </div>
          <h4 className="admin-cc-subhead">Top actions</h4>
          {overview.topActions.length === 0 ? (
            <p className="admin-cc-note-text">No actions in this range.</p>
          ) : (
            <ul className="admin-cc-roster-list" style={{ maxHeight: 280 }}>
              {overview.topActions.map((a) => (
                <li key={a.action}>
                  <button
                    type="button"
                    className="admin-cc-roster-row"
                    onClick={() => {
                      setAction(a.action);
                      setTab("timeline");
                    }}
                  >
                    <span>{a.label}</span>
                    <Badge auto tone="neutral">
                      {a.count}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>
      </Grid>

      <AdminSection
        title="Investigation"
        description="Filter by category, severity, person, IP, or entity — then drill into the timeline."
        actions={hasFilters ? <Badge tone="blue">Filters on</Badge> : null}
      >
        <div className="admin-cc-tabs-bar">
          <AdminTabs aria-label="Audit view" options={VIEW_OPTIONS} value={tab} onChange={setTab} />
        </div>

        <div className="admin-cc-filters">
          <SearchInput
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setQ(searchDraft.trim());
            }}
            placeholder="Search action, email, IP, entity…"
            aria-label="Search audit"
          />
          <Select
            size="sm"
            value={category}
            onChange={(e) => setCategory(e.target.value as AuditCategory | "")}
            aria-label="Category"
          >
            <option value="">All categories</option>
            {AUDIT_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
          <Select
            size="sm"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as AuditSeverity | "")}
            aria-label="Severity"
          >
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
          <span className="admin-cc-switch-row" style={{ paddingBottom: 0 }}>
            <Checkbox checked={highRisk} onChange={setHighRisk} aria-label="High-risk only" />
            High-risk only
          </span>
          <Button variant="secondary" size="sm" onClick={() => setQ(searchDraft.trim())}>
            Apply
          </Button>
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear
            </Button>
          ) : null}
        </div>

        {action || userId || ip || entityType ? (
          <div className="admin-cc-filters" style={{ marginTop: 10 }}>
            <span className="admin-cc-subhead" style={{ margin: 0 }}>
              Focus
            </span>
            {action ? (
              <FilterChip active onClick={() => setAction("")}>
                {action} ×
              </FilterChip>
            ) : null}
            {userId ? (
              <FilterChip active onClick={() => setUserId("")}>
                user #{userId} ×
              </FilterChip>
            ) : null}
            {ip ? (
              <FilterChip active onClick={() => setIp("")}>
                {ip} ×
              </FilterChip>
            ) : null}
            {entityType ? (
              <FilterChip
                active
                onClick={() => {
                  setEntityType("");
                  setEntityId("");
                }}
              >
                {entityType}
                {entityId ? ` #${entityId}` : ""} ×
              </FilterChip>
            ) : null}
          </div>
        ) : null}

        <div className="admin-cc-pad" style={{ padding: "14px 0 0" }}>
          {tab === "timeline" ? (
            events.length === 0 ? (
              <AdminEmpty title="No audit events match these filters" icon="search">
                Try a wider range or clear the filters.
              </AdminEmpty>
            ) : (
              <div className="admin-cc-scroll" style={{ maxHeight: 720 }}>
                {timelineGroups.map(([key, rows]) => (
                  <div key={key}>
                    <h3 className="admin-cc-live-day-label">
                      <span>{dayLabel(key)}</span>
                      <span>{rows.length}</span>
                    </h3>
                    <ol className="admin-cc-live-list">
                      {rows.map((ev) => {
                        const open = expanded === ev.id;
                        return (
                          <li key={ev.id} className={`admin-cc-live-event${open ? " is-open" : ""}`}>
                            <button
                              type="button"
                              className="admin-cc-live-main"
                              aria-expanded={open}
                              onClick={() => setExpanded(open ? null : ev.id)}
                            >
                              <Avatar size="sm" tone={severityAvatarTone(ev.severity)}>
                                {initials(ev.actorName, ev.actorEmail)}
                              </Avatar>
                              <span className="admin-cc-live-body">
                                <span className="admin-cc-live-summary">
                                  {ev.summary}
                                  <Badge auto tone={severityTone(ev.severity)}>
                                    {ev.severity}
                                  </Badge>
                                  <Badge auto tone="neutral">
                                    {categoryShort(ev.category)}
                                  </Badge>
                                </span>
                                <span className="admin-cc-live-sub">
                                  {ev.ip ? <span className="bos-mono">{ev.ip}</span> : null}
                                  {ev.profileName ? <span>{ev.profileName}</span> : null}
                                </span>
                              </span>
                              <time className="admin-cc-live-when" dateTime={ev.createdAt}>
                                {formatWhen(ev.createdAt)} IST
                              </time>
                            </button>
                            {open ? (
                              <div className="admin-cc-live-detail">
                                <ul className="admin-cc-kv">
                                  <li>
                                    <span>Action</span>
                                    <strong className="bos-mono">{ev.action}</strong>
                                  </li>
                                  <li>
                                    <span>Actor</span>
                                    <strong>
                                      {ev.actorName || "—"} {ev.actorEmail ? `(${ev.actorEmail})` : ""}
                                    </strong>
                                  </li>
                                  <li>
                                    <span>Entity</span>
                                    <strong>
                                      {ev.entityType || "—"}
                                      {ev.entityId ? ` #${ev.entityId}` : ""}
                                    </strong>
                                  </li>
                                  {overview.platformWide && ev.organizationName ? (
                                    <li>
                                      <span>Organization</span>
                                      <strong>{ev.organizationName}</strong>
                                    </li>
                                  ) : null}
                                  <li>
                                    <span>IP</span>
                                    <strong className="bos-mono">{ev.ip || "—"}</strong>
                                  </li>
                                </ul>
                                {ev.diff ? (
                                  <pre className="admin-cc-diff">{JSON.stringify(ev.diff, null, 2)}</pre>
                                ) : (
                                  <p className="admin-cc-note-text">No change payload stored for this event.</p>
                                )}
                                <div className="admin-cc-actions admin-cc-actions-start" style={{ marginTop: 10 }}>
                                  {ev.entityHref ? (
                                    <Link href={ev.entityHref}>
                                      <Button variant="ghost" size="sm">
                                        Open related admin
                                      </Button>
                                    </Link>
                                  ) : null}
                                  {ev.userId != null ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        setUserId(ev.userId!);
                                        setTab("people");
                                      }}
                                    >
                                      Focus this person
                                    </Button>
                                  ) : null}
                                  {ev.entityType && ev.entityId ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        setEntityType(ev.entityType!);
                                        setEntityId(ev.entityId!);
                                        setTab("entities");
                                      }}
                                    >
                                      Focus this entity
                                    </Button>
                                  ) : null}
                                  {ev.ip ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        setIp(ev.ip!);
                                        navigator.clipboard?.writeText(ev.ip!).catch(() => undefined);
                                      }}
                                    >
                                      Filter IP
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ))}
              </div>
            )
          ) : null}

          {tab === "feed" ? (
            <div className="admin-cc-scroll" style={{ maxHeight: 720 }}>
              <DataTable
                compact
                caption="All audit events"
                columns={feedColumns}
                rows={events}
                rowKey={(ev) => String(ev.id)}
                empty="No audit events match these filters."
              />
            </div>
          ) : null}

          {tab === "people" ? (
            <div className="admin-cc-scroll" style={{ maxHeight: 720 }}>
              <DataTable
                compact
                caption="Audit activity by person"
                columns={actorColumns}
                rows={actors}
                rowKey={(a) => String(a.userId ?? a.email ?? a.name)}
                empty="No actors in this range."
              />
            </div>
          ) : null}

          {tab === "entities" ? (
            <div className="admin-cc-scroll" style={{ maxHeight: 720 }}>
              <DataTable
                compact
                caption="Audit activity by entity"
                columns={entityColumns}
                rows={entities}
                rowKey={(e) => `${e.entityType}:${e.entityId}`}
                empty="No entity-linked events in this range."
              />
            </div>
          ) : null}
        </div>
      </AdminSection>

      <AdminSection
        title="Category mix"
        description="How audit volume breaks down for this window — click a bar to filter."
      >
        {overview.byCategory.length === 0 ? (
          <AdminEmpty title="No category data" />
        ) : (
          <ul className="admin-cc-verify-list admin-cc-mix-list">
            {overview.byCategory.map((c) => (
              <li key={c.category}>
                <button
                  type="button"
                  className="admin-cc-mix-row"
                  onClick={() => {
                    setCategory(c.category);
                    setTab("timeline");
                  }}
                >
                  <span>{c.label}</span>
                  <ProgressBar value={Math.max(4, (c.count / categoryMax) * 100)} tone="blue" label={`${c.label} share`} />
                  <strong>{c.count.toLocaleString()}</strong>
                </button>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </AdminPage>
  );
}

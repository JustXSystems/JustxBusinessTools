"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Grid,
  KpiCard,
  StatusLight,
  type BosColumn,
} from "@/components/bos";
import {
  AdminEmpty,
  AdminErrorState,
  AdminPage,
  AdminPageSkeleton,
  AdminSection,
} from "@/components/admin/ui";
import { adminDeepLink } from "@/lib/admin-deep-links";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

type OpsOverview = {
  generatedAt: string;
  viewer: { userId: number | null; isPlatformAdmin: boolean; role: string | null };
  runtime: {
    api: {
      ok: boolean;
      db: string;
      latencyMs: number;
      uptimeSec: number;
      memoryMb: number;
      role: string;
      nodeEnv: string;
    };
    web: { ok: boolean; status: number | null; latencyMs: number };
  };
  signals: {
    deliveryFailed7d: number;
    deliveryPending7d: number;
    auditHighRisk7d: number;
    recentErrorCount: number;
  };
  recentErrors: Array<{
    id: string;
    at: string;
    message: string;
    path?: string;
    method?: string;
    requestId?: string;
    kind?: string;
  }>;
  links: {
    grafana: string | null;
    grafanaExploreApi: string | null;
    grafanaExploreErrors: string | null;
    grafanaExploreTraces: string | null;
    grafanaExploreHost: string | null;
    grafanaTraceByIdTemplate: string | null;
    errorsUi: string | null;
    healthPublic: string;
    runbook: string;
    observabilityDoc: string;
  };
  config: {
    logFormat: string;
    sentryConfigured: boolean;
    webhookConfigured: boolean;
    grafanaConfigured: boolean;
    otelConfigured: boolean;
    otelEndpoint: string | null;
  };
};

type RecentError = OpsOverview["recentErrors"][number];

function fmtUptime(sec: number) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function relativeTime(iso: string) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  const sec = Math.max(0, Math.round(diff / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

/** External link rendered as a BOS button. */
function ExternalButton({
  href,
  variant = "secondary",
  children,
}: {
  href: string;
  variant?: "primary" | "secondary" | "ghost";
  children: string;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      <Button variant={variant} size="sm">
        {children}
      </Button>
    </a>
  );
}

export default function AdminOpsPage() {
  const [data, setData] = useState<OpsOverview | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await api<OpsOverview>("/admin/ops/overview");
      setData(next);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load operations");
    }
  }, []);

  useLiveRefresh(load, { intervalMs: 20_000 });

  useEffect(() => {
    if (!data || typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (hash !== "delivery") return;
    const el = document.getElementById("delivery");
    if (!el) return;
    requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [data]);

  if (error && !data) {
    return (
      <AdminPage title="Operations" section="Platform" sub="Service health">
        <AdminErrorState message={error} onRetry={load} />
      </AdminPage>
    );
  }
  if (!data) return <AdminPageSkeleton cards={4} />;

  const { runtime, signals, recentErrors, links, config } = data;
  const healthy = runtime.api.ok && runtime.web.ok;

  const errorColumns: ReadonlyArray<BosColumn<RecentError>> = [
    {
      key: "at",
      header: "When",
      mono: true,
      width: 96,
      cell: (ev) => <span title={ev.at}>{relativeTime(ev.at)}</span>,
    },
    {
      key: "message",
      header: "Error",
      cell: (ev) => (
        <div>
          <div className="admin-cc-cell-title">{ev.message}</div>
          <div className="admin-cc-cell-sub">
            {ev.method || "—"} {ev.path || "—"}
          </div>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      cell: (ev) =>
        ev.kind ? (
          <Badge auto tone="coral">
            {ev.kind}
          </Badge>
        ) : (
          "—"
        ),
    },
    {
      key: "requestId",
      header: "Request id",
      mono: true,
      cell: (ev) => (ev.requestId ? <span className="bos-mono">{ev.requestId}</span> : "—"),
    },
  ];

  return (
    <AdminPage
      title="Operations"
      section="Platform"
      sub="Service health · error pulse · observability"
      toolbar={
        <>
          <StatusLight state={healthy ? "on" : "warn"} pulse>
            {healthy ? "Operational" : "Needs attention"}
          </StatusLight>
          <Badge auto tone="blue">
            Updated {relativeTime(data.generatedAt)} · refreshes every 20s
          </Badge>
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => void load()}>
            Refresh
          </Button>
        </>
      }
    >
      {error ? <AdminErrorState title="Refresh failed" message={error} onRetry={load} /> : null}

      <Grid cols={4} min={180} gap={12}>
        <KpiCard
          label="API"
          value={runtime.api.ok ? "Healthy" : "Degraded"}
          valueTone={runtime.api.ok ? undefined : "coral"}
          chip={{ color: runtime.api.ok ? "mint" : "rose", glyph: "◉" }}
          interactive={false}
          delta={`DB ${runtime.api.db} · ${runtime.api.latencyMs}ms · ${runtime.api.memoryMb} MB · up ${fmtUptime(runtime.api.uptimeSec)}`}
          deltaTone={runtime.api.ok ? "up" : "down"}
        />
        <KpiCard
          label="Web"
          value={runtime.web.ok ? "Reachable" : "Unreachable"}
          valueTone={runtime.web.ok ? undefined : "coral"}
          chip={{ color: runtime.web.ok ? "blue" : "rose", glyph: "◎" }}
          interactive={false}
          delta={`${runtime.web.status ?? "—"} · ${runtime.web.latencyMs}ms`}
          deltaTone={runtime.web.ok ? "up" : "down"}
        />
        <Link href={adminDeepLink.audit()} className="admin-cc-kpi-link">
          <KpiCard
            label="Audit risk (7d)"
            value={signals.auditHighRisk7d}
            chip={{ color: "lavender", glyph: "▣" }}
            delta="High-risk security events"
            deltaTone={signals.auditHighRisk7d ? "warn" : "muted"}
          />
        </Link>
        <KpiCard
          label="Error pulse"
          value={signals.recentErrorCount}
          chip={{ color: "amber", glyph: "!" }}
          interactive={false}
          delta="In-memory since API start"
          deltaTone={signals.recentErrorCount ? "warn" : "muted"}
        />
      </Grid>

      <Grid cols={4} min={200} gap={12} className="admin-cc-health-grid">
        <Link id="delivery" href={adminDeepLink.integrations()} className="admin-cc-card-link">
          <Card interactive>
            <div className="bos-kpi-label">Document delivery</div>
            <div className="bos-kpi-value">{signals.deliveryFailed7d} failed</div>
            <div className={`bos-kpi-delta${signals.deliveryFailed7d ? " bos-kpi-delta-down" : ""}`}>
              {signals.deliveryPending7d} pending · 7 days · check Drive / webhook integrations
            </div>
          </Card>
        </Link>
        <a href={links.healthPublic} target="_blank" rel="noreferrer" className="admin-cc-card-link">
          <Card interactive>
            <div className="bos-kpi-label">Public health</div>
            <div className="bos-kpi-value">/api/health</div>
            <div className="bos-kpi-delta bos-kpi-delta-muted">Open probe endpoint</div>
          </Card>
        </a>
        <Card>
          <div className="bos-kpi-label">Telemetry config</div>
          <div className="bos-kpi-value">{config.logFormat}</div>
          <div className="admin-cc-badge-row">
            <Badge auto tone={config.otelConfigured ? "emerald" : "neutral"}>
              OTel {config.otelConfigured ? "on" : "off"}
            </Badge>
            <Badge auto tone={config.webhookConfigured ? "emerald" : "neutral"}>
              Webhook {config.webhookConfigured ? "on" : "off"}
            </Badge>
            <Badge auto tone={config.sentryConfigured ? "emerald" : "neutral"}>
              Sentry/GlitchTip {config.sentryConfigured ? "on" : "off"}
            </Badge>
            <Badge auto tone={config.grafanaConfigured ? "emerald" : "neutral"}>
              Grafana {config.grafanaConfigured ? "linked" : "not set"}
            </Badge>
          </div>
        </Card>
        <Card>
          <div className="bos-kpi-label">Process</div>
          <div className="bos-kpi-value">{runtime.api.role}</div>
          <div className="bos-kpi-delta bos-kpi-delta-muted">{runtime.api.nodeEnv}</div>
        </Card>
      </Grid>

      <AdminSection
        title="Observability links"
        description={
          <>
            Full log search and dashboards live in Grafana. Configure <code className="admin-cc-code">GRAFANA_PUBLIC_URL</code> on
            the API.
          </>
        }
      >
        <div className="admin-cc-link-row">
          {links.grafana ? (
            <ExternalButton href={links.grafana} variant="primary">
              Open Grafana
            </ExternalButton>
          ) : (
            <Button variant="secondary" size="sm" disabled aria-disabled>
              Grafana not configured
            </Button>
          )}
          {links.grafanaExploreApi ? <ExternalButton href={links.grafanaExploreApi}>Loki: API logs (1h)</ExternalButton> : null}
          {links.grafanaExploreErrors ? (
            <ExternalButton href={links.grafanaExploreErrors}>Loki: warn/error (1h)</ExternalButton>
          ) : null}
          {links.grafanaExploreTraces ? <ExternalButton href={links.grafanaExploreTraces}>Tempo: traces</ExternalButton> : null}
          {links.grafanaExploreHost ? (
            <ExternalButton href={links.grafanaExploreHost}>Prometheus: host mem</ExternalButton>
          ) : null}
          {links.errorsUi ? (
            <ExternalButton href={links.errorsUi} variant="ghost">
              Errors UI
            </ExternalButton>
          ) : null}
          <ExternalButton href={links.observabilityDoc} variant="ghost">
            Setup guide
          </ExternalButton>
          <ExternalButton href={links.runbook} variant="ghost">
            Production runbook
          </ExternalButton>
          <Link href="/admin">
            <Button variant="ghost" size="sm">
              Command center
            </Button>
          </Link>
        </div>
      </AdminSection>

      <AdminSection
        title="Recent errors"
        description={
          <>
            From this API process. Use request id in Grafana Explore:{" "}
            <code className="admin-cc-code">{`{service="justx-jbt-api"} |= "requestId"`}</code>
          </>
        }
        actions={
          recentErrors.length ? (
            <Badge tone="coral">{recentErrors.length} recent</Badge>
          ) : (
            <Badge tone="emerald">Clear</Badge>
          )
        }
      >
        {recentErrors.length === 0 ? (
          <AdminEmpty title="No errors recorded" icon="check">
            Nothing since the last API restart.
          </AdminEmpty>
        ) : (
          <div className="admin-cc-scroll">
            <DataTable
              compact
              caption="Recent API errors"
              columns={errorColumns}
              rows={recentErrors}
              rowKey={(ev) => ev.id}
            />
          </div>
        )}
      </AdminSection>

      <AdminSection title="On-call checklist" description="First moves when something looks wrong.">
        <ul className="admin-cc-attention-list">
          <li className="admin-cc-attention-item">
            <div className="admin-cc-attention-main">
              <Badge auto tone="coral">
                SEV-1
              </Badge>
              <div>
                <strong>Site down</strong>
                <p>Check public health → PM2 status → nginx → MySQL. See production runbook §12.</p>
              </div>
            </div>
          </li>
          <li className="admin-cc-attention-item">
            <div className="admin-cc-attention-main">
              <Badge auto tone="blue">
                Triage
              </Badge>
              <div>
                <strong>Correlate a user report</strong>
                <p>Ask for time (IST) and any error id / request id from the UI, then search Loki.</p>
              </div>
            </div>
          </li>
          <li className="admin-cc-attention-item">
            <div className="admin-cc-attention-main">
              <Badge auto tone="neutral">
                Setup
              </Badge>
              <div>
                <strong>Ship the Grafana stack</strong>
                <p>
                  On the VPS: <code className="admin-cc-code">deploy/observability/docker-compose.yml</code> — see{" "}
                  <code className="admin-cc-code">docs/OBSERVABILITY.md</code>.
                </p>
              </div>
            </div>
          </li>
        </ul>
      </AdminSection>
    </AdminPage>
  );
}

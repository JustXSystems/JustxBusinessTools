"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
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
  };
};

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

  if (error && !data) return <p className="field-error">{error}</p>;
  if (!data) return <p className="muted">Loading operations…</p>;

  const { runtime, signals, recentErrors, links, config } = data;

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <div className="analytics-toolbar">
          <div>
            <h2>Operations</h2>
            <p className="muted">
              Service health, error pulse, and deep links to Grafana / error tracking — not a full Dynatrace
              clone. Refreshes every 20s.
            </p>
          </div>
          <span className="muted small">Updated {relativeTime(data.generatedAt)}</span>
        </div>
        <div className="analytics-kpis">
          <article className={`result-card${runtime.api.ok ? "" : " dash-kpi-alert"}`}>
            <span>API</span>
            <strong>{runtime.api.ok ? "Healthy" : "Degraded"}</strong>
            <span className="analytics-delta">
              DB {runtime.api.db} · {runtime.api.latencyMs}ms · {runtime.api.memoryMb} MB · up{" "}
              {fmtUptime(runtime.api.uptimeSec)}
            </span>
          </article>
          <article className={`result-card${runtime.web.ok ? "" : " dash-kpi-alert"}`}>
            <span>Web</span>
            <strong>{runtime.web.ok ? "Reachable" : "Unreachable"}</strong>
            <span className="analytics-delta">
              {runtime.web.status ?? "—"} · {runtime.web.latencyMs}ms
            </span>
          </article>
          <Link
            href="/admin/audit"
            className={`result-card${signals.auditHighRisk7d ? " dash-kpi-warn" : ""}`}
          >
            <span>Audit risk (7d)</span>
            <strong>{signals.auditHighRisk7d}</strong>
            <span className="analytics-delta">High-risk security events</span>
          </Link>
          <article className={`result-card${signals.recentErrorCount ? " dash-kpi-warn" : ""}`}>
            <span>Error pulse</span>
            <strong>{signals.recentErrorCount}</strong>
            <span className="analytics-delta">In-memory since API start</span>
          </article>
        </div>
      </section>

      <div className="admin-page-scroll">
        <div className="admin-grid dash-health-grid">
          <Link href="/admin/profiles" className="panel admin-card dash-health-card">
            <h2>Document delivery</h2>
            <strong>{signals.deliveryFailed7d} failed</strong>
            <p className={signals.deliveryFailed7d ? "analytics-delta is-down" : "muted"}>
              {signals.deliveryPending7d} pending · 7 days
            </p>
          </Link>
          <a
            href={links.healthPublic}
            target="_blank"
            rel="noreferrer"
            className="panel admin-card dash-health-card"
          >
            <h2>Public health</h2>
            <strong>/api/health</strong>
            <p className="muted">Open probe endpoint</p>
          </a>
          <div className="panel admin-card dash-health-card">
            <h2>Telemetry config</h2>
            <strong>{config.logFormat}</strong>
            <p className="muted">
              Logs · webhook {config.webhookConfigured ? "on" : "off"} · Sentry/GlitchTip{" "}
              {config.sentryConfigured ? "on" : "off"} · Grafana{" "}
              {config.grafanaConfigured ? "linked" : "not set"}
            </p>
          </div>
          <div className="panel admin-card dash-health-card">
            <h2>Process</h2>
            <strong>{runtime.api.role}</strong>
            <p className="muted">{runtime.api.nodeEnv}</p>
          </div>
        </div>

        <section className="panel admin-card">
          <div className="analytics-toolbar">
            <div>
              <h2>Observability links</h2>
              <p className="muted">
                Full log search and dashboards live in Grafana. Configure{" "}
                <code>GRAFANA_PUBLIC_URL</code> on the API.
              </p>
            </div>
          </div>
          <div className="dash-link-row">
            {links.grafana ? (
              <a href={links.grafana} className="btn btn-primary btn-sm" target="_blank" rel="noreferrer">
                Open Grafana
              </a>
            ) : (
              <span className="btn btn-secondary btn-sm" aria-disabled>
                Grafana not configured
              </span>
            )}
            {links.grafanaExploreApi ? (
              <a
                href={links.grafanaExploreApi}
                className="btn btn-secondary btn-sm"
                target="_blank"
                rel="noreferrer"
              >
                Loki: API logs (1h)
              </a>
            ) : null}
            {links.grafanaExploreErrors ? (
              <a
                href={links.grafanaExploreErrors}
                className="btn btn-secondary btn-sm"
                target="_blank"
                rel="noreferrer"
              >
                Loki: warn/error (1h)
              </a>
            ) : null}
            {links.errorsUi ? (
              <a href={links.errorsUi} className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer">
                Errors UI
              </a>
            ) : null}
            <a href={links.observabilityDoc} className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer">
              Setup guide
            </a>
            <a href={links.runbook} className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer">
              Production runbook
            </a>
            <Link href="/admin" className="btn btn-ghost btn-sm">
              Command center
            </Link>
          </div>
        </section>

        <section className="panel admin-card">
          <div className="analytics-toolbar">
            <div>
              <h2>Recent errors</h2>
              <p className="muted">
                From this API process. Use request id in Grafana Explore:{" "}
                <code>{`{service="justx-jbt-api"} |= "requestId"`}</code>
              </p>
            </div>
          </div>
          {recentErrors.length === 0 ? (
            <p className="muted">No errors recorded since the last API restart.</p>
          ) : (
            <div className="tracker-list">
              {recentErrors.map((ev) => (
                <div key={ev.id} className="tracker-row">
                  <div className="tracker-row-main">
                    <span className="tracker-row-title">{ev.message}</span>
                    <span className="tracker-row-sub">
                      {ev.method || "—"} {ev.path || "—"}
                      {ev.kind ? ` · ${ev.kind}` : ""}
                      {ev.requestId ? (
                        <>
                          {" · "}
                          <span className="mono">{ev.requestId}</span>
                        </>
                      ) : null}
                    </span>
                  </div>
                  <span className="muted" title={ev.at}>
                    {relativeTime(ev.at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel admin-card">
          <h2>On-call checklist</h2>
          <ul className="admin-insights">
            <li>
              <strong>SEV-1 site down</strong>
              <p>Check public health → PM2 status → nginx → MySQL. See production runbook §12.</p>
            </li>
            <li>
              <strong>Correlate a user report</strong>
              <p>Ask for time (IST) and any error id / request id from the UI, then search Loki.</p>
            </li>
            <li>
              <strong>Ship the Grafana stack</strong>
              <p>
                On the VPS: <code>deploy/observability/docker-compose.yml</code> — see{" "}
                <code>docs/OBSERVABILITY.md</code>.
              </p>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

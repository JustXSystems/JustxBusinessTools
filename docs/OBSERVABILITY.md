# JustX Business Tools — Observability

**Goal:** Dynatrace-class *operations* without rebuilding APM inside `/admin`.

| Layer | Tool | Role |
|-------|------|------|
| Control tower | Admin → **Operations** (`/jbt/admin/ops`) | Health, error pulse, deep links |
| Logs + metrics UI | **Grafana** + **Loki** + **Prometheus** | Search logs, dashboards |
| Log shipper | **Grafana Alloy** | Scrapes PM2 JSON logs → Loki |
| Errors | **Sentry** or **GlitchTip** via `SENTRY_DSN` | Exception store |
| Alerts | `ERROR_WEBHOOK_URL` + optional Grafana Alerting | Slack/Discord page |

Do **not** install SigNoz/ClickHouse on the same small Hostinger KVM as MySQL + PM2.

---

## 1. Application (already in repo)

### Structured logs

- Production defaults to JSON lines on stdout (`LOG_FORMAT=json`).
- Each request gets `X-Request-Id` (echoed on 500 responses as `requestId`).
- Access log event: `msg=http_request` with `status`, `durationMs`, `path`.

Set in `server/.env`:

```bash
LOG_FORMAT=json
ERROR_WEBHOOK_URL=https://hooks.slack.com/...   # or Discord
SENTRY_DSN=https://KEY@HOST/PROJECT             # Sentry SaaS or GlitchTip
SENTRY_ENVIRONMENT=production
GRAFANA_PUBLIC_URL=https://justxsystems.com/grafana
ERRORS_UI_URL=https://glitchtip.example/        # optional link in Ops UI
```

### Admin Operations

Open **Admin → Operations**. Shows:

- API / Web probe + DB status, memory, uptime  
- Delivery / audit risk signals  
- Recent in-memory errors with **request id**  
- Links to Grafana Explore and runbooks  

---

## 2. Deploy Grafana stack (VPS)

Requires Docker on the host (or a dedicated monitoring VM).

```bash
cd /var/www/jbt/deploy/observability
cp .env.example .env
# edit GF_SECURITY_ADMIN_PASSWORD and GF_SERVER_ROOT_URL
docker compose up -d
```

Grafana listens on **127.0.0.1:3003**. Wire nginx:

```bash
# merge deploy/observability/nginx-grafana.conf.example into the site config
sudo nginx -t && sudo systemctl reload nginx
```

Confirm Alloy can read PM2 logs (`/home/deploy/.pm2/logs`). If your PM2 home differs, edit the volume in `docker-compose.yml`.

After Grafana is up, set `GRAFANA_PUBLIC_URL` on the API and `pm2 reload ecosystem.config.cjs --update-env`.

### Useful Loki queries

```logql
{service="justx-jbt-api"}
{service="justx-jbt-api"} |= "http_request" | json | status >= 500
{service="justx-jbt-api"} |= "<paste-request-id>"
```

---

## 3. GlitchTip (optional self-hosted Sentry)

GlitchTip speaks the Sentry store API. Point `SENTRY_DSN` at your GlitchTip project DSN — no SDK install required (JBT posts via [`server/src/lib/error-reporting.ts`](../server/src/lib/error-reporting.ts)).

Set `ERRORS_UI_URL` to the GlitchTip UI so Operations can deep-link.

---

## 4. Later (Phase 4)

- OpenTelemetry SDK on Express → Grafana Alloy → Tempo  
- `node_exporter` + MySQL exporter in Prometheus  
- Move the compose stack to a second VPS if RAM is tight  

---

## 5. Security

- Grafana: strong admin password; prefer SSO/basic auth; no anonymous access  
- Operations page: same Admin role gate as the rest of `/admin`  
- Never commit Grafana passwords or DSNs  

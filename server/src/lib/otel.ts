/**
 * Opt-in OpenTelemetry (API + worker).
 * Enable with:
 *   OTEL_ENABLED=true
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
 *
 * Loaded via --import before app code so auto-instrumentation can patch Express/http.
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

let started = false;

function truthy(v: string | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export function isOtelEnabled(): boolean {
  return truthy(process.env.OTEL_ENABLED);
}

export function startOtel(): void {
  if (started || !isOtelEnabled()) return;
  started = true;

  const endpoint = (
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    "http://127.0.0.1:4318"
  ).replace(/\/$/, "");

  const role = process.env.JBT_PROCESS_ROLE ?? "api";
  const serviceName =
    process.env.OTEL_SERVICE_NAME ||
    (role === "worker" ? "justx-jbt-worker" : "justx-jbt-api");

  if (truthy(process.env.OTEL_DIAG_DEBUG)) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const exporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  });

  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.1.0",
      "deployment.environment": process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-net": { enabled: false },
      }),
    ],
  });

  sdk.start();

  const shutdown = () => {
    void sdk.shutdown().catch(() => undefined);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

/**
 * Structured JSON logging for Grafana Loki / Alloy scraping of PM2 stdout.
 * Enable with LOG_FORMAT=json (default in production).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { context, trace } from "@opentelemetry/api";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

type RequestLogStore = {
  requestId: string;
  method?: string;
  path?: string;
};

const requestStore = new AsyncLocalStorage<RequestLogStore>();

const SERVICE =
  process.env.JBT_PROCESS_ROLE === "worker" ? "justx-jbt-worker" : "justx-jbt-api";

function useJsonLogs(): boolean {
  const fmt = (process.env.LOG_FORMAT ?? "").trim().toLowerCase();
  if (fmt === "text" || fmt === "pretty") return false;
  if (fmt === "json") return true;
  return process.env.NODE_ENV === "production";
}

function redact(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.length > 500) return `${value.slice(0, 500)}…`;
    return value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = k.toLowerCase();
    if (
      key.includes("password") ||
      key.includes("secret") ||
      key.includes("token") ||
      key.includes("authorization") ||
      key.includes("cookie") ||
      key.includes("apikey") ||
      key.includes("api_key")
    ) {
      out[k] = "[redacted]";
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

export function newRequestId(): string {
  return randomBytes(12).toString("hex");
}

export function runWithRequestLog<T>(store: RequestLogStore, fn: () => T): T {
  return requestStore.run(store, fn);
}

export function getRequestId(): string | undefined {
  return requestStore.getStore()?.requestId;
}

function activeTraceId(): string | undefined {
  try {
    const span = trace.getSpan(context.active());
    const id = span?.spanContext().traceId;
    if (id && id !== "00000000000000000000000000000000") return id;
  } catch {
    /* OTel optional */
  }
  return undefined;
}

function write(level: LogLevel, msg: string, fields: LogFields = {}): void {
  const req = requestStore.getStore();
  const safeFields = (redact(fields) ?? {}) as LogFields;
  const traceId = activeTraceId();
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    service: SERVICE,
    msg,
    requestId: req?.requestId,
    method: req?.method,
    path: req?.path,
    env: process.env.NODE_ENV ?? "development",
    ...(traceId ? { traceId } : {}),
    ...safeFields,
  };

  if (useJsonLogs()) {
    const line = JSON.stringify(payload);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    return;
  }

  const suffix = Object.keys(fields).length ? ` ${JSON.stringify(safeFields)}` : "";
  const prefix = req?.requestId ? `[${req.requestId}] ` : "";
  const text = `${prefix}${msg}${suffix}`;
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const log = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};

/**
 * Optional production error reporting — no hard dependency on Sentry/GlitchTip SDK.
 * Configure ERROR_WEBHOOK_URL and/or SENTRY_DSN (Sentry or GlitchTip compatible).
 */
import { randomBytes } from "node:crypto";
import { getRequestId, log } from "./logging.js";
import { recordOpsError } from "./ops-errors.js";

export type ErrorReportContext = {
  path?: string;
  method?: string;
  userId?: number | null;
  requestId?: string;
  extra?: Record<string, unknown>;
};

export async function reportError(
  err: unknown,
  context: ErrorReportContext = {},
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  const requestId = context.requestId ?? getRequestId();
  const payload = {
    service: process.env.JBT_PROCESS_ROLE === "worker" ? "justx-jbt-worker" : "justx-jbt-api",
    env: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    message,
    stack,
    ...context,
    requestId,
    at: new Date().toISOString(),
  };

  recordOpsError({
    message,
    path: context.path,
    method: context.method,
    userId: context.userId,
    requestId,
    kind: typeof context.extra?.kind === "string" ? context.extra.kind : "error",
    at: payload.at,
  });

  log.error(message, {
    stack: stack ? String(stack).slice(0, 2000) : undefined,
    path: context.path,
    method: context.method,
    userId: context.userId,
    requestId,
    kind: context.extra?.kind,
  });

  const webhook = process.env.ERROR_WEBHOOK_URL?.trim();
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `[JBT] ${message}${requestId ? ` (${requestId})` : ""}`,
          ...payload,
        }),
      });
    } catch (sendErr) {
      log.warn("error_webhook_failed", {
        detail: sendErr instanceof Error ? sendErr.message : String(sendErr),
      });
    }
  }

  const dsn = process.env.SENTRY_DSN?.trim();
  if (dsn) {
    try {
      await sendSentryEvent(dsn, payload);
    } catch (sendErr) {
      log.warn("sentry_failed", {
        detail: sendErr instanceof Error ? sendErr.message : String(sendErr),
      });
    }
  }
}

async function sendSentryEvent(
  dsn: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const m = /^https?:\/\/([^@]+)@([^/]+)\/(\d+)/.exec(dsn);
  if (!m) return;
  const [, key, host, project] = m;
  const url = `https://${host}/api/${project}/store/`;
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${key}, sentry_client=jbt/1.0`,
    },
    body: JSON.stringify({
      event_id: randomBytes(16).toString("hex"),
      timestamp: Math.floor(Date.now() / 1000),
      platform: "node",
      level: "error",
      server_name: process.env.HOSTNAME ?? "jbt",
      message: String(payload.message ?? "error"),
      exception: payload.stack
        ? {
            values: [
              {
                type: "Error",
                value: String(payload.message),
                stacktrace: {
                  frames: [{ filename: "app", function: String(payload.stack).slice(0, 500) }],
                },
              },
            ],
          }
        : undefined,
      tags: {
        service: String(payload.service ?? "justx-jbt-api"),
        request_id: payload.requestId ? String(payload.requestId) : undefined,
      },
      extra: payload,
    }),
  });
}

export function installProcessErrorHandlers(): void {
  process.on("unhandledRejection", (reason) => {
    void reportError(reason, { extra: { kind: "unhandledRejection" } });
  });
  process.on("uncaughtException", (err) => {
    void reportError(err, { extra: { kind: "uncaughtException" } });
  });
}

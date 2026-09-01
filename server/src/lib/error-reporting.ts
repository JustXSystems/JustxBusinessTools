/**
 * Optional production error reporting — no hard dependency on Sentry SDK.
 * Configure ERROR_WEBHOOK_URL and/or SENTRY_DSN.
 */
import { randomBytes } from "node:crypto";

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
  const payload = {
    service: "justx-jbt-api",
    env: process.env.NODE_ENV ?? "development",
    message,
    stack,
    ...context,
    at: new Date().toISOString(),
  };

  const webhook = process.env.ERROR_WEBHOOK_URL?.trim();
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `[JBT] ${message}`, ...payload }),
      });
    } catch (sendErr) {
      console.warn("[errors] webhook failed", sendErr instanceof Error ? sendErr.message : sendErr);
    }
  }

  const dsn = process.env.SENTRY_DSN?.trim();
  if (dsn) {
    try {
      await sendSentryEvent(dsn, payload);
    } catch (sendErr) {
      console.warn("[errors] sentry failed", sendErr instanceof Error ? sendErr.message : sendErr);
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
      tags: { service: "justx-jbt-api" },
      extra: payload,
    }),
  });
}

export function installProcessErrorHandlers(): void {
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
    void reportError(reason, { extra: { kind: "unhandledRejection" } });
  });
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err);
    void reportError(err, { extra: { kind: "uncaughtException" } });
  });
}

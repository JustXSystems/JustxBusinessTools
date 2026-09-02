import type { NextFunction, Request, Response } from "express";
import { context, trace } from "@opentelemetry/api";
import { log, newRequestId, runWithRequestLog } from "../lib/logging.js";

/**
 * Assigns X-Request-Id, structured access logs, and request-scoped log context.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = String(req.headers["x-request-id"] ?? "").trim();
  const requestId = /^[a-zA-Z0-9_-]{8,64}$/.test(incoming) ? incoming : newRequestId();
  res.setHeader("X-Request-Id", requestId);

  const started = Date.now();
  runWithRequestLog({ requestId, method: req.method, path: req.path }, () => {
    try {
      const span = trace.getSpan(context.active());
      span?.setAttribute("request.id", requestId);
      span?.setAttribute("http.route", req.path);
    } catch {
      /* OTel optional */
    }
    res.on("finish", () => {
      const durationMs = Date.now() - started;
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      log[level]("http_request", {
        status: res.statusCode,
        durationMs,
        requestId,
        method: req.method,
        path: req.path,
      });
    });
    next();
  });
}

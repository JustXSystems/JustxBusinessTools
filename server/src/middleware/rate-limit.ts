import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0]!.trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).split(",")[0]!.trim();
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Simple fixed-window rate limiter (single-node / PM2-friendly).
 * Use on auth + webhook routes to blunt brute force / spray.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
  name?: string;
}) {
  const name = opts.name ?? "rl";
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = `${name}:${opts.key ? opts.key(req) : clientIp(req)}`;
    const now = Date.now();
    let bucket = buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(id, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, opts.max - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(opts.max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > opts.max) {
      res.status(429).json({ error: "Too many requests — try again shortly" });
      return;
    }
    next();
  };
}

/** Periodic cleanup so the Map does not grow without bound. */
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}, 60_000).unref?.();

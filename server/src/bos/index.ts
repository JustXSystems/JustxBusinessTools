import { Router, type NextFunction, type Request, type Response } from "express";
import { registerConnect } from "./connect.js";
import type { BosConnector } from "./connectors/types.js";
import type { BosDeps } from "./context.js";
import type { BosDb } from "./db.js";
import { registerFinance } from "./finance.js";
import { BosError, type BosHost } from "./host.js";
import { registerHr } from "./hr.js";
import { registerWorkspace } from "./workspace.js";

export type { BosHost, BosActor, BosBrand, BosNotice } from "./host.js";
export type { BosConnector } from "./connectors/types.js";

export type CreateBosRouterOptions = {
  db: BosDb;
  host: BosHost;
  connectors?: ReadonlyArray<BosConnector>;
};

/**
 * Justx BOS API as a self-contained Express router.
 *
 *   app.use("/api/bos", createBosRouter({ db, host, connectors }))
 *
 * The host decides identity, permissions, audit and notifications, so the same
 * router runs inside JBT (see `hosts/jbt.ts`) or behind a standalone BOS server.
 */
export function createBosRouter({ db, host, connectors = [] }: CreateBosRouterOptions): Router {
  const deps: BosDeps = { db, host, connectors };
  const router = Router();

  router.use(async (req, res, next) => {
    try {
      const actor = await host.actor(req);
      if (!actor) {
        res.status(401).json({ error: "Sign in to use Justx BOS" });
        return;
      }
      if (host.enabled && !(await host.enabled(actor))) {
        res.status(403).json({ error: "Justx BOS isn't enabled for this organization yet. An administrator can turn it on in Admin → Tools.", code: "BOS_NOT_ENABLED" });
        return;
      }
      res.locals.bosActor = actor;
      next();
    } catch (err) {
      next(err);
    }
  });

  router.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD") {
      next();
      return;
    }
    host.requireWrite(req, res, next);
  });

  registerWorkspace(router, deps);
  registerFinance(router, deps);
  registerHr(router, deps);
  registerConnect(router, deps);

  router.use((_req, res) => {
    res.status(404).json({ error: "Unknown BOS endpoint" });
  });

  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof BosError) {
      res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
      return;
    }
    const code = (err as { code?: string }).code;
    if (code === "ER_NO_SUCH_TABLE") {
      res.status(503).json({ error: "Justx BOS is still being set up — the database migration hasn't run yet. Restart the API to apply it.", code: "BOS_SCHEMA_PENDING" });
      return;
    }
    if (code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "That record already exists" });
      return;
    }
    next(err);
  });

  return router;
}

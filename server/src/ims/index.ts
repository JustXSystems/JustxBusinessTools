import { Router, type NextFunction, type Request, type Response } from "express";
import { registerAssistant } from "./assistant.js";
import { registerAudit } from "./audit.js";
import { registerConnect } from "./connect.js";
import type { ImsDeps } from "./context.js";
import type { ImsDb } from "./db.js";
import { registerExcise } from "./excise.js";
import { registerField } from "./field.js";
import { ImsError, type ImsHost } from "./host.js";
import { registerIntegrations } from "./integrations.js";
import { registerInventory } from "./inventory.js";
import { registerLedger } from "./ledger.js";
import { registerParties } from "./parties.js";
import { registerPayables } from "./payables.js";
import { registerPurchase } from "./purchase.js";
import { registerReports } from "./reports.js";
import { registerSales } from "./sales.js";
import { registerSettings, resolveAccess } from "./settings.js";
import type { ImsCatalogSource, ImsDocumentSource } from "./sources/types.js";
import { registerSupport } from "./support.js";
import { registerWorkspace } from "./workspace.js";

export type { ImsHost, ImsActor, ImsBrand, ImsNotice } from "./host.js";
export type { ImsCatalogSource, ImsDocumentSource } from "./sources/types.js";

export type CreateImsRouterOptions = {
  db: ImsDb;
  host: ImsHost;
  /** Other tools' documents that can become IMS customers + draft sales invoices (e.g. Quotation V1). */
  sources?: ReadonlyArray<ImsDocumentSource>;
  /** Other tools' master data that can seed IMS items and parties (e.g. the BOS catalog). */
  catalogs?: ReadonlyArray<ImsCatalogSource>;
};

/**
 * Justx IMS-Dealer API as a self-contained Express router.
 *
 *   app.use("/api/ims", createImsRouter({ db, host, sources, catalogs }))
 *
 * The host decides identity, write permission, audit and notifications, so the same
 * router runs inside JBT (see `hosts/jbt.ts`) or behind a standalone IMS server.
 * IMS roles and the per-role permission matrix are IMS's own (see settings.ts).
 */
export function createImsRouter({ db, host, sources = [], catalogs = [] }: CreateImsRouterOptions): Router {
  const deps: ImsDeps = { db, host, sources, catalogs };
  const router = Router();

  router.use(async (req, res, next) => {
    try {
      const actor = await host.actor(req);
      if (!actor) {
        res.status(401).json({ error: "Sign in to use Justx IMS" });
        return;
      }
      if (host.enabled && !(await host.enabled(actor))) {
        res.status(403).json({
          error: "Justx IMS — Dealer isn't enabled for this organization yet. An administrator can turn it on in Admin → Tools.",
          code: "IMS_NOT_ENABLED",
        });
        return;
      }
      res.locals.imsActor = actor;
      res.locals.imsAccess = await resolveAccess(deps, actor);
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
  registerSettings(router, deps);
  registerInventory(router, deps);
  registerParties(router, deps);
  registerPurchase(router, deps);
  registerSales(router, deps);
  registerPayables(router, deps);
  registerLedger(router, deps);
  registerField(router, deps);
  registerReports(router, deps);
  registerIntegrations(router, deps);
  registerExcise(router, deps);
  registerAudit(router, deps);
  registerAssistant(router, deps);
  registerSupport(router, deps);
  registerConnect(router, deps);

  router.use((_req, res) => {
    res.status(404).json({ error: "Unknown IMS endpoint" });
  });

  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof ImsError) {
      res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}), ...(err.code ? { code: err.code } : {}) });
      return;
    }
    const code = (err as { code?: string }).code;
    if (code === "ER_NO_SUCH_TABLE") {
      res.status(503).json({
        error: "Justx IMS is still being set up — the database migration hasn't run yet. Restart the API to apply it.",
        code: "IMS_SCHEMA_PENDING",
      });
      return;
    }
    if (code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "That record already exists (duplicate SKU, number or code)" });
      return;
    }
    console.error("[ims] unhandled", err);
    next(err);
  });

  return router;
}

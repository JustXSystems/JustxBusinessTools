import { Router, type Request, type Response } from "express";

export type LegacyRouteConfig = {
  /** Legacy resource name shown in API responses */
  resource: string;
  /** Operator UI path users should use instead */
  migrateTo: string;
  /** Replacement REST API pattern */
  apiReplacement: string;
};

/**
 * Returns a router that responds with structured deprecation for legacy CRUD APIs.
 * Keeps routes mounted so old clients get a clear migration path instead of silent 404s.
 */
export function createLegacyApiRouter(config: LegacyRouteConfig): Router {
  const router = Router();

  const body = {
    error: "LEGACY_API_DEPRECATED",
    resource: config.resource,
    message: `The /api/${config.resource} API is deprecated. Use JBT tools instead.`,
    migrateTo: config.migrateTo,
    apiReplacement: config.apiReplacement,
  };

  function deprecate(_req: Request, res: Response) {
    res.setHeader("Deprecation", "true");
    res.setHeader("Link", `<${config.migrateTo}>; rel="successor-version"`);
    res.status(410).json(body);
  }

  router.all("/", deprecate);
  router.all("/:id", deprecate);

  return router;
}

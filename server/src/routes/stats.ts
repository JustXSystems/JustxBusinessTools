import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.setHeader("Deprecation", "true");
  res.status(410).json({
    error: "LEGACY_API_DEPRECATED",
    resource: "stats",
    message: "Legacy stats API is deprecated. Use admin analytics and tool APIs.",
    migrateTo: "/admin/analytics",
    apiReplacement: "/api/admin/analytics/summary",
  });
});

export default router;

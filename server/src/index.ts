import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import adminRouter from "./routes/admin/index.js";
import analyticsRouter from "./routes/analytics.js";
import authRouter from "./routes/auth.js";
import configRouter from "./routes/config.js";
import documentsRouter from "./routes/documents.js";
import clientsRouter from "./routes/clients.js";
import expensesRouter from "./routes/expenses.js";
import invoicesRouter from "./routes/invoices.js";
import notificationsRouter from "./routes/notifications.js";
import profileRouter from "./routes/profile.js";
import profileDriveRouter from "./routes/profile-drive.js";
import sequencesRouter from "./routes/sequences.js";
import statsRouter from "./routes/stats.js";
import subscriptionRouter from "./routes/subscription.js";
import toolsRouter from "./routes/tools.js";
import tasksRouter from "./routes/tasks.js";
import webhooksRouter from "./routes/webhooks.js";
import filesRouter from "./routes/files.js";
import quotationV1Router from "./routes/quotation-v1.js";
import publicQuotationV1Router from "./routes/public-quotation-v1.js";
import siteSurveyV1Router from "./routes/site-survey-v1.js";
import artifactsRouter from "./routes/artifacts.js";
import { requestContextMiddleware } from "./middleware/request-context.js";
import { requireBranchAccess } from "./middleware/require-write.js";
import { startAnalyticsRollupScheduler } from "./jobs/analytics-rollup.js";
import { startRenewalNoticeScheduler } from "./jobs/renewal-notices.js";
import { initSmsProvider } from "./lib/auth/init-sms.js";
import { ensureArtifactDeliverySchema } from "./lib/artifact-delivery.js";
import { startArtifactDispatchScheduler } from "./lib/artifact-dispatch.js";
import { ensureProfileDriveSchema } from "./lib/profile-drive-oauth.js";
import { ensureGstinUniqueness } from "./lib/gstin.js";
import { ensureHomeToolIdsColumn } from "./lib/home-tools.js";
import { ensurePlatformAdminSchema } from "./lib/platform-admin.js";
import { ensureNotificationSchema } from "./lib/notification-schema.js";
import { isProductionRuntime, validateServerEnv } from "./lib/env.js";
import { isUnauthenticatedApiPath } from "./lib/public-paths.js";
import { shouldRunBackgroundJobsInApi } from "./lib/process-role.js";
import { pool } from "./db.js";

try {
  validateServerEnv();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

initSmsProvider();
void Promise.all([
  ensureGstinUniqueness(),
  ensurePlatformAdminSchema(),
  ensureHomeToolIdsColumn(),
  ensureNotificationSchema(),
  ensureArtifactDeliverySchema(),
  ensureProfileDriveSchema(),
]).catch((err) => {
  console.warn("Startup schema setup failed", err);
});
const app = express();
const port = Number(process.env.PORT ?? 4000);

const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "30mb" }));
app.use((_req, res, next) => {
  // Entitlements / billing / auth must not be served from intermediary HTTP caches.
  if (!_req.path.startsWith("/api/files")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
  }
  next();
});
app.use(requestContextMiddleware);

app.use((req, res, next) => {
  if (isUnauthenticatedApiPath(req.path)) {
    next();
    return;
  }
  requireBranchAccess(req, res, next);
});

app.get("/api/health", async (_req, res) => {
  let db: "ok" | "error" = "ok";
  try {
    await pool.query("SELECT 1");
  } catch {
    db = "error";
  }
  const ok = db === "ok";
  res.status(ok ? 200 : 503).json({
    ok,
    service: "justx-api",
    db,
  });
});

app.use("/api/auth", authRouter);
app.use("/api/files", filesRouter);
app.use("/api/admin", adminRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/config", configRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/expenses", expensesRouter);
app.use("/api/profile", profileRouter);
app.use("/api/profile/drive", profileDriveRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/sequences", sequencesRouter);
app.use("/api/tools", toolsRouter);
app.use("/api/stats", statsRouter);
app.use("/api/subscription", subscriptionRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/public/quotation-v1", publicQuotationV1Router);
app.use("/api/quotation-v1", quotationV1Router);
app.use("/api/site-survey-v1", siteSurveyV1Router);
app.use("/api/artifacts", artifactsRouter);

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    const message = isProductionRuntime()
      ? "Server error"
      : err.message || "Server error";
    res.status(500).json({ error: message });
  },
);

app.listen(port, () => {
  console.log(`JustXSystems API running on http://localhost:${port}`);
  if (shouldRunBackgroundJobsInApi()) {
    startArtifactDispatchScheduler();
    startAnalyticsRollupScheduler();
    startRenewalNoticeScheduler();
  } else {
    console.log("[jobs] background schedulers deferred to justx-jbt-worker");
  }
});

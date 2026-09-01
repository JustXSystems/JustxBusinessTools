import "dotenv/config";
import { startAnalyticsRollupScheduler } from "./jobs/analytics-rollup.js";
import { startRenewalNoticeScheduler } from "./jobs/renewal-notices.js";
import { ensureArtifactDeliverySchema } from "./lib/artifact-delivery.js";
import { startArtifactDispatchScheduler } from "./lib/artifact-dispatch.js";
import { ensureNotificationSchema } from "./lib/notification-schema.js";
import { ensureProfileDriveSchema } from "./lib/profile-drive-oauth.js";
import { getProcessRole, shouldRunBackgroundJobsInWorker } from "./lib/process-role.js";
import { validateServerEnv } from "./lib/env.js";

try {
  validateServerEnv();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const role = getProcessRole();
if (role !== "worker" && role !== "all") {
  console.error(
    `justx-jbt-worker requires JBT_PROCESS_ROLE=worker (or all); got "${role}"`,
  );
  process.exit(1);
}

if (!shouldRunBackgroundJobsInWorker()) {
  console.error("Worker started but background jobs are disabled for this role");
  process.exit(1);
}

void Promise.all([
  ensureArtifactDeliverySchema(),
  ensureNotificationSchema(),
  ensureProfileDriveSchema(),
]).catch((err) => {
  console.warn("[worker] schema setup failed", err);
});

console.log(`[worker] JustX JBT background worker starting (role=${role})`);
startArtifactDispatchScheduler();
startAnalyticsRollupScheduler();
startRenewalNoticeScheduler();

// Keep process alive; schedulers use setInterval.
setInterval(() => {}, 60_000).unref?.();

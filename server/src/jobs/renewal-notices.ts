import {
  runRenewalNoticeJob,
  markDueNoticesSent,
  runExpiredSubscriptionJob,
} from "../lib/subscriptions/renewal-notices.js";

export async function runRenewalNoticesTick(): Promise<void> {
  const withinDays = Number(process.env.RENEWAL_NOTICE_WITHIN_DAYS ?? 14);
  const result = await runRenewalNoticeJob(withinDays);
  const expired = await runExpiredSubscriptionJob();
  const autoSent = await markDueNoticesSent();
  console.log(
    `[renewals] scanned=${result.scanned} created=${result.created} skipped=${result.skipped} expired=${expired.created} autoSent=${autoSent}`,
  );
}

export function startRenewalNoticeScheduler(): void {
  const hours = Number(process.env.RENEWAL_NOTICE_INTERVAL_HOURS ?? 24);
  if (!hours || hours <= 0) {
    console.log("[renewals] scheduler disabled (set RENEWAL_NOTICE_INTERVAL_HOURS>0 to enable)");
    return;
  }

  const ms = hours * 3600000;
  const tick = () => {
    runRenewalNoticesTick().catch((err) => console.error("[renewals] scheduler failed", err));
  };

  console.log(`[renewals] notice scheduler every ${hours}h (window ${process.env.RENEWAL_NOTICE_WITHIN_DAYS ?? 14}d)`);
  setInterval(tick, ms);
  setTimeout(tick, 20000);
}

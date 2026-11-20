import { pool } from "../db.js";
import type { ImsDeps } from "../ims/context.js";
import { jbtImsHost } from "../ims/hosts/jbt.js";
import { runDueTallySyncs } from "../ims/integrations.js";

function imsDeps(): ImsDeps {
  return { db: pool, host: jbtImsHost, sources: [], catalogs: [] };
}

export async function runTallySyncTick(): Promise<void> {
  const result = await runDueTallySyncs(imsDeps());
  const ok = result.results.filter((r) => r.status === "success").length;
  const partial = result.results.filter((r) => r.status === "partial").length;
  const failed = result.results.filter((r) => r.status === "failed").length;
  console.log(
    `[tally-sync] scanned=${result.scanned} ran=${result.ran} success=${ok} partial=${partial} failed=${failed}`,
  );
}

/**
 * Polls due Tally integrations on an interval.
 * Disabled unless `TALLY_SYNC_INTERVAL_MINUTES` is a positive number (page-open autosync still works).
 * Useful when the API/worker can reach each tenant's Tally XML host (LAN or cloud Tally).
 */
export function startTallySyncScheduler(): void {
  const minutes = Number(process.env.TALLY_SYNC_INTERVAL_MINUTES ?? 0);
  if (!minutes || minutes <= 0) {
    console.log("[tally-sync] scheduler disabled (set TALLY_SYNC_INTERVAL_MINUTES>0 to enable)");
    return;
  }

  const ms = Math.max(1, minutes) * 60_000;
  const tick = () => {
    runTallySyncTick().catch((err) => console.error("[tally-sync] scheduler failed", err));
  };

  console.log(`[tally-sync] scheduler every ${minutes}m`);
  setInterval(tick, ms);
  setTimeout(tick, 45_000);
}

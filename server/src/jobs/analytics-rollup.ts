import { pool } from "../db.js";
import { rollupUsageForDate } from "../lib/analytics/events.js";

async function rollupAllProfilesForDate(date: string): Promise<number> {
  const [rows] = await pool.query(`SELECT id FROM business_profiles ORDER BY id`);
  const profiles = (Array.isArray(rows) ? rows : []).map((r) =>
    Number((r as { id: number }).id),
  );
  for (const profileId of profiles) {
    await rollupUsageForDate(date, profileId);
  }
  return profiles.length;
}

export async function runDailyAnalyticsRollup(): Promise<{ profiles: number; dates: string[] }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dates: string[] = [];

  // Today + yesterday (late events)
  for (let d = 0; d < 2; d++) {
    const date = new Date(today.getTime() - d * 86400000);
    dates.push(date.toISOString().slice(0, 10));
  }

  let profiles = 0;
  for (const date of dates) {
    profiles = await rollupAllProfilesForDate(date);
  }

  return { profiles, dates };
}

export function startAnalyticsRollupScheduler(): void {
  const hours = Number(process.env.ANALYTICS_ROLLUP_INTERVAL_HOURS ?? 0);
  if (!hours || hours <= 0) return;

  const ms = hours * 3600000;
  const tick = () => {
    runDailyAnalyticsRollup()
      .then((r) => {
        console.log(
          `[analytics] rollup scheduler: ${r.profiles} profiles, dates ${r.dates.join(", ")}`,
        );
      })
      .catch((err) => console.error("[analytics] rollup scheduler failed", err));
  };

  console.log(`[analytics] rollup scheduler every ${hours}h`);
  setInterval(tick, ms);
  // Stagger first run so server startup isn't blocked
  setTimeout(tick, 15000);
}

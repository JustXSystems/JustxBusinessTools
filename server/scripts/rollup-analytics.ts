import "dotenv/config";
import { pool } from "../src/db.js";
import { rollupUsageForDate } from "../src/lib/analytics/events.js";

async function main() {
  const days = Number(process.argv[2] ?? 30);
  const profileIdArg = process.argv[3] ? Number(process.argv[3]) : null;

  let profiles: Array<{ id: number }>;
  if (profileIdArg) {
    profiles = [{ id: profileIdArg }];
  } else {
    const [rows] = await pool.query(`SELECT id FROM business_profiles ORDER BY id`);
    profiles = (Array.isArray(rows) ? rows : []).map((r) => ({
      id: Number((r as { id: number }).id),
    }));
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const profile of profiles) {
    for (let d = 0; d < days; d++) {
      const date = new Date(today.getTime() - d * 86400000);
      const dateStr = date.toISOString().slice(0, 10);
      await rollupUsageForDate(dateStr, profile.id);
    }
    console.log(`Rollup complete: profile ${profile.id}, ${days} days`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

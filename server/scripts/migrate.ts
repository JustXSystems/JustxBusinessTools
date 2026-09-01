import "dotenv/config";
import { runPendingMigrations } from "../src/lib/migrations.js";

runPendingMigrations()
  .then((r) => {
    console.log(`Migrations done. applied=${r.applied.length} skipped=${r.skipped.length}`);
    if (r.applied.length) console.log("Applied:", r.applied.join(", "));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

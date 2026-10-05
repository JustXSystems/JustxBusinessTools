import "dotenv/config";
import { listPendingMigrations, runPendingMigrations } from "../src/lib/migrations.js";

/**
 * `--pending` lists what would run without applying it. Deploy scripts parse the `PENDING_MIGRATIONS=<n>` line;
 * a non-zero exit means the database couldn't be checked.
 */
if (process.argv.includes("--pending")) {
  listPendingMigrations()
    .then((pending) => {
      for (const id of pending) console.log(`pending: ${id}`);
      console.log(`PENDING_MIGRATIONS=${pending.length}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
} else {
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
}

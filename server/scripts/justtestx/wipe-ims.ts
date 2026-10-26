/**
 * Wipe JustTestX IMS data (profile kept).
 *   JUSTTESTX_CONFIRM=YES npm run db:wipe:justtestx:ims -w server
 */
import "dotenv/config";
import { pool } from "../../src/db.js";
import { COMPANY, findJustTestXProfile, requireConfirm, wipeImsTenant, withTx } from "./lib.js";

async function main() {
  requireConfirm("wipe JustTestX IMS data");
  const found = await findJustTestXProfile();
  if (!found) {
    console.log(`No business profile named "${COMPANY}" found.`);
    await pool.end();
    return;
  }
  const n = await withTx((conn) => wipeImsTenant(conn, found.profileId));
  console.log(`Deleted ${n} IMS row(s) for ${COMPANY} (profileId=${found.profileId}).`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});

/**
 * Turn Justx IMS — Dealer Live for JustTestX (no data wipe).
 *
 *   JUSTTESTX_CONFIRM=YES npm run db:enable:justtestx:ims -w server
 */
import "dotenv/config";
import { pool } from "../../src/db.js";
import { COMPANY, enableImsDealer, findJustTestXProfile, q, requireConfirm, withTx } from "./lib.js";
import { OWNER_NAME } from "./ims-scenario.js";

async function main() {
  requireConfirm("enable Justx IMS — Dealer (Live) for JustTestX");

  const found = await findJustTestXProfile();
  if (!found) {
    console.error(`Business profile "${COMPANY}" not found. Seed BOS/IMS first.`);
    await pool.end();
    process.exit(1);
  }

  const owner = await q(
    pool,
    `SELECT u.id FROM users u
     JOIN org_members m ON m.user_id = u.id
     WHERE m.organization_id = :orgId AND m.role = 'owner'
     ORDER BY u.id LIMIT 1`,
    { orgId: found.orgId },
  );
  const userId = Number(owner[0]?.id ?? 0);
  if (!userId) {
    console.error("No owner user on JustTestX org");
    await pool.end();
    process.exit(1);
  }

  await withTx(async (conn) => {
    await enableImsDealer(conn, found.orgId, found.profileId, userId, OWNER_NAME);
  });

  const rows = await q(
    pool,
    `SELECT available FROM tool_catalog WHERE organization_id = :o AND tool_id = 'imsdealer'`,
    { o: found.orgId },
  );
  console.log(`JustTestX IMS enabled (Live). org=${found.orgId} profile=${found.profileId} available=${rows[0]?.available}`);
  console.log("\n1. Switch active branch to JustTestX (required — other branches keep IMS hidden)");
  console.log("2. Soft-refresh the app");
  console.log("3. Open /tools/imsdealer");

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});

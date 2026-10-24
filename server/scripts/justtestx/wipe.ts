/**
 * Wipe JustTestX BOS data (and optionally archive / hard-delete the profile).
 *
 *   JUSTTESTX_CONFIRM=YES npm run db:wipe:justtestx -w server
 *   JUSTTESTX_CONFIRM=YES npm run db:wipe:justtestx -w server -- --archive
 *   JUSTTESTX_CONFIRM=YES npm run db:wipe:justtestx -w server -- --hard
 */
import "dotenv/config";
import { pool } from "../../src/db.js";
import {
  COMPANY,
  exec,
  findJustTestXProfile,
  parseArgs,
  q,
  requireConfirm,
  wipeBosTenant,
  withTx,
} from "./lib.js";

async function main() {
  const args = parseArgs();
  const hard = Boolean(args.hard);
  const archive = Boolean(args.archive) || hard;
  requireConfirm(hard ? "HARD-DELETE JustTestX" : archive ? "wipe BOS + archive JustTestX" : "wipe JustTestX BOS data");

  const found = await findJustTestXProfile();
  if (!found) {
    console.log(`No business profile named "${COMPANY}" found. Nothing to wipe.`);
    await pool.end();
    return;
  }

  const { profileId, orgId } = found;
  console.log(`Found ${COMPANY}: profileId=${profileId}, orgId=${orgId}`);

  await withTx(async (conn) => {
    const bosRows = await wipeBosTenant(conn, profileId);
    console.log(`Deleted ${bosRows} BOS row(s) for tenant_id=${profileId}`);

    if (archive && !hard) {
      await exec(
        conn,
        `INSERT INTO business_profile_meta (business_profile_id, approval_status, archived_at)
         VALUES (:id, 'archived', CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE approval_status = 'archived', archived_at = CURRENT_TIMESTAMP`,
        { id: profileId },
      );
      console.log(`Archived business profile ${profileId}`);
    }

    if (hard) {
      await exec(conn, `DELETE FROM sessions WHERE business_profile_id = :id`, { id: profileId });
      await exec(conn, `DELETE FROM business_profiles WHERE id = :id`, { id: profileId });
      console.log(`Hard-deleted business_profiles.id=${profileId} (cascades profile-scoped JBT rows)`);

      const remaining = await q(conn, `SELECT COUNT(*) AS n FROM business_profiles WHERE organization_id = :orgId`, { orgId });
      if (Number(remaining[0]?.n ?? 0) === 0) {
        await exec(conn, `DELETE FROM org_feature_switches WHERE organization_id = :orgId`, { orgId });
        await exec(conn, `DELETE FROM tool_catalog WHERE organization_id = :orgId`, { orgId });
        await exec(conn, `DELETE FROM org_subscriptions WHERE organization_id = :orgId`, { orgId });
        await exec(conn, `DELETE FROM org_members WHERE organization_id = :orgId`, { orgId });
        await exec(conn, `DELETE FROM organizations WHERE id = :orgId`, { orgId });
        console.log(`Removed empty organization ${orgId}`);
      } else {
        console.log(`Organization ${orgId} still has other branches — left intact`);
      }
    }
  });

  console.log("Wipe complete.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});

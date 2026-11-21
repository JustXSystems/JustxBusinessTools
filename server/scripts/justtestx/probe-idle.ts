import "dotenv/config";
import { pool } from "../../src/db.js";

async function main() {
  const [users] = await pool.query(
    `SELECT u.id, u.email FROM users u
     JOIN org_members m ON m.user_id = u.id
     JOIN business_profiles bp ON bp.organization_id = m.organization_id
     WHERE bp.business_name = 'JustTestX'`,
  );
  console.log("users", users);

  const [idle] = await pool.query(
    `SELECT name, sku, current_stock, last_movement_at,
            DATEDIFF('2026-11-21', last_movement_at) AS idle
     FROM ims_items WHERE tenant_id = 3 AND active = 1
     ORDER BY last_movement_at ASC LIMIT 15`,
  );
  console.log("idle", idle);
  await pool.end();
}
main();

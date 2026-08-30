import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "../src/db.js";

async function main() {
  const email = "admin@justx.local";
  const password = "admin123";
  const hash = await bcrypt.hash(password, 10);

  try {
    await pool.query(
      `ALTER TABLE users ADD COLUMN is_platform_admin TINYINT(1) NOT NULL DEFAULT 0`,
    );
  } catch (err) {
    const e = err as { errno?: number };
    if (e.errno !== 1060) throw err;
  }

  await pool.query(
    `INSERT INTO organizations (id, name, plan_id, status)
     SELECT 1, 'Default Organization', 'free', 'active'
     FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE id = 1)`,
  );

  await pool.query(
    `UPDATE business_profiles SET organization_id = 1, is_default = 1 WHERE id = 1`,
  );

  const [existing] = await pool.query(`SELECT id FROM users WHERE email = :email`, { email });
  let userId: number;

  if (Array.isArray(existing) && existing[0]) {
    userId = Number((existing[0] as { id: number }).id);
  await pool.query(
    `UPDATE users SET password_hash = :hash, is_platform_admin = 1, name = 'JBT Admin', status = 'active' WHERE id = :id`,
    { hash, id: userId },
  );
  } else {
    const [result] = await pool.query(
      `INSERT INTO users (email, password_hash, name, status, is_platform_admin) VALUES (:email, :hash, 'JBT Admin', 'active', 1)`,
      { email, hash },
    );
    userId = Number((result as { insertId: number }).insertId);
  }

  await pool.query(
    `INSERT INTO org_members (organization_id, user_id, role)
     VALUES (1, :userId, 'owner')
     ON DUPLICATE KEY UPDATE role = 'owner'`,
    { userId },
  );

  await pool.query(
    `UPDATE organizations SET owner_user_id = :userId WHERE id = 1`,
    { userId },
  );

  await pool.query(
    `INSERT INTO org_subscriptions (organization_id, plan_id, status)
     SELECT 1, 'free', 'active' FROM DUAL
     WHERE NOT EXISTS (SELECT 1 FROM org_subscriptions WHERE organization_id = 1)`,
  );

  console.log(`Admin seeded: ${email} / ${password}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

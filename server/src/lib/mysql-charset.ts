import { pool } from "../db.js";

/** Match mysql/*.sql schemas — MySQL 8 default without COLLATE is utf8mb4_0900_ai_ci. */
export const INNODB_UTF8MB4_UNICODE =
  "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

const TARGET = "utf8mb4_unicode_ci";

/**
 * Convert tables created with MySQL 8's default collation so joins to
 * utf8mb4_unicode_ci schemas (tool_skus, etc.) do not raise ER_CANT_AGGREGATE_2COLLATIONS.
 */
export async function ensureTablesUtf8mb4UnicodeCi(tables: string[]): Promise<void> {
  for (const table of tables) {
    if (!/^[a-z0-9_]+$/i.test(table)) continue;
    try {
      const [rows] = await pool.query(
        `SELECT TABLE_COLLATION AS coll
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table
         LIMIT 1`,
        { table },
      );
      const coll = Array.isArray(rows)
        ? String((rows[0] as { coll?: string } | undefined)?.coll ?? "")
        : "";
      if (!coll || coll === TARGET) continue;
      await pool.query(
        `ALTER TABLE \`${table}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
      console.log(`[mysql] converted ${table} collation ${coll} → ${TARGET}`);
    } catch (err) {
      console.warn(`[mysql] collation fix skipped for ${table}:`, err);
    }
  }
}

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Resolve mysql/migrations relative to monorepo root (server/src/lib → ../../../mysql/migrations). */
export function migrationsDir(): string {
  if (process.env.MYSQL_MIGRATIONS_DIR?.trim()) {
    return path.resolve(process.env.MYSQL_MIGRATIONS_DIR.trim());
  }
  return path.resolve(here, "../../../mysql/migrations");
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(128) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*[\r\n]+/)
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !/^\s*--/.test(line))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

export async function runPendingMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  await ensureMigrationsTable();
  const dir = migrationsDir();
  let files: string[] = [];
  try {
    files = (await readdir(dir))
      .filter((f) => /^\d{3,}_.+\.sql$/i.test(f))
      .sort((a, b) => a.localeCompare(b));
  } catch (err) {
    console.warn("[migrations] directory missing:", dir, err instanceof Error ? err.message : err);
    return { applied: [], skipped: [] };
  }

  const [rows] = await pool.query(`SELECT id FROM schema_migrations`);
  const done = new Set(
    (Array.isArray(rows) ? rows : []).map((r) => String((r as { id: string }).id)),
  );

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const id = file.replace(/\.sql$/i, "");
    if (done.has(id)) {
      skipped.push(id);
      continue;
    }
    const full = path.join(dir, file);
    const raw = await readFile(full, "utf8");
    const statements = splitSqlStatements(raw);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const stmt of statements) {
        try {
          await conn.query(stmt);
        } catch (err) {
          const code = (err as { code?: string }).code;
          // Idempotent DDL: duplicate key/index/column is OK when re-applying repaired files.
          if (
            code === "ER_DUP_KEYNAME" ||
            code === "ER_DUP_FIELDNAME" ||
            code === "ER_TABLE_EXISTS_ERROR" ||
            code === "ER_DUP_ENTRY"
          ) {
            continue;
          }
          throw err;
        }
      }
      await conn.query(`INSERT INTO schema_migrations (id) VALUES (:id)`, { id });
      await conn.commit();
      applied.push(id);
      console.log(`[migrations] applied ${id}`);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  return { applied, skipped };
}

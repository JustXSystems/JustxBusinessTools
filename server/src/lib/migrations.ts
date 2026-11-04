import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

function migrationId(file: string): string {
  return file.replace(/\.(sql|mjs)$/i, "");
}

async function migrationFiles(dir: string): Promise<string[] | null> {
  try {
    return (await readdir(dir))
      .filter((f) => /^\d{3,}_.+\.(sql|mjs)$/i.test(f))
      .sort((a, b) => a.localeCompare(b));
  } catch (err) {
    console.warn("[migrations] directory missing:", dir, err instanceof Error ? err.message : err);
    return null;
  }
}

async function appliedIds(): Promise<Set<string>> {
  const [rows] = await pool.query(`SELECT id FROM schema_migrations`);
  return new Set((Array.isArray(rows) ? rows : []).map((r) => String((r as { id: string }).id)));
}

/** Migrations that would run next, without applying anything (used by deploys to decide on a backup). */
export async function listPendingMigrations(): Promise<string[]> {
  const files = await migrationFiles(migrationsDir());
  if (!files) return [];
  let done = new Set<string>();
  try {
    done = await appliedIds();
  } catch (err) {
    if ((err as { code?: string }).code !== "ER_NO_SUCH_TABLE") throw err;
  }
  return files.map(migrationId).filter((id) => !done.has(id));
}

export async function runPendingMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  await ensureMigrationsTable();
  const dir = migrationsDir();
  const files = await migrationFiles(dir);
  if (!files) return { applied: [], skipped: [] };

  const done = await appliedIds();

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const id = migrationId(file);
    if (done.has(id)) {
      skipped.push(id);
      continue;
    }
    const full = path.join(dir, file);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (/\.mjs$/i.test(file)) {
        const mod = (await import(pathToFileURL(full).href)) as {
          default?: (c: typeof conn) => Promise<void>;
        };
        if (typeof mod.default !== "function") {
          throw new Error(`Migration ${file} must export default async function(conn)`);
        }
        await mod.default(conn);
      } else {
        const raw = await readFile(full, "utf8");
        const statements = splitSqlStatements(raw);
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

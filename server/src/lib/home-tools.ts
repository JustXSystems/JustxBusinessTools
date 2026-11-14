import { pool } from "../db.js";

let ready: Promise<void> | null = null;

export async function ensureHomeToolIdsColumn(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      try {
        await pool.query(
          `ALTER TABLE business_profiles ADD COLUMN home_tool_ids JSON NULL`,
        );
      } catch (err) {
        const e = err as { code?: string; errno?: number };
        if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060) throw err;
      }
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  await ready;
}

export function parseHomeToolIds(raw: unknown): string[] | null {
  if (raw == null) return null;
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  const ids = value.map((v) => String(v).trim()).filter(Boolean);
  return [...new Set(ids)];
}

export function normalizeHomeToolIdsInput(input: unknown): string[] | null {
  if (input === undefined) return null;
  if (input === null) return null;
  if (!Array.isArray(input)) return null;
  const ids = input.map((v) => String(v).trim()).filter(Boolean);
  return [...new Set(ids)];
}

/**
 * When admin marks a tool Live, add it to every branch home allowlist in the org
 * (profiles with home_tool_ids = NULL already show all tools).
 */
export async function appendToolToOrgHomeSelections(
  orgId: number,
  toolId: string,
): Promise<number> {
  await ensureHomeToolIdsColumn();
  const id = String(toolId || "").trim();
  if (!id) return 0;

  const [rows] = await pool.query(
    `SELECT id, home_tool_ids FROM business_profiles WHERE organization_id = :orgId`,
    { orgId },
  );
  let updated = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const r = row as { id: number; home_tool_ids: unknown };
    const current = parseHomeToolIds(r.home_tool_ids);
    if (current == null) continue; // null = show all
    if (current.includes(id)) continue;
    const next = [...current, id];
    await pool.query(`UPDATE business_profiles SET home_tool_ids = :ids WHERE id = :id`, {
      id: r.id,
      ids: JSON.stringify(next),
    });
    updated += 1;
  }
  return updated;
}

export type OrgCatalogTool = {
  id: string;
  groupName: string;
  sortOrder: number;
  available: boolean;
  /** When true, home opens the full-screen app (`/bos`, `/ims`) in a new window. */
  openStandalone: boolean;
};

const STANDALONE_DEFAULT_TOOLS = new Set(["bos", "imsdealer"]);

let openStandaloneReady: Promise<void> | null = null;

/** Migration 048 — safe to call before the column exists. */
export async function ensureOpenStandaloneColumn(): Promise<void> {
  if (!openStandaloneReady) {
    openStandaloneReady = (async () => {
      try {
        await pool.query(
          `ALTER TABLE tool_catalog ADD COLUMN open_standalone TINYINT(1) NOT NULL DEFAULT 0 AFTER available`,
        );
        await pool.query(
          `UPDATE tool_catalog SET open_standalone = 1 WHERE tool_id IN ('bos', 'imsdealer')`,
        );
      } catch (err) {
        const e = err as { code?: string; errno?: number };
        if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060) throw err;
      }
    })().catch((err) => {
      openStandaloneReady = null;
      throw err;
    });
  }
  await openStandaloneReady;
}

export async function listOrgCatalog(orgId: number): Promise<OrgCatalogTool[]> {
  await ensureOpenStandaloneColumn();
  const [rows] = await pool.query(
    `SELECT tool_id, group_name, sort_order, available, open_standalone
     FROM tool_catalog WHERE organization_id = :orgId
     ORDER BY sort_order, tool_id`,
    { orgId },
  );
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, unknown>;
    const id = String(r.tool_id);
    const raw = r.open_standalone;
    const openStandalone =
      raw == null ? STANDALONE_DEFAULT_TOOLS.has(id) : Boolean(Number(raw));
    return {
      id,
      groupName: String(r.group_name ?? "General"),
      sortOrder: Number(r.sort_order ?? 0),
      available: Boolean(r.available),
      openStandalone,
    };
  });
}

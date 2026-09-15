import { pool } from "../../db.js";
import { jsonVal } from "../admin/approvals.js";

export type RoleKey = "owner" | "admin" | "staff" | "viewer";

export type RoleCapability =
  | "adminConsole"
  | "billing"
  | "writeRecords"
  | "exportData"
  | "approveUsers"
  | "manageBranches"
  | "manageTools";

export type RoleMatrix = Record<RoleKey, Record<RoleCapability, boolean>>;

export const ROLE_CAPABILITY_LABELS: Record<RoleCapability, string> = {
  adminConsole: "Platform / org admin console",
  billing: "Billing & subscriptions",
  writeRecords: "Create & edit records",
  exportData: "Export / download",
  approveUsers: "Approve team members",
  manageBranches: "Manage GST branches",
  manageTools: "Assign tool licenses",
};

export const DEFAULT_ROLE_MATRIX: RoleMatrix = {
  owner: {
    // Owner manages the Business Profile in the operator app — not /admin.
    adminConsole: false,
    billing: true,
    writeRecords: true,
    exportData: true,
    approveUsers: true,
    manageBranches: true,
    manageTools: true,
  },
  admin: {
    // Only Admin role opens /admin with full console access.
    adminConsole: true,
    billing: true,
    writeRecords: true,
    exportData: true,
    approveUsers: true,
    manageBranches: true,
    manageTools: true,
  },
  staff: {
    adminConsole: false,
    billing: false,
    writeRecords: true,
    exportData: true,
    approveUsers: false,
    manageBranches: false,
    manageTools: false,
  },
  viewer: {
    adminConsole: false,
    billing: false,
    // Viewer may use My Tools (quotations / surveys); menu ACL hides other areas.
    writeRecords: true,
    exportData: true,
    approveUsers: false,
    manageBranches: false,
    manageTools: false,
  },
};

const CONFIG_KEY = "role_permissions";

function normalizeMatrix(raw: unknown): RoleMatrix {
  const base = structuredClone(DEFAULT_ROLE_MATRIX);
  if (!raw || typeof raw !== "object") return enforceRoleHierarchyRules(base);
  const obj = raw as Record<string, unknown>;
  for (const role of Object.keys(base) as RoleKey[]) {
    const row = obj[role];
    if (!row || typeof row !== "object") continue;
    const caps = row as Record<string, unknown>;
    for (const cap of Object.keys(base[role]) as RoleCapability[]) {
      if (typeof caps[cap] === "boolean") base[role][cap] = caps[cap];
    }
  }
  return enforceRoleHierarchyRules(base);
}

/** Hard rules aligned with Operator / Admin Console role hierarchy. */
function enforceRoleHierarchyRules(matrix: RoleMatrix): RoleMatrix {
  matrix.owner.adminConsole = false;
  matrix.admin.adminConsole = true;
  matrix.staff.adminConsole = false;
  matrix.viewer.adminConsole = false;
  // Viewer may use My Tools (quotations / surveys); menu ACL hides other areas.
  matrix.viewer.writeRecords = true;
  matrix.viewer.exportData = true;
  return matrix;
}

export async function getRoleMatrix(): Promise<RoleMatrix> {
  const [rows] = await pool.query(
    `SELECT value FROM platform_config WHERE config_key = :key LIMIT 1`,
    { key: CONFIG_KEY },
  );
  const row = Array.isArray(rows) ? (rows[0] as { value: unknown } | undefined) : undefined;
  if (!row) return enforceRoleHierarchyRules(structuredClone(DEFAULT_ROLE_MATRIX));
  let parsed: unknown = row.value;
  if (typeof row.value === "string") {
    try {
      parsed = JSON.parse(row.value);
    } catch {
      parsed = jsonVal(row.value);
    }
  } else {
    parsed = jsonVal(row.value) ?? row.value;
  }
  return normalizeMatrix(parsed);
}

export async function saveRoleMatrix(input: unknown): Promise<RoleMatrix> {
  const matrix = enforceRoleHierarchyRules(normalizeMatrix(input));
  // Owner keeps business capabilities; adminConsole stays locked off.
  matrix.owner = {
    ...DEFAULT_ROLE_MATRIX.owner,
    ...matrix.owner,
    adminConsole: false,
  };
  matrix.admin = {
    ...matrix.admin,
    adminConsole: true,
  };
  matrix.viewer = {
    ...matrix.viewer,
    adminConsole: false,
    writeRecords: true,
    exportData: true,
  };
  await pool.query(
    `INSERT INTO platform_config (config_key, value) VALUES (:key, :value)
     ON DUPLICATE KEY UPDATE value = :value`,
    { key: CONFIG_KEY, value: JSON.stringify(matrix) },
  );
  return matrix;
}

export async function roleAllows(role: string | null | undefined, capability: RoleCapability): Promise<boolean> {
  if (!role) return true; // legacy sessions
  const key = role.toLowerCase() as RoleKey;
  const matrix = await getRoleMatrix();
  const row = matrix[key];
  if (!row) return false;
  return Boolean(row[capability]);
}

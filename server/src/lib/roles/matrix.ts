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
  adminConsole: "JBT Admin Console (/admin)",
  billing: "Billing & subscriptions",
  writeRecords: "Create & edit records",
  exportData: "Export / download",
  approveUsers: "Approve team members",
  manageBranches: "Manage Business Profiles",
  manageTools: "Assign tool licenses (platform only)",
};

export const DEFAULT_ROLE_MATRIX: RoleMatrix = {
  owner: {
    // Owner manages Business Profile in the operator app — never /admin.
    adminConsole: false,
    billing: true,
    writeRecords: true,
    exportData: true,
    approveUsers: true,
    manageBranches: true,
    manageTools: false,
  },
  admin: {
    // Org Admin: operator Business Profile like Owner — never /admin.
    // Tool licenses are Justxsystems platform super users only.
    adminConsole: false,
    billing: true,
    writeRecords: true,
    exportData: true,
    approveUsers: true,
    manageBranches: true,
    manageTools: false,
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

/** Hard rules aligned with Operator / JBT platform console hierarchy. */
function enforceRoleHierarchyRules(matrix: RoleMatrix): RoleMatrix {
  // /admin is platform-super-user only — no org role may claim adminConsole.
  matrix.owner.adminConsole = false;
  matrix.admin.adminConsole = false;
  matrix.staff.adminConsole = false;
  matrix.viewer.adminConsole = false;
  // Commercial tool licenses are assigned only in JBT Access Fabric (platform).
  matrix.owner.manageTools = false;
  matrix.admin.manageTools = false;
  matrix.staff.manageTools = false;
  matrix.viewer.manageTools = false;
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
  // Owner / org Admin keep Business Profile capabilities; /admin stays platform-only.
  matrix.owner = {
    ...DEFAULT_ROLE_MATRIX.owner,
    ...matrix.owner,
    adminConsole: false,
    manageTools: false,
  };
  matrix.admin = {
    ...DEFAULT_ROLE_MATRIX.admin,
    ...matrix.admin,
    adminConsole: false,
    manageTools: false,
  };
  matrix.viewer = {
    ...matrix.viewer,
    adminConsole: false,
    manageTools: false,
    writeRecords: true,
    exportData: true,
  };
  matrix.staff = {
    ...matrix.staff,
    adminConsole: false,
    manageTools: false,
  };
  const persisted = enforceRoleHierarchyRules(matrix);
  await pool.query(
    `INSERT INTO platform_config (config_key, value) VALUES (:key, :value)
     ON DUPLICATE KEY UPDATE value = :value`,
    { key: CONFIG_KEY, value: JSON.stringify(persisted) },
  );
  return persisted;
}

export async function roleAllows(role: string | null | undefined, capability: RoleCapability): Promise<boolean> {
  if (!role) return true; // legacy sessions
  const key = role.toLowerCase() as RoleKey;
  const matrix = await getRoleMatrix();
  const row = matrix[key];
  if (!row) return false;
  return Boolean(row[capability]);
}

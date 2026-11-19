import type { ToolLicense } from "../tool-licenses.js";
import type { ToolSku } from "../tool-skus.js";

/** Active commercial assignment for capability ceilings (not cancelled / limit-only rows). */
export function isActiveAssignment(lic: ToolLicense): boolean {
  if (lic.status !== "active") return false;
  if (!lic.periodEnd) return true;
  const end = Date.parse(lic.periodEnd);
  return !Number.isFinite(end) || end > Date.now();
}

/**
 * Tools considered assigned for Access Fabric capabilities.
 * Uses active licenses only — never cancelled entitlement / record-cap stubs.
 */
export function collectAssignedToolIds(
  licenses: ReadonlyArray<ToolLicense>,
  skus: ReadonlyArray<Pick<ToolSku, "toolId" | "name">> = [],
): { assigned: Set<string>; names: Map<string, string> } {
  const names = new Map<string, string>();
  for (const sku of skus) names.set(sku.toolId, sku.name);

  const assigned = new Set<string>();
  for (const lic of licenses) {
    if (!isActiveAssignment(lic)) continue;
    assigned.add(lic.toolId);
    if (lic.name) names.set(lic.toolId, lic.name);
  }
  return { assigned, names };
}

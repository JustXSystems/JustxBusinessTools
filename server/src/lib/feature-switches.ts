import { pool } from "../db.js";

/**
 * Per-organization feature switches. Anything that changes a screen live customers already use
 * is registered here and stays off until an admin enables it (Admin → Tools → <tool> → Switches).
 */
export const FEATURE_SWITCHES = [
  {
    key: "bos.handoff.quotationv1",
    tool: "bos",
    label: "Send to BOS from Quotation V1",
    description: "Adds a “Send to BOS” button to saved quotations that creates a draft GST invoice (and the customer) in Justx BOS.",
  },
  {
    key: "bos.handoff.sitesurveyv1",
    tool: "bos",
    label: "Send to BOS from Site Survey V1",
    description: "Adds a “Send to BOS” button to saved site surveys that opens a project lead (and the customer) in Justx BOS.",
  },
] as const;

export type FeatureSwitch = (typeof FEATURE_SWITCHES)[number];
export type FeatureSwitchKey = FeatureSwitch["key"];
export type FeatureSwitchState = Record<FeatureSwitchKey, boolean>;

export function isFeatureSwitchKey(key: string): key is FeatureSwitchKey {
  return FEATURE_SWITCHES.some((s) => s.key === key);
}

/** Every registered switch, off unless a stored row turns it on. Unknown keys are ignored. */
export function resolveFeatureSwitches(rows: ReadonlyArray<{ switch_key: string; enabled: unknown }>): FeatureSwitchState {
  const state = Object.fromEntries(FEATURE_SWITCHES.map((s) => [s.key, false])) as FeatureSwitchState;
  for (const row of rows) {
    if (isFeatureSwitchKey(row.switch_key)) state[row.switch_key] = Number(row.enabled) === 1;
  }
  return state;
}

/** Never throws: before migration 011 runs (or on any read error) every switch reads as off. */
export async function getOrgFeatureSwitches(orgId: number): Promise<FeatureSwitchState> {
  try {
    const [rows] = await pool.query(`SELECT switch_key, enabled FROM org_feature_switches WHERE organization_id = :orgId`, { orgId });
    return resolveFeatureSwitches(Array.isArray(rows) ? (rows as Array<{ switch_key: string; enabled: unknown }>) : []);
  } catch (err) {
    if ((err as { code?: string }).code !== "ER_NO_SUCH_TABLE") {
      console.warn("[feature-switches] read failed", err instanceof Error ? err.message : err);
    }
    return resolveFeatureSwitches([]);
  }
}

export async function setOrgFeatureSwitch(orgId: number, key: FeatureSwitchKey, enabled: boolean, userId: number | null): Promise<void> {
  await pool.query(
    `INSERT INTO org_feature_switches (organization_id, switch_key, enabled, updated_by)
     VALUES (:orgId, :key, :enabled, :userId)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_by = VALUES(updated_by)`,
    { orgId, key, enabled: enabled ? 1 : 0, userId },
  );
}

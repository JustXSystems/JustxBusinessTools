import { pool } from "../../db.js";
import { getActiveOrgId, getActiveProfileId } from "../request-context.js";
import { getPlatformBranding, type PlatformBranding } from "./branding.js";
import { getPoweredBy, type PoweredByConfig } from "./powered-by.js";
import { getToolGrouping, type ToolGroupingConfig } from "./tool-grouping.js";
import {
  appendToolToOrgHomeSelections,
  listOrgCatalog,
  type OrgCatalogTool,
} from "../home-tools.js";

async function ensureBuiltinCatalogRows(orgId: number): Promise<void> {
  await pool.query(
    `INSERT IGNORE INTO tool_catalog (organization_id, tool_id, group_name, sort_order, available)
     VALUES (:orgId, 'quotationv1', 'Sales & Business', 1, 1)`,
    { orgId },
  );
  await pool.query(
    `INSERT IGNORE INTO tool_catalog (organization_id, tool_id, group_name, sort_order, available)
     VALUES (:orgId, 'sitesurveyv1', 'Solar Solutions', 14, 1)`,
    { orgId },
  );
}

export async function getEffectiveConfig(): Promise<{
  poweredBy: PoweredByConfig;
  branding: PlatformBranding;
  toolGrouping: ToolGroupingConfig;
  configVersion: number;
  tools: Array<{ id: string; toolType: string; definition: Record<string, unknown> }>;
  catalog: OrgCatalogTool[];
  theme: Record<string, string> | null;
}> {
  const orgId = getActiveOrgId();
  const profileId = getActiveProfileId();

  const [poweredBy, branding, toolGrouping] = await Promise.all([
    getPoweredBy(),
    getPlatformBranding(),
    getToolGrouping(),
  ]);

  const [profileRows] = await pool.query(
    `SELECT config_version FROM business_profiles WHERE id = :id`,
    { id: profileId },
  );
  const profile = Array.isArray(profileRows) ? profileRows[0] : null;
  const configVersion = Number((profile as { config_version?: number } | null)?.config_version) || 1;

  await ensureBuiltinCatalogRows(orgId);
  const [tools, catalog] = await Promise.all([listToolDefinitions(), listOrgCatalog(orgId)]);

  // Opt Live V1 tools into branch home allowlists that were frozen before these tools existed.
  for (const row of catalog) {
    if (row.available && (row.id === "sitesurveyv1" || row.id === "quotationv1")) {
      await appendToolToOrgHomeSelections(orgId, row.id);
    }
  }

  const [themeRows] = await pool.query(
    `SELECT tokens FROM org_themes WHERE organization_id = :orgId AND is_active = 1 LIMIT 1`,
    { orgId },
  );
  const themeRow = Array.isArray(themeRows) ? themeRows[0] : null;
  let theme: Record<string, string> | null = null;
  if (themeRow) {
    const raw = (themeRow as { tokens: string | Record<string, unknown> }).tokens;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    theme = parsed as Record<string, string>;
  }

  return { poweredBy, branding, toolGrouping, configVersion, tools, catalog, theme };
}

export async function listToolDefinitions(): Promise<
  Array<{ id: string; toolType: string; definition: Record<string, unknown> }>
> {
  const orgId = getActiveOrgId();

  const [rows] = await pool.query(
    `SELECT id, tool_type, definition, published_version, organization_id
     FROM tool_definitions
     WHERE organization_id IS NULL OR organization_id = :orgId
     ORDER BY id, organization_id IS NULL DESC, published_version`,
    { orgId },
  );

  const byId = new Map<string, { id: string; toolType: string; definition: Record<string, unknown> }>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const r = row as {
      id: string;
      tool_type: string;
      definition: string | Record<string, unknown>;
      published_version?: number;
    };
    const definition =
      typeof r.definition === "string"
        ? (JSON.parse(r.definition) as Record<string, unknown>)
        : r.definition;
    byId.set(r.id, { id: r.id, toolType: r.tool_type, definition });
  }
  return [...byId.values()];
}

export async function publishToolDefinition(
  toolId: string,
  definition: Record<string, unknown>,
): Promise<{ id: string; publishedVersion: number }> {
  const orgId = getActiveOrgId();
  const profileId = getActiveProfileId();
  const toolType = String(definition.type ?? "tracker");

  const [existing] = await pool.query(
    `SELECT published_version FROM tool_definitions WHERE id = :id AND (organization_id IS NULL OR organization_id = :orgId)`,
    { id: toolId, orgId },
  );
  const prev = Array.isArray(existing) ? existing[0] : null;
  const version = Number((prev as { published_version?: number } | null)?.published_version ?? 0) + 1;

  await pool.query(
    `INSERT INTO tool_definitions (id, organization_id, tool_type, definition, published_version)
     VALUES (:id, :orgId, :toolType, :definition, :version)
     ON DUPLICATE KEY UPDATE
       tool_type = :toolType,
       definition = :definition,
       published_version = :version`,
    {
      id: toolId,
      orgId,
      toolType,
      definition: JSON.stringify(definition),
      version,
    },
  );

  await pool.query(
    `INSERT INTO config_revisions (organization_id, business_profile_id, scope, version, payload)
     VALUES (:orgId, :profileId, :scope, :version, :payload)`,
    {
      orgId,
      profileId,
      scope: `tool:${toolId}`,
      version,
      payload: JSON.stringify(definition),
    },
  );

  await pool.query(`UPDATE business_profiles SET config_version = config_version + 1 WHERE id = :id`, {
    id: profileId,
  });

  return { id: toolId, publishedVersion: version };
}

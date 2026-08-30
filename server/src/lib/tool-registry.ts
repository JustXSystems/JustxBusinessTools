import { pool } from "../db.js";
import { BUILTIN_TRACKER_FIELDS } from "@jbt/shared";
import { DOCUMENT_TOOL_IDS, TRACKER_TOOL_IDS } from "./constants.js";
import { getActiveOrgId } from "./request-context.js";

export type ToolDefinitionRow = {
  id: string;
  tool_type: string;
  definition: string | Record<string, unknown>;
};

function parseDefinition(raw: ToolDefinitionRow["definition"]): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw ?? {};
}

export async function fetchToolDefinitionRow(toolId: string): Promise<ToolDefinitionRow | null> {
  const orgId = getActiveOrgId();
  const [rows] = await pool.query(
    `SELECT id, tool_type, definition FROM tool_definitions
     WHERE id = :id AND (organization_id IS NULL OR organization_id = :orgId)
     LIMIT 1`,
    { id: toolId, orgId },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? (row as ToolDefinitionRow) : null;
}

export async function isAllowedTrackerTool(toolId: string): Promise<boolean> {
  if ((TRACKER_TOOL_IDS as readonly string[]).includes(toolId)) return true;
  const row = await fetchToolDefinitionRow(toolId);
  return row?.tool_type === "tracker";
}

export async function isAllowedDocumentTool(toolId: string): Promise<boolean> {
  if ((DOCUMENT_TOOL_IDS as readonly string[]).includes(toolId)) return true;
  const row = await fetchToolDefinitionRow(toolId);
  return row?.tool_type === "document";
}

export async function resolveTrackerFields(
  toolId: string,
): Promise<Array<{ key: string; type: string; required?: boolean; options?: string[]; formula?: string }>> {
  const row = await fetchToolDefinitionRow(toolId);
  if (row) {
    const def = parseDefinition(row.definition);
    if (Array.isArray(def.fields)) {
      return def.fields as Array<{
        key: string;
        type: string;
        required?: boolean;
        options?: string[];
        formula?: string;
      }>;
    }
  }
  return BUILTIN_TRACKER_FIELDS[toolId] ?? [];
}

export { BUILTIN_TRACKER_FIELDS };

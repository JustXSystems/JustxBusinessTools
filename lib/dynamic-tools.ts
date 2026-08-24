import type { PlatformToolDefinition } from "@/components/config/ConfigProvider";
import {
  getToolDefinition,
  TOOL_CATEGORIES,
  TRACKER_CONFIGS,
  uniqueTools,
  type ToolDefinition,
  type TrackerConfig,
  type TrackerField,
} from "@/config/tools.config";

const BUILTIN_IDS = new Set(
  Object.keys(TRACKER_CONFIGS).concat(
    [
      "quotation",
      "quotationv1",
      "sitesurveyv1",
      "salesorder",
      "invoice",
      "po",
      "gstcalc",
      "tdscalc",
      "taxcalc",
      "profitcalc",
      "emicalc",
      "loancalc",
      "solarroi",
      "dealercommission",
      "qrscanner",
      "notifications",
    ],
  ),
);

/** Build tracker config purely from admin-published definition (custom tools). */
export function buildTrackerConfigFromPlatform(
  toolId: string,
  platform: PlatformToolDefinition | undefined,
): TrackerConfig | undefined {
  if (!platform?.definition) return undefined;
  const def = platform.definition as Partial<TrackerConfig>;
  if (!Array.isArray(def.fields) || def.fields.length === 0) return undefined;

  const titleField =
    def.titleField ??
    def.fields.find((f) => f.required)?.key ??
    def.fields[0]?.key ??
    "id";

  return {
    key: toolId,
    title: String(def.title ?? platform.id),
    icon: String(def.icon ?? "📋"),
    subtitle: String(def.subtitle ?? ""),
    addLabel: String(def.addLabel ?? "+ Add Entry"),
    fields: def.fields as TrackerField[],
    titleField,
    subtitleFields: Array.isArray(def.subtitleFields) ? def.subtitleFields : [],
    metaFields: Array.isArray(def.metaFields) ? def.metaFields : [],
    statusField: def.statusField ?? null,
    statusColors: def.statusColors,
  };
}

export function resolveTrackerConfig(
  toolId: string,
  platform: PlatformToolDefinition | undefined,
): TrackerConfig | undefined {
  const base = TRACKER_CONFIGS[toolId];
  if (base && platform?.definition) {
    const def = platform.definition as Partial<TrackerConfig>;
    return {
      ...base,
      ...def,
      fields: Array.isArray(def.fields) ? def.fields : base.fields,
      metaFields: Array.isArray(def.metaFields) ? def.metaFields : base.metaFields,
      subtitleFields: Array.isArray(def.subtitleFields) ? def.subtitleFields : base.subtitleFields,
      statusColors: def.statusColors ?? base.statusColors,
    };
  }
  if (base) return base;
  return buildTrackerConfigFromPlatform(toolId, platform);
}

function platformToolType(platform: PlatformToolDefinition): ToolDefinition["type"] {
  if (platform.toolType === "tracker") return "tracker";
  if (platform.toolType === "document") return "document";
  if (platform.toolType === "calculator") return "calculator";
  return "utility";
}

/** Tool definition for admin-published tools not in static catalog. */
export function buildToolFromPlatform(platform: PlatformToolDefinition): ToolDefinition | undefined {
  if (BUILTIN_IDS.has(platform.id)) return undefined;

  const def = platform.definition;
  const type = platformToolType(platform);

  if (type === "tracker") {
    const cfg = buildTrackerConfigFromPlatform(platform.id, platform);
    if (!cfg) return undefined;
  }

  const subscriptionExempt = type === "calculator" || type === "utility";

  return {
    id: platform.id,
    name: String(def.title ?? platform.id),
    category: String(def.category ?? "Custom Tools"),
    icon: String(def.icon ?? "📋"),
    desc: String(def.subtitle ?? def.desc ?? ""),
    type,
    subscriptionExempt,
    route: `/tools/${platform.id}`,
    showOnHome: def.showOnHome !== false,
  };
}

export function resolveToolDefinition(
  toolId: string,
  platformTools: PlatformToolDefinition[],
): ToolDefinition | undefined {
  const staticDef = getToolDefinition(toolId);
  if (staticDef) return staticDef;

  const platform = platformTools.find((t) => t.id === toolId);
  if (!platform) return undefined;
  return buildToolFromPlatform(platform);
}

export function mergedHomeTools(platformTools: PlatformToolDefinition[]): ToolDefinition[] {
  const seen = new Set<string>();
  const out: ToolDefinition[] = [];

  for (const entry of uniqueTools()) {
    const def = getToolDefinition(entry.id);
    if (!def || !def.showOnHome || seen.has(def.id)) continue;
    seen.add(def.id);
    out.push(def);
  }

  for (const platform of platformTools) {
    if (seen.has(platform.id)) continue;
    const def = buildToolFromPlatform(platform);
    if (!def || !def.showOnHome) continue;
    seen.add(def.id);
    out.push(def);
  }

  return out;
}

/** Filter home tools by business-profile selection. null/undefined = show all (legacy). */
export function filterHomeToolsBySelection(
  tools: ToolDefinition[],
  homeToolIds: string[] | null | undefined,
): ToolDefinition[] {
  if (homeToolIds == null) return tools;
  const allow = new Set(homeToolIds);
  return tools.filter((t) => allow.has(t.id));
}

/** Hide tools marked unavailable in the org catalog (Admin → Tools → Placement). */
export function filterHomeToolsByCatalog(
  tools: ToolDefinition[],
  catalog: Array<{ id: string; available: boolean }> | null | undefined,
): ToolDefinition[] {
  if (!catalog?.length) return tools;
  const byId = new Map(catalog.map((c) => [c.id, c]));
  return tools.filter((t) => {
    const row = byId.get(t.id);
    // Not in catalog yet → keep (legacy). Explicitly hidden → drop.
    return row == null || row.available !== false;
  });
}

export function homeToolsByCategory(tools: ToolDefinition[]): Array<{
  category: string;
  tools: ToolDefinition[];
}> {
  const categories: string[] = [...TOOL_CATEGORIES];
  if (tools.some((t) => t.category === "Custom Tools")) {
    categories.push("Custom Tools");
  }

  const map = new Map<string, ToolDefinition[]>();
  for (const cat of categories) {
    map.set(cat, []);
  }

  for (const tool of tools) {
    const list = map.get(tool.category) ?? map.get("Custom Tools");
    if (list && !list.some((t) => t.id === tool.id)) {
      list.push(tool);
    }
  }

  return categories
    .map((category) => ({
      category,
      tools: map.get(category) ?? [],
    }))
    .filter((g) => g.tools.length > 0);
}

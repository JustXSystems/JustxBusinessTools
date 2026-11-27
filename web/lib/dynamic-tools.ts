import type { PlatformToolDefinition } from "@/components/config/ConfigProvider";
import {
  defaultPersonalUsage,
  getToolDefinition,
  OPT_IN_TOOL_IDS,
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
      "qrgenerator",
      "gmap2mappls",
      "bosdesign",
      "bos",
      "imsdealer",
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
    personalUsage:
      typeof def.personalUsage === "boolean" ? def.personalUsage : defaultPersonalUsage(platform.id, type),
  };
}

/** Resolve personal-usage flag (platform override map wins over static defaults). */
export function isPersonalUsageTool(
  toolId: string,
  tool: Pick<ToolDefinition, "personalUsage"> | undefined,
  overrides?: Record<string, boolean> | null,
): boolean {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, toolId)) {
    return Boolean(overrides[toolId]);
  }
  if (tool && typeof tool.personalUsage === "boolean") return tool.personalUsage;
  return defaultPersonalUsage(toolId);
}

/** Apply personal-usage overrides onto resolved tool definitions. */
export function applyPersonalUsageOverrides(
  tools: ToolDefinition[],
  overrides?: Record<string, boolean> | null,
): ToolDefinition[] {
  if (!overrides || !Object.keys(overrides).length) return tools;
  return tools.map((t) => ({
    ...t,
    personalUsage: isPersonalUsageTool(t.id, t, overrides),
  }));
}

/**
 * Personal (no-GSTIN) accounts only see / open personalUsage tools.
 * Business users with GSTIN keep the full list.
 */
export function filterHomeToolsByPersonalAccount(
  tools: ToolDefinition[],
  personalAccount: boolean,
  overrides?: Record<string, boolean> | null,
): ToolDefinition[] {
  if (!personalAccount) return tools;
  return tools.filter((t) => isPersonalUsageTool(t.id, t, overrides));
}

/** Resolve admin-configured product name (from tool_skus) with fallback to static catalog / id. */
export function resolveToolName(
  toolId: string,
  toolNames?: Record<string, string> | null,
  fallback?: string,
): string {
  const override = toolNames?.[toolId]?.trim();
  if (override) return override;
  if (fallback) return fallback;
  return getToolDefinition(toolId)?.name ?? toolId;
}

/** Apply admin-configured product names onto resolved tool definitions. */
export function applyToolNameOverrides(
  tools: ToolDefinition[],
  toolNames?: Record<string, string> | null,
): ToolDefinition[] {
  if (!toolNames || !Object.keys(toolNames).length) return tools;
  return tools.map((t) => {
    const override = toolNames[t.id]?.trim();
    return override && override !== t.name ? { ...t, name: override } : t;
  });
}

export function resolveToolDefinition(
  toolId: string,
  platformTools: PlatformToolDefinition[],
  toolNames?: Record<string, string> | null,
): ToolDefinition | undefined {
  const staticDef = getToolDefinition(toolId);
  const base = staticDef
    ? staticDef
    : (() => {
        const platform = platformTools.find((t) => t.id === toolId);
        return platform ? buildToolFromPlatform(platform) : undefined;
      })();
  if (!base) return undefined;
  const override = toolNames?.[base.id]?.trim();
  return override && override !== base.name ? { ...base, name: override } : base;
}

export function mergedHomeTools(
  platformTools: PlatformToolDefinition[],
  toolNames?: Record<string, string> | null,
): ToolDefinition[] {
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

  return applyToolNameOverrides(out, toolNames);
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

/** Opt-in tools an admin has explicitly enabled; missing catalog rows never qualify. */
export function catalogEnabledOptInTools(
  catalog: Array<{ id: string; available: boolean }> | null | undefined,
  toolNames?: Record<string, string> | null,
): ToolDefinition[] {
  const out: ToolDefinition[] = [];
  for (const row of catalog ?? []) {
    if (row.available !== true || !OPT_IN_TOOL_IDS.has(row.id)) continue;
    const def = getToolDefinition(row.id);
    if (def && !out.some((t) => t.id === def.id)) out.push({ ...def, showOnHome: true });
  }
  return applyToolNameOverrides(out, toolNames);
}

export function homeToolsByCategory(
  tools: ToolDefinition[],
  options?: { group?: boolean },
): Array<{
  category: string;
  tools: ToolDefinition[];
}> {
  const group = options?.group !== false;

  if (!group) {
    const seen = new Set<string>();
    const flat: ToolDefinition[] = [];
    for (const tool of tools) {
      if (seen.has(tool.id)) continue;
      seen.add(tool.id);
      flat.push(tool);
    }
    return flat.length ? [{ category: "Tools", tools: flat }] : [];
  }

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

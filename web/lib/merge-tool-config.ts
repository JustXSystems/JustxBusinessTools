import type { TrackerConfig, DocumentConfig } from "@/config/tools.config";
import type { PlatformToolDefinition } from "@/components/config/ConfigProvider";

/** Merge admin-published tracker schema over static defaults. */
export function mergeTrackerConfig(
  base: TrackerConfig | undefined,
  override: PlatformToolDefinition | undefined,
): TrackerConfig | undefined {
  if (!base) return undefined;
  if (!override?.definition || override.toolType !== "tracker") return base;

  const def = override.definition as Partial<TrackerConfig>;
  return {
    ...base,
    ...def,
    fields: Array.isArray(def.fields) ? def.fields : base.fields,
    metaFields: Array.isArray(def.metaFields) ? def.metaFields : base.metaFields,
    subtitleFields: Array.isArray(def.subtitleFields) ? def.subtitleFields : base.subtitleFields,
    statusColors: def.statusColors ?? base.statusColors,
  };
}

/** Merge admin-published document labels over static defaults. */
export function mergeDocumentConfig(
  base: DocumentConfig,
  override: PlatformToolDefinition | undefined,
): DocumentConfig {
  if (!override?.definition || override.toolType !== "document") return base;

  const def = override.definition as Partial<DocumentConfig>;
  return {
    ...base,
    ...def,
    key: base.key,
  };
}

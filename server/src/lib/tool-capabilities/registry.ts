import { imsCapabilityAdapter } from "./ims-adapter.js";
import type { RegisteredToolCapability, ToolCapabilityAdapter } from "./types.js";

/**
 * Tools that expose a profile module ceiling. Add adapters here as each product
 * gains left-nav / feature allowlists (BOS, etc.). Everything else is whole-tool access.
 */
const CEILING_ADAPTERS: ReadonlyArray<ToolCapabilityAdapter> = [imsCapabilityAdapter];

const byId = new Map(CEILING_ADAPTERS.map((a) => [a.toolId, a]));

export function getCapabilityAdapter(toolId: string): ToolCapabilityAdapter | null {
  return byId.get(toolId) ?? null;
}

export function listCeilingAdapters(): ReadonlyArray<ToolCapabilityAdapter> {
  return CEILING_ADAPTERS;
}

export function describeToolCapability(toolId: string, name?: string): RegisteredToolCapability {
  const adapter = byId.get(toolId);
  if (adapter) return adapter;
  return { toolId, name: name ?? toolId, hasCeiling: false };
}

export function hasCapabilityCeiling(toolId: string): boolean {
  return byId.has(toolId);
}

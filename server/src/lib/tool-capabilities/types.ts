import type { Pool } from "mysql2/promise";

/** One left-nav / feature module inside a tool. */
export type CapabilityModule = {
  key: string;
  label: string;
  section: string;
  required?: boolean;
};

/** Per-profile ceiling for one tool. `enabled: null` = unrestricted. */
export type ToolCapabilitySnapshot = {
  toolId: string;
  name: string;
  hasCeiling: boolean;
  unrestricted: boolean;
  enabled: string[];
  alwaysOn: string[];
  catalog: ReadonlyArray<CapabilityModule>;
};

export type ToolCapabilityAdapter = {
  toolId: string;
  name: string;
  /** True when this tool stores a profile module allowlist. */
  hasCeiling: true;
  catalog: ReadonlyArray<CapabilityModule>;
  alwaysOn: ReadonlyArray<string>;
  get(db: Pool, businessProfileId: number): Promise<string[] | null>;
  set(db: Pool, businessProfileId: number, keys: ReadonlyArray<string> | null): Promise<string[] | null>;
};

export type WholeToolCapability = {
  toolId: string;
  name: string;
  hasCeiling: false;
};

export type RegisteredToolCapability = ToolCapabilityAdapter | WholeToolCapability;

export function coveragePct(
  unrestricted: boolean,
  enabled: ReadonlyArray<string>,
  catalog: ReadonlyArray<CapabilityModule>,
  alwaysOn: ReadonlyArray<string>,
): number {
  if (unrestricted) return 100;
  const always = new Set(alwaysOn);
  const optional = catalog.filter((m) => !always.has(m.key));
  if (optional.length === 0) return 100;
  const on = optional.filter((m) => enabled.includes(m.key)).length;
  return Math.max(0, Math.min(100, Math.round((on / optional.length) * 100)));
}

export function snapshotFromStored(
  adapter: ToolCapabilityAdapter,
  stored: string[] | null,
): ToolCapabilitySnapshot {
  const unrestricted = stored == null;
  const enabled = unrestricted ? adapter.catalog.map((m) => m.key) : stored;
  return {
    toolId: adapter.toolId,
    name: adapter.name,
    hasCeiling: true,
    unrestricted,
    enabled,
    alwaysOn: [...adapter.alwaysOn],
    catalog: adapter.catalog,
  };
}

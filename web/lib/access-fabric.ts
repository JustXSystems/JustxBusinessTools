/**
 * Access Fabric — canonical model for Business Profile tool access.
 *
 * Layers:
 *   identity      — legal completeness + approval
 *   entitle       — profile commercial licenses / included SKUs
 *   surface       — home_tool_ids allowlist on the operator home
 *   reach         — who may enter the profile (role + branch_access)
 *   catalog       — hard-lock pressure from unlicensed commercial tools
 *   capabilities  — per-tool module ceilings (when adapters exist), dynamic
 *
 * JBT Admins operate all layers in /admin Access Fabric.
 * Business Owners operate surface + reach on /profile.
 */

export type AccessLayerId =
  | "catalog"
  | "entitle"
  | "surface"
  | "reach"
  | "identity"
  | "capabilities";

/** Summary row from GET /admin/tool-capabilities for readiness. */
export type FabricCapabilityTool = {
  toolId: string;
  name: string;
  entitled: boolean;
  hasCeiling: boolean;
  unrestricted: boolean | null;
  coveragePct: number | null;
};

/** Visual / filter signal for a tool node on the lattice. */
export type AccessSignal = "included" | "licensed" | "locked" | "orphan" | "dim";

export type FabricToolNode = {
  toolId: string;
  name: string;
  category: string;
  includedFree: boolean;
  licensed: boolean;
  periodEnd: string | null;
  hardLock: boolean;
  onHome: boolean;
  hasSku: boolean;
  priceInr: number;
  trialDays: number;
  /** Profile-level freemium override when set. */
  recordLimitOverride?: number | null;
  /** SKU default unlicensed record limit. */
  unlicensedRecordLimit?: number | null;
};

export type FabricPack = {
  id: string;
  name: string;
  tagline: string | null;
  toolIds: string[];
  priceInr: number;
  listPriceInr: number;
  available: boolean;
  highlighted: boolean;
};

export type FabricInputs = {
  identityCompleteness: number; // 0–100
  approvalStatus: string;
  peopleGranted: number;
  peopleTotal: number;
  homeToolIds: string[];
  tools: FabricToolNode[];
  packs: FabricPack[];
  /** Assigned-tool capability ceilings; omit or empty to skip the capabilities layer. */
  capabilityTools?: FabricCapabilityTool[];
};

export type LayerScore = {
  id: AccessLayerId;
  label: string;
  score: number; // 0–100
  detail: string;
};

export type AccessAction = {
  id: string;
  priority: number;
  title: string;
  detail: string;
  layer: AccessLayerId;
  href?: string;
  action?:
    | "grant-pack"
    | "open-home"
    | "open-people"
    | "open-identity"
    | "open-lifecycle"
    | "open-capabilities";
  packId?: string;
  toolId?: string;
};

export type PackMatch = {
  pack: FabricPack;
  /** Resolved membership used for coverage + home sync (never empty for all_tools). */
  resolvedToolIds: string[];
  total: number;
  covered: number;
  missing: string[];
  coveragePct: number;
  recommended: boolean;
};

export type AccessReadiness = {
  score: number;
  grade: "A" | "B" | "C" | "D" | "E";
  tone: "ok" | "warn" | "bad";
  layers: LayerScore[];
  packs: PackMatch[];
  actions: AccessAction[];
  entitlementPct: number;
  surfaceAlignmentPct: number;
  licensedCount: number;
  includedCount: number;
  dimCount: number;
  orphanHomeCount: number;
};

const LAYER_WEIGHTS: Record<AccessLayerId, number> = {
  identity: 0.2,
  entitle: 0.35,
  surface: 0.2,
  reach: 0.1,
  catalog: 0.15,
  capabilities: 0.1,
};

/** When capabilities layer is active, nudge entitle/surface down so weights still sum ~1. */
const WEIGHTS_WITH_CAPABILITIES: Record<AccessLayerId, number> = {
  identity: 0.18,
  entitle: 0.3,
  surface: 0.16,
  reach: 0.1,
  catalog: 0.16,
  capabilities: 0.1,
};

export function capabilityCoverageScore(tools: ReadonlyArray<FabricCapabilityTool>): {
  score: number;
  detail: string;
  curatedGaps: number;
  unassignedCeilings: number;
} {
  const ceilings = tools.filter((t) => t.hasCeiling);
  if (ceilings.length === 0) {
    return { score: 100, detail: "No module ceilings registered", curatedGaps: 0, unassignedCeilings: 0 };
  }
  const unassignedCeilings = ceilings.filter((t) => !t.entitled).length;
  const assigned = ceilings.filter((t) => t.entitled);
  if (assigned.length === 0) {
    return {
      score: 25,
      detail: `${unassignedCeilings} capability tool(s) not assigned`,
      curatedGaps: 0,
      unassignedCeilings,
    };
  }
  const pcts = assigned.map((t) => (t.unrestricted ? 100 : (t.coveragePct ?? 0)));
  const score = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
  const curatedGaps = assigned.filter((t) => t.unrestricted === false && (t.coveragePct ?? 100) < 100).length;
  return {
    score,
    detail: curatedGaps
      ? `${curatedGaps} curated tool(s) with modules dimmed`
      : `${assigned.length} assigned · full module signal`,
    curatedGaps,
    unassignedCeilings,
  };
}

function clampPct(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function gradeFor(score: number): AccessReadiness["grade"] {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "E";
}

function toneFor(score: number): AccessReadiness["tone"] {
  if (score >= 75) return "ok";
  if (score >= 50) return "warn";
  return "bad";
}

/** True when home shows a tool the operator cannot use (unlicensed / hard-locked). */
export function isOrphanHome(node: FabricToolNode): boolean {
  return node.onHome && !node.includedFree && !node.licensed;
}

/**
 * Signal priority:
 * included → licensed → orphan (on home, unusable) → locked (hard lock off-home) → dim
 */
export function signalFor(node: FabricToolNode): AccessSignal {
  if (node.includedFree) return "included";
  if (node.licensed) return "licensed";
  if (isOrphanHome(node)) return "orphan";
  if (node.hardLock) return "locked";
  return "dim";
}

/** Resolve pack membership. Only `all_tools` expands when toolIds are empty. */
export function resolvePackToolIds(pack: FabricPack, tools: FabricToolNode[]): string[] {
  if (pack.toolIds.length > 0) return [...pack.toolIds];
  if (pack.id === "all_tools") {
    return tools.filter((t) => !t.includedFree && t.hasSku).map((t) => t.toolId);
  }
  return [];
}

export function computePackMatches(tools: FabricToolNode[], packs: FabricPack[]): PackMatch[] {
  const byId = new Map(tools.map((t) => [t.toolId, t]));
  return packs
    .filter((p) => p.available !== false)
    .map((pack) => {
      const resolvedToolIds = resolvePackToolIds(pack, tools);
      const nodes = resolvedToolIds.map((id) => byId.get(id)).filter(Boolean) as FabricToolNode[];
      const covered = nodes.filter((n) => n.includedFree || n.licensed).length;
      const missing = nodes.filter((n) => !n.includedFree && !n.licensed).map((n) => n.toolId);
      const coveragePct = nodes.length ? clampPct((covered / nodes.length) * 100) : 100;
      return {
        pack,
        resolvedToolIds,
        total: nodes.length,
        covered,
        missing,
        coveragePct,
        recommended: missing.length > 0 && (pack.highlighted || coveragePct < 60),
      };
    })
    .sort((a, b) => {
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      return a.coveragePct - b.coveragePct;
    });
}

export function computeAccessReadiness(input: FabricInputs): AccessReadiness {
  const tools = input.tools;
  const commercial = tools.filter((t) => t.hasSku || t.includedFree || t.licensed);
  const denom = Math.max(1, commercial.length);
  const includedCount = tools.filter((t) => t.includedFree).length;
  const licensedCount = tools.filter((t) => t.licensed && !t.includedFree).length;
  const entitled = tools.filter((t) => t.includedFree || t.licensed).length;
  const dimCount = tools.filter((t) => signalFor(t) === "dim").length;
  const hardLocks = tools.filter((t) => t.hardLock && !t.licensed && !t.includedFree).length;

  const homeSet = new Set(input.homeToolIds);
  const homeNodes = tools.filter((t) => homeSet.has(t.toolId));
  const homeUsable = homeNodes.filter((t) => t.includedFree || t.licensed);
  const orphanHomeCount = homeNodes.filter((t) => isOrphanHome({ ...t, onHome: true })).length;

  const entitlementPct = clampPct((entitled / denom) * 100);
  const surfaceAlignmentPct = homeNodes.length
    ? clampPct((homeUsable.length / homeNodes.length) * 100)
    : entitlementPct > 0
      ? 40
      : 0;
  const catalogHealth = clampPct(100 - (hardLocks / denom) * 70);
  const identityScore = clampPct(input.identityCompleteness);
  const approvalBonus =
    input.approvalStatus === "approved" ? 100 : input.approvalStatus === "pending" ? 35 : 10;
  const reachScore =
    input.peopleTotal <= 0
      ? 50
      : clampPct((input.peopleGranted / Math.max(1, input.peopleTotal)) * 100);

  const capabilityTools = input.capabilityTools ?? [];
  const hasCapabilityLayer = capabilityTools.some((t) => t.hasCeiling);
  const capability = capabilityCoverageScore(capabilityTools);
  const weights = hasCapabilityLayer ? WEIGHTS_WITH_CAPABILITIES : LAYER_WEIGHTS;

  const layers: LayerScore[] = [
    {
      id: "identity",
      label: "Identity",
      score: clampPct(identityScore * 0.7 + approvalBonus * 0.3),
      detail:
        input.approvalStatus === "approved"
          ? `${identityScore}% complete · approved`
          : `${identityScore}% complete · ${input.approvalStatus}`,
    },
    {
      id: "entitle",
      label: "Entitlements",
      score: entitlementPct,
      detail: `${licensedCount} licensed · ${includedCount} included · ${dimCount} open`,
    },
    {
      id: "surface",
      label: "Home surface",
      score: surfaceAlignmentPct,
      detail:
        orphanHomeCount > 0
          ? `${orphanHomeCount} home tool(s) unusable without license`
          : `${homeNodes.length} on home · ${homeUsable.length} usable`,
    },
    {
      id: "reach",
      label: "People reach",
      score: reachScore,
      detail: `${input.peopleGranted} with access · ${input.peopleTotal} in directory`,
    },
    {
      id: "catalog",
      label: "Catalog pressure",
      score: catalogHealth,
      detail: hardLocks
        ? `${hardLocks} hard-locked tool(s) still unlicensed`
        : "No hard-lock gaps on commercial tools",
    },
  ];

  if (hasCapabilityLayer) {
    layers.push({
      id: "capabilities",
      label: "Capabilities",
      score: clampPct(capability.score),
      detail: capability.detail,
    });
  }

  const weighted = clampPct(
    layers.reduce((sum, layer) => sum + layer.score * (weights[layer.id] ?? 0), 0),
  );

  const packs = computePackMatches(tools, input.packs);
  const actions: AccessAction[] = [];

  if (input.approvalStatus !== "approved") {
    actions.push({
      id: "approve",
      priority: 10,
      title: "Approve this Business Profile",
      detail: "Operators cannot fully run until the profile is approved.",
      layer: "identity",
      action: "open-lifecycle",
    });
  }
  if (identityScore < 75) {
    actions.push({
      id: "identity-gap",
      priority: 20,
      title: "Complete legal identity",
      detail: `Profile dossier is ${identityScore}% complete.`,
      layer: "identity",
      action: "open-identity",
    });
  }
  const bestPack = packs.find((p) => p.recommended && p.missing.length > 0);
  if (bestPack) {
    actions.push({
      id: `pack-${bestPack.pack.id}`,
      priority: 30,
      title: `Provision ${bestPack.pack.name}`,
      detail: `Covers ${bestPack.missing.length} missing tool(s) · ${bestPack.coveragePct}% pack fill`,
      layer: "entitle",
      action: "grant-pack",
      packId: bestPack.pack.id,
    });
  } else if (dimCount > 0) {
    actions.push({
      id: "license-gaps",
      priority: 35,
      title: "Close entitlement gaps",
      detail: `${dimCount} commercial tool(s) still unlicensed on this profile.`,
      layer: "entitle",
    });
  }
  if (orphanHomeCount > 0) {
    actions.push({
      id: "surface-orphan",
      priority: 40,
      title: "Align home surface",
      detail: "Home shows tools that are not licensed for this profile.",
      layer: "surface",
      action: "open-home",
    });
  }
  if (input.peopleGranted === 0 && input.peopleTotal > 1) {
    actions.push({
      id: "reach-gap",
      priority: 50,
      title: "Grant people reach",
      detail: "Staff/Viewer accounts have no access to this profile.",
      layer: "reach",
      action: "open-people",
    });
  }
  if (hasCapabilityLayer && capability.unassignedCeilings > 0) {
    const gap = capabilityTools.find((t) => t.hasCeiling && !t.entitled);
    actions.push({
      id: "capability-assign",
      priority: 45,
      title: gap ? `Assign ${gap.name}` : "Assign capability tools",
      detail: "Module ceilings stay locked until the tool is licensed on this profile.",
      layer: "capabilities",
      action: "open-capabilities",
      toolId: gap?.toolId,
    });
  } else if (hasCapabilityLayer && capability.curatedGaps > 0) {
    const gap = capabilityTools.find(
      (t) => t.hasCeiling && t.entitled && t.unrestricted === false && (t.coveragePct ?? 100) < 100,
    );
    actions.push({
      id: "capability-tune",
      priority: 48,
      title: gap ? `Tune ${gap.name} modules` : "Tune tool capabilities",
      detail: "Some left-nav modules are dimmed under a curated ceiling.",
      layer: "capabilities",
      action: "open-capabilities",
      toolId: gap?.toolId,
    });
  }

  actions.sort((a, b) => a.priority - b.priority);

  return {
    score: weighted,
    grade: gradeFor(weighted),
    tone: toneFor(weighted),
    layers,
    packs,
    actions: actions.slice(0, 5),
    entitlementPct,
    surfaceAlignmentPct,
    licensedCount,
    includedCount,
    dimCount,
    orphanHomeCount,
  };
}

export function groupToolsByCategory(tools: FabricToolNode[]): Array<[string, FabricToolNode[]]> {
  const map = new Map<string, FabricToolNode[]>();
  for (const t of tools) {
    const key = t.category || "General";
    const list = map.get(key) ?? [];
    list.push(t);
    map.set(key, list);
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

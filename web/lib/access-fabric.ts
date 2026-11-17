/**
 * Access Fabric — canonical model for Business Profile tool access.
 *
 * Layers (outer → inner):
 *   L1 Catalog   — org Live/Hidden placement
 *   L2 Entitle   — profile commercial licenses / included SKUs
 *   L3 Surface   — home_tool_ids allowlist on the operator home
 *   L4 Reach     — who may enter the profile (role + branch_access)
 *   L5 Identity  — legal completeness + approval lifecycle
 *
 * JBT Admins operate L1–L5 in /admin.
 * Business Owners operate L3 (home tools) + L4 (team) on /profile.
 */

export type AccessLayerId = "catalog" | "entitle" | "surface" | "reach" | "identity";

export type AccessSignal = "live" | "included" | "licensed" | "trial" | "locked" | "dim" | "orphan";

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
  action?: "grant-pack" | "open-home" | "open-people" | "open-identity" | "open-lifecycle";
  packId?: string;
};

export type PackMatch = {
  pack: FabricPack;
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
  catalog: 0.15, // approximated via hard-lock / sku presence on nodes
};

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

export function signalFor(node: FabricToolNode): AccessSignal {
  if (node.includedFree) return "included";
  if (node.licensed) return node.periodEnd ? "licensed" : "licensed";
  if (node.hardLock) return "locked";
  if (node.onHome && !node.licensed && !node.includedFree) return "orphan";
  if (!node.hasSku) return "dim";
  return "dim";
}

export function computePackMatches(tools: FabricToolNode[], packs: FabricPack[]): PackMatch[] {
  const byId = new Map(tools.map((t) => [t.toolId, t]));
  return packs
    .filter((p) => p.available !== false)
    .map((pack) => {
      const ids = pack.toolIds.length
        ? pack.toolIds
        : tools.filter((t) => !t.includedFree && t.hasSku).map((t) => t.toolId);
      const nodes = ids.map((id) => byId.get(id)).filter(Boolean) as FabricToolNode[];
      const covered = nodes.filter((n) => n.includedFree || n.licensed).length;
      const missing = nodes.filter((n) => !n.includedFree && !n.licensed).map((n) => n.toolId);
      const coveragePct = nodes.length ? clampPct((covered / nodes.length) * 100) : 100;
      return {
        pack,
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
  const dimCount = tools.filter((t) => !t.includedFree && !t.licensed && t.hasSku).length;
  const hardLocks = tools.filter((t) => t.hardLock && !t.licensed && !t.includedFree).length;

  const homeSet = new Set(input.homeToolIds);
  const homeNodes = tools.filter((t) => homeSet.has(t.toolId));
  const homeUsable = homeNodes.filter((t) => t.includedFree || t.licensed || !t.hardLock);
  const orphanHomeCount = homeNodes.filter((t) => !t.includedFree && !t.licensed && t.hardLock).length;

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
      : clampPct(
          ((input.peopleGranted + (input.approvalStatus === "approved" ? 1 : 0)) /
            Math.max(1, input.peopleTotal)) *
            100,
        );

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
          ? `${orphanHomeCount} home tool(s) blocked without license`
          : `${homeNodes.length} on home · ${homeUsable.length} usable`,
    },
    {
      id: "reach",
      label: "People reach",
      score: reachScore,
      detail: `${input.peopleGranted} explicit grant(s) · ${input.peopleTotal} in directory`,
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

  const weighted = clampPct(
    layers[0].score * LAYER_WEIGHTS.identity +
      layers[1].score * LAYER_WEIGHTS.entitle +
      layers[2].score * LAYER_WEIGHTS.surface +
      layers[3].score * LAYER_WEIGHTS.reach +
      layers[4].score * LAYER_WEIGHTS.catalog,
  );

  const packs = computePackMatches(tools, input.packs);
  const actions: AccessAction[] = [];

  if (input.approvalStatus !== "approved") {
    actions.push({
      id: "approve",
      priority: 10,
      title: "Approve this Business Profile",
      detail: "Operators cannot fully run until the branch is approved.",
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
      detail: "Home shows tools that are hard-locked without a license.",
      layer: "surface",
      action: "open-home",
    });
  }
  if (input.peopleGranted === 0 && input.peopleTotal > 1) {
    actions.push({
      id: "reach-gap",
      priority: 50,
      title: "Grant people reach",
      detail: "Staff/Viewer accounts have no explicit access to this profile.",
      layer: "reach",
      action: "open-people",
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

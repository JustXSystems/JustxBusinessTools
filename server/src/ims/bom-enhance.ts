/**
 * Pure BOM enhancement helpers (Phases 1–4 MVP).
 * Keep side-effect free so unit tests don't need MySQL.
 */
import { round2, round3 } from "./logic.js";

export type GateSeverity = "error" | "warning";
export type BomGateIssue = {
  code: string;
  severity: GateSeverity;
  message: string;
  lineId?: string | null;
  section?: string | null;
};

export type GateLine = {
  id?: string | null;
  section?: string | null;
  lineKind: string;
  itemId: string | null;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  scaleByCapacity?: boolean;
  itemActive?: boolean | null;
};

export type ConfirmGatesInput = {
  customerName: string;
  capacityLabel: string | null | undefined;
  lines: ReadonlyArray<GateLine>;
  acknowledgeWarnings?: boolean;
};

export type ConfirmGatesResult = {
  ok: boolean;
  errors: BomGateIssue[];
  warnings: BomGateIssue[];
  issues: BomGateIssue[];
};

export function evaluateConfirmGates(input: ConfirmGatesInput): ConfirmGatesResult {
  const errors: BomGateIssue[] = [];
  const warnings: BomGateIssue[] = [];
  const push = (severity: GateSeverity, code: string, message: string, line?: GateLine) => {
    const issue: BomGateIssue = {
      code,
      severity,
      message,
      lineId: line?.id ?? null,
      section: line?.section ?? null,
    };
    (severity === "error" ? errors : warnings).push(issue);
  };

  if (!String(input.customerName || "").trim()) {
    push("error", "customer_required", "Customer name is required before confirming");
  }
  if (!input.lines.length) {
    push("error", "lines_required", "Add at least one line before confirming");
  }

  const hasScaled = input.lines.some((l) => l.scaleByCapacity);
  if (hasScaled) {
    const cap = parseCapacityNumberLocal(input.capacityLabel);
    if (cap == null) {
      push("error", "capacity_required", "Capacity label must include a number when scaled lines are present");
    }
  }

  for (const line of input.lines) {
    if (!(line.qty > 0)) {
      push("error", "zero_qty", `Line "${line.description || "Untitled"}" has zero quantity`, line);
    }
    if (!String(line.unit || "").trim()) {
      push("error", "missing_uom", `Line "${line.description || "Untitled"}" is missing a unit of measure`, line);
    }
    if (line.lineKind === "stock" && !line.itemId) {
      push("error", "unmatched_catalogue", `Stock line "${line.description || "Untitled"}" is not linked to the catalogue`, line);
    }
    if (line.itemId && line.itemActive === false) {
      push("error", "inactive_item", `Line "${line.description || "Untitled"}" references an inactive catalogue item`, line);
    }
    if (!(line.rate > 0)) {
      push("warning", "zero_rate", `Line "${line.description || "Untitled"}" has a zero rate`, line);
    }
  }

  const issues = [...errors, ...warnings];
  const warningsOk = !warnings.length || Boolean(input.acknowledgeWarnings);
  return {
    ok: errors.length === 0 && warningsOk,
    errors,
    warnings,
    issues,
  };
}

function parseCapacityNumberLocal(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = String(label).match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ---------- Cost roll-up ---------- */

export type CostLineIn = { qty: number; rate: number; costRate: number | null | undefined; scrapPct?: number };
export type CostRollup = {
  materialsSell: number;
  materialsCost: number;
  marginAmount: number;
  marginPctOfSell: number;
  lineMargins: Array<{ sell: number; cost: number; margin: number; marginPct: number }>;
};

export function computeCostRollup(lines: ReadonlyArray<CostLineIn>, marginPct: number): CostRollup {
  const lineMargins = lines.map((l) => {
    const scrap = Math.max(0, Number(l.scrapPct) || 0) / 100;
    const qty = round3(l.qty * (1 + scrap));
    const sell = round2(qty * round2(l.rate));
    const costRate = l.costRate == null ? 0 : round2(l.costRate);
    const cost = round2(qty * costRate);
    const margin = round2(sell - cost);
    const marginPctLine = sell > 0 ? round3((margin / sell) * 100) : 0;
    return { sell, cost, margin, marginPct: marginPctLine };
  });
  const materialsSell = round2(lineMargins.reduce((s, x) => s + x.sell, 0));
  const materialsCost = round2(lineMargins.reduce((s, x) => s + x.cost, 0));
  const marginAmount = round2(materialsSell * (Number(marginPct) || 0) / 100);
  const marginPctOfSell = materialsSell > 0 ? round3(((materialsSell + marginAmount - materialsCost) / (materialsSell + marginAmount)) * 100) : 0;
  return { materialsSell, materialsCost, marginAmount, marginPctOfSell, lineMargins };
}

/* ---------- Formula engine (safe arithmetic) ---------- */

const FORMULA_OK = /^[0-9+\-*/%().,\sA-Za-z_]+$/;

const SAFE_FUNCS = new Set(["ceil", "floor", "round", "max", "min", "abs"]);

export function evalQtyFormula(expr: string | null | undefined, vars: Record<string, number>): number | null {
  if (!expr || !String(expr).trim()) return null;
  const raw = String(expr).trim();
  if (!FORMULA_OK.test(raw)) throw new Error("Formula contains unsupported characters");
  let replaced = raw;
  // Longer names first so capacityKw isn't partially replaced by capacity
  const keys = Object.keys(vars).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    replaced = replaced.replace(new RegExp(`\\b${key}\\b`, "g"), String(vars[key]));
  }
  // Allow a small whitelist of Math helpers without exposing the Math object broadly.
  replaced = replaced.replace(/\b(ceil|floor|round|max|min|abs)\s*\(/g, (_, fn: string) => {
    if (!SAFE_FUNCS.has(fn)) throw new Error("Unsupported function");
    return `Math.${fn}(`;
  });
  if (/[A-Za-z_]/.test(replaced.replace(/Math\.(ceil|floor|round|max|min|abs)/g, ""))) {
    throw new Error("Formula references unknown variables");
  }
  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${replaced});`)();
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Formula did not evaluate to a number");
  return round3(Math.max(0, value));
}

export function defaultVariablesFromCapacity(capacityLabel: string | null | undefined): Record<string, number> {
  const n = parseCapacityNumberLocal(capacityLabel);
  return n == null ? {} : { capacity: n, capacityKw: n };
}

export const FORMULA_PRESETS: Record<string, { label: string; variables: Record<string, number>; sampleFormula: string }> = {
  solar: { label: "Solar kit", variables: { capacityKw: 3, panelWp: 550 }, sampleFormula: "ceil(capacityKw * 1000 / panelWp)" },
  hvac: { label: "HVAC", variables: { capacity: 1.5, rooms: 2 }, sampleFormula: "rooms * capacity" },
  cctv: { label: "CCTV", variables: { cameras: 4, channelsPerNvr: 8 }, sampleFormula: "ceil(cameras / channelsPerNvr)" },
};

/* ---------- Nested package cycle detection ---------- */

export function wouldCreatePackageCycle(
  packageId: string,
  childPackageId: string | null | undefined,
  edges: ReadonlyMap<string, ReadonlyArray<string>>,
): boolean {
  if (!childPackageId) return false;
  if (childPackageId === packageId) return true;
  const seen = new Set<string>();
  const stack = [childPackageId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === packageId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of edges.get(cur) ?? []) stack.push(next);
  }
  return false;
}

/* ---------- Options / 150% lite ---------- */

export function lineIncludedByOptions(
  optionalFlag: boolean,
  optionKey: string | null | undefined,
  selected: ReadonlySet<string> | ReadonlyArray<string>,
): boolean {
  if (!optionalFlag) return true;
  if (!optionKey) return false;
  const set = selected instanceof Set ? selected : new Set(selected);
  return set.has(optionKey);
}

/* ---------- Diff ---------- */

export type DiffLine = {
  key: string;
  description: string;
  section: string;
  qty: number;
  rate: number;
  unit: string;
};

export type BomLineDiff =
  | { kind: "added"; right: DiffLine }
  | { kind: "removed"; left: DiffLine }
  | { kind: "changed"; left: DiffLine; right: DiffLine; fields: Array<"qty" | "rate" | "unit" | "section" | "description"> }
  | { kind: "same"; left: DiffLine; right: DiffLine };

export function diffBomLines(left: ReadonlyArray<DiffLine>, right: ReadonlyArray<DiffLine>): BomLineDiff[] {
  const leftMap = new Map(left.map((l) => [l.key, l]));
  const rightMap = new Map(right.map((l) => [l.key, l]));
  const keys = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const out: BomLineDiff[] = [];
  for (const key of keys) {
    const l = leftMap.get(key);
    const r = rightMap.get(key);
    if (l && !r) out.push({ kind: "removed", left: l });
    else if (!l && r) out.push({ kind: "added", right: r });
    else if (l && r) {
      const fields: Array<"qty" | "rate" | "unit" | "section" | "description"> = [];
      if (l.qty !== r.qty) fields.push("qty");
      if (l.rate !== r.rate) fields.push("rate");
      if (l.unit !== r.unit) fields.push("unit");
      if (l.section !== r.section) fields.push("section");
      if (l.description !== r.description) fields.push("description");
      out.push(fields.length ? { kind: "changed", left: l, right: r, fields } : { kind: "same", left: l, right: r });
    }
  }
  return out;
}

export function diffKeyOf(line: { itemId?: string | null; description: string; section: string; sortNo?: number }): string {
  if (line.itemId) return `item:${line.itemId}`;
  return `desc:${line.section}|${line.description}|${line.sortNo ?? 0}`;
}

/* ---------- As-built variance ---------- */

export type AsBuiltLine = { lineId: string; description: string; soldQty: number; issuedQty: number; unit: string };
export type AsBuiltVariance = AsBuiltLine & { variance: number };

export function computeAsBuiltVariance(lines: ReadonlyArray<AsBuiltLine>): AsBuiltVariance[] {
  return lines.map((l) => ({
    ...l,
    variance: round3(l.issuedQty - l.soldQty),
  }));
}

/* ---------- Proposal token ---------- */

export function proposalWhatsAppUrl(proposalUrl: string, customerName: string): string {
  const text = `Hello${customerName ? ` ${customerName}` : ""}, please review our materials proposal: ${proposalUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function isProposalStatus(v: string | null | undefined): v is "sent" | "viewed" | "accepted" | "rejected" | "revoked" {
  return v === "sent" || v === "viewed" || v === "accepted" || v === "rejected" || v === "revoked";
}

/* ---------- Partial issue ---------- */

export function remainingIssueQty(soldQty: number, issuedQty: number): number {
  return round3(Math.max(0, soldQty - issuedQty));
}

export function applyPartialIssue(
  lines: ReadonlyArray<{ id: string; qty: number; issuedQty: number }>,
  requests: ReadonlyArray<{ lineId: string; qty: number }>,
): Array<{ lineId: string; qty: number; nextIssuedQty: number }> {
  const req = new Map(requests.map((r) => [r.lineId, r.qty]));
  const out: Array<{ lineId: string; qty: number; nextIssuedQty: number }> = [];
  for (const line of lines) {
    const want = req.get(line.id);
    if (want == null || !(want > 0)) continue;
    const rem = remainingIssueQty(line.qty, line.issuedQty);
    const qty = round3(Math.min(want, rem));
    if (!(qty > 0)) continue;
    out.push({ lineId: line.id, qty, nextIssuedQty: round3(line.issuedQty + qty) });
  }
  return out;
}

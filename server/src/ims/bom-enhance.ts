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

/** Accept `string[]` or `{ key: boolean }` and return a canonical `{ key: true|false }` map. */
export function normalizeOptionSelection(input: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (Array.isArray(input)) {
    for (const k of input) {
      const key = String(k ?? "").trim();
      if (key) out[key] = true;
    }
    return out;
  }
  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const key = k.trim();
      if (!key) continue;
      out[key] = v === true || v === 1 || v === "1" || v === "true";
    }
  }
  return out;
}

/** Keys whose value is truthy in an `options_json` style map. */
export function selectedOptionKeys(options: unknown): string[] {
  return Object.entries(normalizeOptionSelection(options))
    .filter(([, on]) => on)
    .map(([k]) => k);
}

/* ---------- Alternates (#38) ---------- */

type StockLookup = ReadonlyMap<string, number> | Readonly<Record<string, number>>;

function stockOf(lookup: StockLookup, itemId: string): number {
  const v = lookup instanceof Map ? lookup.get(itemId) : (lookup as Record<string, number>)[itemId];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** First alternate (in listed order, excluding the primary) whose on-hand covers `needQty`, else null. */
export function pickAlternateWhenShort(
  primaryItemId: string | null | undefined,
  alternateIds: ReadonlyArray<string> | null | undefined,
  stockByItemId: StockLookup,
  needQty: number,
): string | null {
  if (!alternateIds?.length || !(needQty > 0)) return null;
  for (const id of alternateIds) {
    if (!id || id === primaryItemId) continue;
    if (stockOf(stockByItemId, id) >= needQty) return id;
  }
  return null;
}

export type AlternateSuggestLine = {
  id: string;
  lineKind: string;
  itemId: string | null;
  description: string;
  qty: number;
  issuedQty?: number;
  alternateItemIds?: ReadonlyArray<string> | null;
};

export type AlternateSuggestion = {
  lineId: string;
  description: string;
  primaryItemId: string;
  need: number;
  onHand: number;
  shortfall: number;
  /** First alternate that fully covers this line's remaining qty (or null). */
  suggestedItemId: string | null;
  candidates: Array<{ itemId: string; onHand: number; covers: boolean }>;
};

/**
 * For stock lines whose primary item is short (aggregated across lines, on remaining qty),
 * propose alternates from each line's `alternateItemIds`.
 */
export function suggestAlternatesForShortfall(
  lines: ReadonlyArray<AlternateSuggestLine>,
  stockByItemId: StockLookup,
): AlternateSuggestion[] {
  const remaining = (l: AlternateSuggestLine) => remainingIssueQty(l.qty, l.issuedQty ?? 0);
  const needByItem = new Map<string, number>();
  for (const l of lines) {
    if (l.lineKind !== "stock" || !l.itemId) continue;
    const rem = remaining(l);
    if (!(rem > 0)) continue;
    needByItem.set(l.itemId, round3((needByItem.get(l.itemId) ?? 0) + rem));
  }
  const out: AlternateSuggestion[] = [];
  for (const l of lines) {
    if (l.lineKind !== "stock" || !l.itemId || !l.alternateItemIds?.length) continue;
    const rem = remaining(l);
    if (!(rem > 0)) continue;
    const onHand = round3(stockOf(stockByItemId, l.itemId));
    const need = needByItem.get(l.itemId) ?? rem;
    const shortfall = round3(Math.max(0, need - onHand));
    if (!(shortfall > 0)) continue;
    out.push({
      lineId: l.id,
      description: l.description,
      primaryItemId: l.itemId,
      need,
      onHand,
      shortfall,
      suggestedItemId: pickAlternateWhenShort(l.itemId, l.alternateItemIds, stockByItemId, rem),
      candidates: l.alternateItemIds
        .filter((a) => a && a !== l.itemId)
        .map((a) => ({ itemId: a, onHand: round3(stockOf(stockByItemId, a)), covers: stockOf(stockByItemId, a) >= rem })),
    });
  }
  return out;
}

/**
 * After swapping `oldItemId` → `newItemId`, keep alternates reversible: drop the new item and
 * append the old one (deduped, order preserved).
 */
export function rotateAlternates(
  alternates: ReadonlyArray<string>,
  oldItemId: string | null,
  newItemId: string,
): string[] {
  const next = alternates.filter((a) => a && a !== newItemId);
  if (oldItemId && oldItemId !== newItemId && !next.includes(oldItemId)) next.push(oldItemId);
  return next;
}

/* ---------- Nested package explode (#41) / options (#42) ---------- */

export type PackageLineLike = {
  id?: string;
  section: string;
  sortNo?: number;
  lineKind: string;
  itemId: string | null;
  description: string;
  makeText?: string | null;
  qty: number;
  unit: string;
  scaleByCapacity?: boolean;
  defaultRate?: number;
  remarks?: string | null;
  active?: boolean;
  qtyFormula?: string | null;
  childPackageId?: string | null;
  optionalFlag?: boolean;
  optionKey?: string | null;
  alternateItemIds?: ReadonlyArray<string> | null;
  serviceSpare?: boolean;
  scrapPct?: number | null;
  costRate?: number | null;
};

export type ExplodedLine = {
  section: string;
  sortNo: number;
  lineKind: string;
  itemId: string | null;
  description: string;
  makeText: string | null;
  qty: number;
  unit: string;
  scaleByCapacity: boolean;
  rate: number;
  remarks: string | null;
  qtyFormula: string | null;
  optionalFlag: boolean;
  optionKey: string | null;
  alternateItemIds: string[];
  serviceSpare: boolean;
  scrapPct: number;
  costRate: number | null;
  sourcePackageId: string;
  sourcePackageLineId: string | null;
  depth: number;
};

export type ExplodeOptions = {
  capacityLabel?: string | null;
  selectedOptions?: ReadonlySet<string> | ReadonlyArray<string>;
  variables?: Record<string, number>;
  /** Max nesting depth (root = 0). Default 8. */
  depthLimit?: number;
};

/**
 * Recursively flatten a package into leaf lines.
 * - Lines with `childPackageId` are phantom: they are replaced by the child package's lines,
 *   multiplied by the child line's qty (formula, else raw qty — never capacity-scaled, to avoid double scaling).
 * - Optional lines are dropped unless their `optionKey` is selected.
 * - Leaf qty = `evalQtyFormula(qtyFormula, vars)` when set, else qty × capacity when `scaleByCapacity`, else qty;
 *   then × the product of ancestor child-line quantities.
 * - Throws on cycles (A → … → A), on exceeding `depthLimit`, on unknown child packages and bad formulas.
 */
export async function explodeNestedPackageLines(
  getPackageLines: (packageId: string) => Promise<ReadonlyArray<PackageLineLike> | null | undefined>,
  rootId: string,
  opts: ExplodeOptions = {},
): Promise<ExplodedLine[]> {
  const depthLimit = Math.max(0, opts.depthLimit ?? 8);
  const selected = new Set(opts.selectedOptions ?? []);
  const vars = { ...defaultVariablesFromCapacity(opts.capacityLabel), ...(opts.variables ?? {}) };
  const capacity = parseCapacityNumberLocal(opts.capacityLabel);
  const out: ExplodedLine[] = [];

  const baseQty = (l: PackageLineLike, scaleByCapacity: boolean): number => {
    if (l.qtyFormula && String(l.qtyFormula).trim()) {
      try {
        const v = evalQtyFormula(l.qtyFormula, vars);
        if (v != null) return v;
      } catch (e) {
        throw new Error(`Line "${l.description}": ${e instanceof Error ? e.message : "invalid formula"}`);
      }
    }
    if (scaleByCapacity && capacity != null) return round3(l.qty * capacity);
    return round3(l.qty);
  };

  const walk = async (packageId: string, depth: number, multiplier: number, path: string[]): Promise<void> => {
    if (path.includes(packageId)) {
      throw new Error(`Package cycle detected: ${[...path, packageId].join(" → ")}`);
    }
    if (depth > depthLimit) {
      throw new Error(`Nested package depth limit (${depthLimit}) exceeded`);
    }
    const lines = await getPackageLines(packageId);
    if (!lines) throw new Error(`Package ${packageId} not found`);
    const nextPath = [...path, packageId];
    for (const l of lines) {
      if (l.active === false) continue;
      if (!lineIncludedByOptions(Boolean(l.optionalFlag), l.optionKey, selected)) continue;
      if (l.childPackageId) {
        const childQty = baseQty(l, false);
        if (!(childQty > 0)) continue;
        await walk(l.childPackageId, depth + 1, round3(multiplier * childQty), nextPath);
        continue;
      }
      out.push({
        section: l.section,
        sortNo: 0,
        lineKind: l.lineKind,
        itemId: l.itemId ?? null,
        description: l.description,
        makeText: l.makeText ?? null,
        qty: round3(baseQty(l, Boolean(l.scaleByCapacity)) * multiplier),
        unit: l.unit,
        scaleByCapacity: Boolean(l.scaleByCapacity),
        rate: round2(l.defaultRate ?? 0),
        remarks: l.remarks ?? null,
        qtyFormula: l.qtyFormula ?? null,
        optionalFlag: Boolean(l.optionalFlag),
        optionKey: l.optionKey ?? null,
        alternateItemIds: [...(l.alternateItemIds ?? [])],
        serviceSpare: Boolean(l.serviceSpare),
        scrapPct: Number(l.scrapPct) || 0,
        costRate: l.costRate ?? null,
        sourcePackageId: packageId,
        sourcePackageLineId: l.id ?? null,
        depth,
      });
    }
  };

  await walk(rootId, 0, 1, []);
  return out.map((l, i) => ({ ...l, sortNo: i }));
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

/* ---------- Rate card matching ---------- */

export type RateCardMatchSource = {
  itemId: string | null;
  sku: string | null;
  rate: number;
  costRate?: number | null;
};

export type BomRateMatchTarget = {
  id: string;
  itemId: string | null;
  itemSku?: string | null;
  sku?: string | null;
};

export type RateCardLineMatch = {
  lineId: string;
  rate: number;
  costRate: number | null;
  matchedBy: "itemId" | "sku";
};

/** Match rate-card lines onto BOM lines: prefer itemId, then sku (case-insensitive). */
export function matchRateCardToBomLines(
  bomLines: ReadonlyArray<BomRateMatchTarget>,
  rateLines: ReadonlyArray<RateCardMatchSource>,
): RateCardLineMatch[] {
  const byItem = new Map<string, RateCardMatchSource>();
  const bySku = new Map<string, RateCardMatchSource>();
  for (const rl of rateLines) {
    if (rl.itemId) byItem.set(rl.itemId, rl);
    const sku = rl.sku?.trim().toLowerCase();
    if (sku) bySku.set(sku, rl);
  }
  const out: RateCardLineMatch[] = [];
  for (const bl of bomLines) {
    let match: RateCardMatchSource | undefined;
    let matchedBy: "itemId" | "sku" | undefined;
    if (bl.itemId && byItem.has(bl.itemId)) {
      match = byItem.get(bl.itemId);
      matchedBy = "itemId";
    } else {
      const sku = (bl.itemSku ?? bl.sku)?.trim().toLowerCase();
      if (sku && bySku.has(sku)) {
        match = bySku.get(sku);
        matchedBy = "sku";
      }
    }
    if (match && matchedBy) {
      out.push({
        lineId: bl.id,
        rate: round2(match.rate),
        costRate: match.costRate == null ? null : round2(match.costRate),
        matchedBy,
      });
    }
  }
  return out;
}

/** Apply matched rate-card rates onto BOM lines (pure; does not mutate input). */
export function applyRateCardRates<T extends BomRateMatchTarget & { rate: number; costRate?: number | null }>(
  bomLines: ReadonlyArray<T>,
  rateLines: ReadonlyArray<RateCardMatchSource>,
): T[] {
  const matched = new Map(matchRateCardToBomLines(bomLines, rateLines).map((m) => [m.lineId, m]));
  return bomLines.map((l) => {
    const m = matched.get(l.id);
    if (!m) return { ...l };
    return { ...l, rate: m.rate, costRate: m.costRate };
  });
}

/* ---------- Partial issue ---------- */

export function remainingIssueQty(soldQty: number, issuedQty: number): number {
  return round3(Math.max(0, soldQty - issuedQty));
}

export const SERIAL_NOTES_MAX = 500;

/** Append a new serial/batch note to existing ones (deduped, `; `-separated). Blank additions are ignored. */
export function mergeSerialNotes(existing: string | null | undefined, addition: string | null | undefined): string | null {
  const add = String(addition ?? "").trim();
  const cur = String(existing ?? "").trim();
  if (!add) return cur || null;
  if (!cur) return add;
  if (cur.split(/;\s*/).includes(add)) return cur;
  return `${cur}; ${add}`;
}

/**
 * True when stock was issued in full by the legacy all-at-once flow (stock_issued_at set but no
 * line has issued_qty recorded). New full issues also record issued_qty, so this only matches old data.
 */
export function isLegacyFullIssue(
  stockIssuedAt: string | null | undefined,
  lines: ReadonlyArray<{ issuedQty?: number }>,
): boolean {
  return Boolean(stockIssuedAt) && lines.every((l) => !(Number(l.issuedQty) > 0));
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

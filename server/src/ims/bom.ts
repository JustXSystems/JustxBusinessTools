import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getOrgFeatureSwitches } from "../lib/feature-switches.js";
import { getRequestContext } from "../lib/request-context.js";
import { actorOf, isoDate, optText, parse, parsePatch, qint, qstr, recordEvent, requireAnyPerm, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, likeOf, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { badRequest, conflict, forbidden, notFound } from "./host.js";
import { round2, round3, todayISO, type ImsLineInput } from "./logic.js";
import { createLinkedInvoice } from "./sales.js";
import { getSettings } from "./settings.js";
import { nextDocNo, postMovement } from "./stock.js";

export const BOM_LINE_KINDS = ["stock", "service", "overhead", "scaled"] as const;
export type BomLineKind = (typeof BOM_LINE_KINDS)[number];

export const BOM_DOC_STATUSES = ["draft", "confirmed", "cancelled"] as const;
export type BomDocStatus = (typeof BOM_DOC_STATUSES)[number];

/** Ready for P3 — user picks when converting a confirmed BOM to a GST invoice. */
export const BOM_INVOICE_CONVERT_MODES = ["lump_sum", "explode_lines"] as const;
export type BomInvoiceConvertMode = (typeof BOM_INVOICE_CONVERT_MODES)[number];

const kindOf = (v: string): BomLineKind => ((BOM_LINE_KINDS as readonly string[]).includes(v) ? (v as BomLineKind) : "stock");
const statusOf = (v: string): BomDocStatus => ((BOM_DOC_STATUSES as readonly string[]).includes(v) ? (v as BomDocStatus) : "draft");
const convertModeOf = (v: string | null): BomInvoiceConvertMode | null =>
  v && (BOM_INVOICE_CONVERT_MODES as readonly string[]).includes(v) ? (v as BomInvoiceConvertMode) : null;

type PkgRow = {
  id: string;
  code: string | null;
  name: string;
  capacity_label: string | null;
  description: string | null;
  default_margin_pct: string;
  default_tax_pct: string;
  active: number;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  line_count?: number;
};

type PkgLineRow = {
  id: string;
  package_id: string;
  section: string;
  sort_no: number;
  line_kind: string;
  item_id: string | null;
  description: string;
  make_text: string | null;
  qty: string;
  unit: string;
  scale_by_capacity: number;
  default_rate: string;
  remarks: string | null;
  active: number;
  item_name?: string | null;
  item_sku?: string | null;
  item_unit?: string | null;
  selling_price?: string | null;
};

type DocRow = {
  id: string;
  package_id: string | null;
  package_name: string | null;
  doc_no: string;
  status: string;
  doc_date: string;
  capacity_label: string | null;
  title: string | null;
  customer_name: string;
  location: string | null;
  party_id: string | null;
  margin_pct: string;
  tax_pct: string;
  materials_total: string;
  margin_amount: string;
  tax_amount: string;
  grand_total: string;
  notes: string | null;
  prepared_by: string | null;
  invoice_id: string | null;
  invoice_convert_mode: string | null;
  stock_issued_at: string | null;
  stock_issue_count: number;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type DocLineRow = {
  id: string;
  doc_id: string;
  section: string;
  sort_no: number;
  line_kind: string;
  item_id: string | null;
  description: string;
  make_text: string | null;
  qty: string;
  unit: string;
  scale_by_capacity: number;
  rate: string;
  amount: string;
  remarks: string | null;
  item_name?: string | null;
  item_sku?: string | null;
};

export function mapPkgLine(r: PkgLineRow) {
  return {
    id: r.id,
    packageId: r.package_id,
    section: r.section,
    sortNo: Number(r.sort_no),
    lineKind: kindOf(r.line_kind),
    itemId: r.item_id,
    itemName: r.item_name ?? null,
    itemSku: r.item_sku ?? null,
    description: r.description,
    makeText: r.make_text,
    qty: round3(money(r.qty)),
    unit: r.unit,
    scaleByCapacity: Boolean(r.scale_by_capacity),
    defaultRate: round2(money(r.default_rate)),
    remarks: r.remarks,
    active: Boolean(r.active),
  };
}
export type BomPackageLine = ReturnType<typeof mapPkgLine>;

export function mapPackage(r: PkgRow, lines?: BomPackageLine[]) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    capacityLabel: r.capacity_label,
    description: r.description,
    defaultMarginPct: round3(money(r.default_margin_pct)),
    defaultTaxPct: round3(money(r.default_tax_pct)),
    active: Boolean(r.active),
    lineCount: r.line_count == null ? lines?.length ?? 0 : Number(r.line_count),
    createdByName: r.created_by_name,
    createdAt: tsOf(r.created_at),
    updatedAt: tsOf(r.updated_at),
    lines: lines ?? undefined,
  };
}
export type BomPackage = ReturnType<typeof mapPackage>;

export function mapDocLine(r: DocLineRow) {
  return {
    id: r.id,
    docId: r.doc_id,
    section: r.section,
    sortNo: Number(r.sort_no),
    lineKind: kindOf(r.line_kind),
    itemId: r.item_id,
    itemName: r.item_name ?? null,
    itemSku: r.item_sku ?? null,
    description: r.description,
    makeText: r.make_text,
    qty: round3(money(r.qty)),
    unit: r.unit,
    scaleByCapacity: Boolean(r.scale_by_capacity),
    rate: round2(money(r.rate)),
    amount: round2(money(r.amount)),
    remarks: r.remarks,
  };
}
export type BomDocLine = ReturnType<typeof mapDocLine>;

export function mapDoc(r: DocRow, lines?: BomDocLine[]) {
  return {
    id: r.id,
    packageId: r.package_id,
    packageName: r.package_name,
    docNo: r.doc_no,
    status: statusOf(r.status),
    docDate: isoOf(r.doc_date),
    capacityLabel: r.capacity_label,
    title: r.title,
    customerName: r.customer_name,
    location: r.location,
    partyId: r.party_id,
    marginPct: round3(money(r.margin_pct)),
    taxPct: round3(money(r.tax_pct)),
    materialsTotal: round2(money(r.materials_total)),
    marginAmount: round2(money(r.margin_amount)),
    taxAmount: round2(money(r.tax_amount)),
    grandTotal: round2(money(r.grand_total)),
    notes: r.notes,
    preparedBy: r.prepared_by,
    invoiceId: r.invoice_id,
    /** Set when converting to invoice. Both modes are supported. */
    invoiceConvertMode: convertModeOf(r.invoice_convert_mode),
    invoiceConvertModes: BOM_INVOICE_CONVERT_MODES,
    stockIssuedAt: tsOf(r.stock_issued_at),
    stockIssueCount: Number(r.stock_issue_count ?? 0),
    createdByName: r.created_by_name,
    createdAt: tsOf(r.created_at),
    updatedAt: tsOf(r.updated_at),
    lines: lines ?? undefined,
  };
}
export type BomDoc = ReturnType<typeof mapDoc>;

export type BomTotals = {
  materialsTotal: number;
  marginAmount: number;
  taxAmount: number;
  grandTotal: number;
};

export function computeBomTotals(lines: ReadonlyArray<{ qty: number; rate: number }>, marginPct: number, taxPct: number): BomTotals {
  const materialsTotal = round2(lines.reduce((s, l) => s + round2(round3(l.qty) * round2(l.rate)), 0));
  const marginAmount = round2(materialsTotal * (Number(marginPct) || 0) / 100);
  const afterMargin = round2(materialsTotal + marginAmount);
  const taxAmount = round2(afterMargin * (Number(taxPct) || 0) / 100);
  return { materialsTotal, marginAmount, taxAmount, grandTotal: round2(afterMargin + taxAmount) };
}

/** First numeric token in a capacity label (“3KW”, “Size 5”, “10.5 kW”). */
export function parseCapacityNumber(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = String(label).match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Multiply package qty by capacity when the line is marked scale-by-capacity. */
export function qtyForCapacity(qty: number, scaleByCapacity: boolean, capacityLabel: string | null | undefined): number {
  if (!scaleByCapacity) return round3(qty);
  const factor = parseCapacityNumber(capacityLabel);
  if (!factor) return round3(qty);
  return round3(qty * factor);
}

/**
 * Spread BOM margin into explode line rates so invoice taxable ≈ materials + margin.
 * Lines without amount keep their rate unchanged.
 */
export function applyMarginToExplodeRates(
  lines: ReadonlyArray<{ qty: number; rate: number }>,
  marginAmount: number,
): number[] {
  const materials = round2(lines.reduce((s, l) => s + round2(round3(l.qty) * round2(l.rate)), 0));
  if (!(materials > 0) || !(marginAmount > 0)) return lines.map((l) => round2(l.rate));
  const factor = (materials + marginAmount) / materials;
  return lines.map((l) => round2(l.rate * factor));
}

export type BomAvailabilityLine = {
  itemId: string;
  name: string;
  unit: string;
  need: number;
  have: number;
  shortfall: number;
};

/** Aggregate stock-linked BOM lines vs current on-hand. */
export async function computeBomAvailability(
  db: Queryable,
  tenantId: number,
  lines: ReadonlyArray<{ lineKind: string; itemId: string | null; description: string; qty: number; unit: string }>,
): Promise<BomAvailabilityLine[]> {
  const need = new Map<string, { qty: number; name: string; unit: string }>();
  for (const l of lines) {
    if (l.lineKind !== "stock" || !l.itemId || !(l.qty > 0)) continue;
    const cur = need.get(l.itemId) ?? { qty: 0, name: l.description, unit: l.unit || "nos" };
    cur.qty = round3(cur.qty + l.qty);
    need.set(l.itemId, cur);
  }
  if (!need.size) return [];
  const ids = [...need.keys()];
  const params: Record<string, unknown> = { tenantId };
  const inList = ids.map((id, i) => {
    params[`i${i}`] = id;
    return `:i${i}`;
  });
  const items = await rows<{ id: string; name: string; unit: string; current_stock: string }>(
    db,
    `SELECT id, name, unit, current_stock FROM ims_items WHERE tenant_id = :tenantId AND id IN (${inList.join(",")})`,
    params,
  );
  const have = new Map(items.map((i) => [i.id, i]));
  return ids.map((itemId) => {
    const n = need.get(itemId)!;
    const item = have.get(itemId);
    const onHand = item ? round3(money(item.current_stock)) : 0;
    const shortfall = round3(Math.max(0, n.qty - onHand));
    return {
      itemId,
      name: item?.name ?? n.name,
      unit: item?.unit ?? n.unit,
      need: n.qty,
      have: onHand,
      shortfall,
    };
  });
}

export function bomHasShortfall(items: ReadonlyArray<BomAvailabilityLine>): boolean {
  return items.some((i) => i.shortfall > 0);
}

const lineKindZ = z.enum(BOM_LINE_KINDS);
const pctZ = z.coerce.number().min(0).max(999);

const pkgLineInput = z.object({
  id: z.string().uuid().optional(),
  section: z.string().trim().min(1).max(80).default("Main Items"),
  sortNo: z.coerce.number().int().min(0).max(99999).optional(),
  lineKind: lineKindZ.default("stock"),
  itemId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(500),
  makeText: optText(200),
  qty: z.coerce.number().min(0).max(1e9),
  unit: z.string().trim().min(1).max(24).default("nos"),
  scaleByCapacity: z.boolean().optional(),
  defaultRate: z.coerce.number().min(0).max(1e12).default(0),
  remarks: optText(500),
  active: z.boolean().optional(),
});

const packageInput = z.object({
  code: optText(40),
  name: z.string().trim().min(1).max(200),
  capacityLabel: optText(120),
  description: optText(4000),
  defaultMarginPct: pctZ.default(0),
  defaultTaxPct: pctZ.default(0),
  active: z.boolean().optional(),
  lines: z.array(pkgLineInput).max(500).optional(),
});

const docLineInput = z.object({
  id: z.string().uuid().optional(),
  section: z.string().trim().min(1).max(80).default("Main Items"),
  sortNo: z.coerce.number().int().min(0).max(99999).optional(),
  lineKind: lineKindZ.default("stock"),
  itemId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(500),
  makeText: optText(200),
  qty: z.coerce.number().min(0).max(1e9),
  unit: z.string().trim().min(1).max(24).default("nos"),
  scaleByCapacity: z.boolean().optional(),
  rate: z.coerce.number().min(0).max(1e12).default(0),
  remarks: optText(500),
});

const docInput = z.object({
  packageId: z.string().uuid().nullable().optional(),
  docDate: isoDate.optional(),
  capacityLabel: optText(120),
  title: optText(240),
  customerName: z.string().trim().max(200).default(""),
  location: optText(240),
  partyId: z.string().uuid().nullable().optional(),
  marginPct: pctZ.default(0),
  taxPct: pctZ.default(0),
  notes: optText(4000),
  preparedBy: optText(120),
  lines: z.array(docLineInput).max(500).optional(),
});

async function loadPkgLines(db: Queryable, tenantId: number, packageId: string): Promise<BomPackageLine[]> {
  const list = await rows<PkgLineRow>(
    db,
    `SELECT l.*, i.name AS item_name, i.sku AS item_sku, i.unit AS item_unit, i.selling_price
     FROM ims_bom_package_lines l
     LEFT JOIN ims_items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
     WHERE l.tenant_id = :tenantId AND l.package_id = :packageId
     ORDER BY l.sort_no ASC, l.created_at ASC`,
    { tenantId, packageId },
  );
  return list.map(mapPkgLine);
}

async function loadPackage(db: Queryable, tenantId: number, id: string): Promise<BomPackage | null> {
  const r = await one<PkgRow>(db, `SELECT * FROM ims_bom_packages WHERE tenant_id = :tenantId AND id = :id LIMIT 1`, { tenantId, id });
  if (!r) return null;
  return mapPackage(r, await loadPkgLines(db, tenantId, id));
}

async function loadDocLines(db: Queryable, tenantId: number, docId: string): Promise<BomDocLine[]> {
  const list = await rows<DocLineRow>(
    db,
    `SELECT l.*, i.name AS item_name, i.sku AS item_sku
     FROM ims_bom_doc_lines l
     LEFT JOIN ims_items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
     WHERE l.tenant_id = :tenantId AND l.doc_id = :docId
     ORDER BY l.sort_no ASC, l.created_at ASC`,
    { tenantId, docId },
  );
  return list.map(mapDocLine);
}

async function loadDoc(db: Queryable, tenantId: number, id: string): Promise<BomDoc | null> {
  const r = await one<DocRow>(db, `SELECT * FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1`, { tenantId, id });
  if (!r) return null;
  return mapDoc(r, await loadDocLines(db, tenantId, id));
}

async function replacePkgLines(
  db: Queryable,
  tenantId: number,
  packageId: string,
  lines: z.infer<typeof pkgLineInput>[],
): Promise<void> {
  await exec(db, `DELETE FROM ims_bom_package_lines WHERE tenant_id = :tenantId AND package_id = :packageId`, { tenantId, packageId });
  let sort = 0;
  for (const l of lines) {
    await exec(
      db,
      `INSERT INTO ims_bom_package_lines
        (id, tenant_id, package_id, section, sort_no, line_kind, item_id, description, make_text, qty, unit, scale_by_capacity, default_rate, remarks, active)
       VALUES
        (:id, :tenantId, :packageId, :section, :sortNo, :lineKind, :itemId, :description, :makeText, :qty, :unit, :scaleByCapacity, :defaultRate, :remarks, :active)`,
      {
        id: l.id ?? randomUUID(),
        tenantId,
        packageId,
        section: l.section,
        sortNo: l.sortNo ?? sort,
        lineKind: l.lineKind,
        itemId: l.itemId ?? null,
        description: l.description,
        makeText: l.makeText ?? null,
        qty: round3(l.qty),
        unit: l.unit,
        scaleByCapacity: l.scaleByCapacity ? 1 : 0,
        defaultRate: round2(l.defaultRate),
        remarks: l.remarks ?? null,
        active: l.active === false ? 0 : 1,
      },
    );
    sort += 1;
  }
}

async function replaceDocLines(
  db: Queryable,
  tenantId: number,
  docId: string,
  lines: z.infer<typeof docLineInput>[],
): Promise<BomTotals> {
  await exec(db, `DELETE FROM ims_bom_doc_lines WHERE tenant_id = :tenantId AND doc_id = :docId`, { tenantId, docId });
  const normalized = lines.map((l, i) => {
    const qty = round3(l.qty);
    const rate = round2(l.rate);
    return { ...l, qty, rate, amount: round2(qty * rate), sortNo: l.sortNo ?? i };
  });
  for (const l of normalized) {
    await exec(
      db,
      `INSERT INTO ims_bom_doc_lines
        (id, tenant_id, doc_id, section, sort_no, line_kind, item_id, description, make_text, qty, unit, scale_by_capacity, rate, amount, remarks)
       VALUES
        (:id, :tenantId, :docId, :section, :sortNo, :lineKind, :itemId, :description, :makeText, :qty, :unit, :scaleByCapacity, :rate, :amount, :remarks)`,
      {
        id: l.id ?? randomUUID(),
        tenantId,
        docId,
        section: l.section,
        sortNo: l.sortNo,
        lineKind: l.lineKind,
        itemId: l.itemId ?? null,
        description: l.description,
        makeText: l.makeText ?? null,
        qty: l.qty,
        unit: l.unit,
        scaleByCapacity: l.scaleByCapacity ? 1 : 0,
        rate: l.rate,
        amount: l.amount,
        remarks: l.remarks ?? null,
      },
    );
  }
  return computeBomTotals(normalized, 0, 0);
}

/** Industry-neutral starter templates (not tied to any one vertical). */
function samplePackages() {
  const small = {
    code: "PKG-S",
    name: "Sample package — Small",
    capacityLabel: "Size S",
    description: "Starter template. Replace lines with your own catalogue items, services and rates.",
    defaultMarginPct: 10,
    defaultTaxPct: 18,
    lines: [
      { section: "Main Items", lineKind: "stock" as const, description: "Primary component / finished good", makeText: "Brand A / Brand B", qty: 1, unit: "nos", defaultRate: 0 },
      { section: "Main Items", lineKind: "stock" as const, description: "Secondary component", makeText: "Reputed make", qty: 2, unit: "nos", defaultRate: 0 },
      { section: "Main Items", lineKind: "stock" as const, description: "Cable / consumable (length)", makeText: "Reputed make", qty: 50, unit: "mtr", defaultRate: 0 },
      { section: "Accessories & Services", lineKind: "stock" as const, description: "Fasteners / fittings pack", makeText: "Reputed make", qty: 1, unit: "pack", defaultRate: 0 },
      { section: "Accessories & Services", lineKind: "service" as const, description: "Installation / labour", makeText: "In-house / third party", qty: 1, unit: "job", defaultRate: 0 },
      { section: "Accessories & Services", lineKind: "overhead" as const, description: "Transport & handling", makeText: "Own", qty: 1, unit: "job", defaultRate: 0 },
      { section: "Accessories & Services", lineKind: "scaled" as const, description: "Capacity-scaled allowance", makeText: "Own", qty: 1, unit: "unit", scaleByCapacity: true, defaultRate: 0 },
    ],
  };
  const large = {
    ...small,
    code: "PKG-L",
    name: "Sample package — Large",
    capacityLabel: "Size L",
    lines: small.lines.map((l) => ({ ...l, qty: l.unit === "mtr" ? 120 : l.qty === 1 && l.lineKind === "stock" && l.description.startsWith("Primary") ? 1 : l.qty * (l.lineKind === "stock" && l.unit === "nos" && l.description.startsWith("Secondary") ? 2 : 1) })),
  };
  // Fix large secondary qty explicitly
  large.lines = [
    { section: "Main Items", lineKind: "stock" as const, description: "Primary component / finished good", makeText: "Brand A / Brand B", qty: 1, unit: "nos", defaultRate: 0 },
    { section: "Main Items", lineKind: "stock" as const, description: "Secondary component", makeText: "Reputed make", qty: 4, unit: "nos", defaultRate: 0 },
    { section: "Main Items", lineKind: "stock" as const, description: "Cable / consumable (length)", makeText: "Reputed make", qty: 120, unit: "mtr", defaultRate: 0 },
    { section: "Accessories & Services", lineKind: "stock" as const, description: "Fasteners / fittings pack", makeText: "Reputed make", qty: 2, unit: "pack", defaultRate: 0 },
    { section: "Accessories & Services", lineKind: "service" as const, description: "Installation / labour", makeText: "In-house / third party", qty: 1, unit: "job", defaultRate: 0 },
    { section: "Accessories & Services", lineKind: "overhead" as const, description: "Transport & handling", makeText: "Own", qty: 1, unit: "job", defaultRate: 0 },
    { section: "Accessories & Services", lineKind: "scaled" as const, description: "Capacity-scaled allowance", makeText: "Own", qty: 1, unit: "unit", scaleByCapacity: true, defaultRate: 0 },
  ];
  return [small, large];
}

export function registerBom(router: Router, deps: ImsDeps): void {
  /* ---------- Packages ---------- */

  router.get("/bom/packages", async (req, res) => {
    requireAnyPerm(res, ["bom", "bomPackages"]);
    const actor = actorOf(res);
    const q = qstr(req.query.q, 80);
    const activeOnly = String(req.query.active ?? "1") !== "0";
    const limit = qint(req.query.limit, 100, 1, 500);
    const params: Record<string, unknown> = { tenantId: actor.tenantId, limit };
    let where = `tenant_id = :tenantId`;
    if (activeOnly) where += ` AND active = 1`;
    if (q) {
      where += ` AND (name LIKE :q OR IFNULL(code,'') LIKE :q OR IFNULL(capacity_label,'') LIKE :q)`;
      params.q = likeOf(q);
    }
    const list = await rows<PkgRow & { line_count: number }>(
      deps.db,
      `SELECT p.*, (SELECT COUNT(*) FROM ims_bom_package_lines l WHERE l.tenant_id = p.tenant_id AND l.package_id = p.id AND l.active = 1) AS line_count
       FROM ims_bom_packages p
       WHERE ${where}
       ORDER BY p.name ASC
       LIMIT ${limit}`,
      params,
    );
    res.json({ packages: list.map((r) => mapPackage(r)), invoiceConvertModes: BOM_INVOICE_CONVERT_MODES });
  });

  router.get("/bom/packages/:id", async (req, res) => {
    requireAnyPerm(res, ["bom", "bomPackages"]);
    const pkg = await loadPackage(deps.db, actorOf(res).tenantId, String(req.params.id));
    if (!pkg) throw notFound("Package not found");
    res.json({ package: pkg });
  });

  router.post("/bom/packages", async (req, res) => {
    requirePerm(res, "bomPackages");
    const actor = actorOf(res);
    const body = parse(packageInput, req.body);
    const id = randomUUID();
    await tx(deps.db, async (conn) => {
      await exec(
        conn,
        `INSERT INTO ims_bom_packages
          (id, tenant_id, code, name, capacity_label, description, default_margin_pct, default_tax_pct, active, created_by, created_by_name)
         VALUES
          (:id, :tenantId, :code, :name, :capacityLabel, :description, :defaultMarginPct, :defaultTaxPct, :active, :createdBy, :createdByName)`,
        {
          id,
          tenantId: actor.tenantId,
          code: body.code || null,
          name: body.name,
          capacityLabel: body.capacityLabel ?? null,
          description: body.description ?? null,
          defaultMarginPct: body.defaultMarginPct,
          defaultTaxPct: body.defaultTaxPct,
          active: body.active === false ? 0 : 1,
          createdBy: actor.userId,
          createdByName: actor.name ?? actor.email ?? null,
        },
      );
      if (body.lines?.length) await replacePkgLines(conn, actor.tenantId, id, body.lines);
    });
    await recordEvent(deps, actor, { type: "bom.package.created", entityType: "bom_package", entityId: id, summary: `Created BOM package ${body.name}`, payload: { name: body.name } });
    res.status(201).json({ package: await loadPackage(deps.db, actor.tenantId, id) });
  });

  router.put("/bom/packages/:id", async (req, res) => {
    requirePerm(res, "bomPackages");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const existing = await loadPackage(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("Package not found");
    const body = parse(packageInput, req.body);
    await tx(deps.db, async (conn) => {
      await exec(
        conn,
        `UPDATE ims_bom_packages SET
          code = :code, name = :name, capacity_label = :capacityLabel, description = :description,
          default_margin_pct = :defaultMarginPct, default_tax_pct = :defaultTaxPct, active = :active
         WHERE tenant_id = :tenantId AND id = :id`,
        {
          id,
          tenantId: actor.tenantId,
          code: body.code || null,
          name: body.name,
          capacityLabel: body.capacityLabel ?? null,
          description: body.description ?? null,
          defaultMarginPct: body.defaultMarginPct,
          defaultTaxPct: body.defaultTaxPct,
          active: body.active === false ? 0 : 1,
        },
      );
      if (body.lines) await replacePkgLines(conn, actor.tenantId, id, body.lines);
    });
    await recordEvent(deps, actor, { type: "bom.package.updated", entityType: "bom_package", entityId: id, summary: `Updated BOM package ${body.name}`, payload: { name: body.name } });
    res.json({ package: await loadPackage(deps.db, actor.tenantId, id) });
  });

  router.patch("/bom/packages/:id", async (req, res) => {
    requirePerm(res, "bomPackages");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const existing = await one<PkgRow>(deps.db, `SELECT * FROM ims_bom_packages WHERE tenant_id = :tenantId AND id = :id LIMIT 1`, { tenantId: actor.tenantId, id });
    if (!existing) throw notFound("Package not found");
    const patch = parsePatch(packageInput.omit({ lines: true }), req.body);
    const fields: string[] = [];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, id };
    const map: Record<string, string> = {
      code: "code",
      name: "name",
      capacityLabel: "capacity_label",
      description: "description",
      defaultMarginPct: "default_margin_pct",
      defaultTaxPct: "default_tax_pct",
      active: "active",
    };
    for (const [k, col] of Object.entries(map)) {
      if ((patch as Record<string, unknown>)[k] === undefined) continue;
      let v = (patch as Record<string, unknown>)[k];
      if (k === "active") v = v ? 1 : 0;
      if (k === "code" && v === "") v = null;
      fields.push(`${col} = :${k}`);
      params[k] = v;
    }
    if (fields.length) {
      await exec(deps.db, `UPDATE ims_bom_packages SET ${fields.join(", ")} WHERE tenant_id = :tenantId AND id = :id`, params);
    }
    res.json({ package: await loadPackage(deps.db, actor.tenantId, id) });
  });

  router.delete("/bom/packages/:id", async (req, res) => {
    requirePerm(res, "bomPackages");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const existing = await loadPackage(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("Package not found");
    const referenced = await one<{ id: string }>(
      deps.db,
      `SELECT id FROM ims_bom_docs WHERE tenant_id = :tenantId AND package_id = :id LIMIT 1`,
      { tenantId: actor.tenantId, id },
    );
    if (referenced) {
      // Keep package_id lineage on historical BOMs — deactivate instead of hard-delete.
      await exec(deps.db, `UPDATE ims_bom_packages SET active = 0 WHERE tenant_id = :tenantId AND id = :id`, {
        tenantId: actor.tenantId,
        id,
      });
      await recordEvent(deps, actor, {
        type: "bom.package.deactivated",
        entityType: "bom_package",
        entityId: id,
        summary: `Deactivated BOM package ${existing.name} (still referenced by documents)`,
        payload: { name: existing.name },
      });
      res.json({ package: await loadPackage(deps.db, actor.tenantId, id), deactivated: true });
      return;
    }
    await tx(deps.db, async (conn) => {
      await exec(conn, `DELETE FROM ims_bom_package_lines WHERE tenant_id = :tenantId AND package_id = :id`, { tenantId: actor.tenantId, id });
      await exec(conn, `DELETE FROM ims_bom_packages WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id });
    });
    await recordEvent(deps, actor, { type: "bom.package.deleted", entityType: "bom_package", entityId: id, summary: `Deleted BOM package ${existing.name}`, payload: { name: existing.name } });
    res.status(204).end();
  });

  router.post("/bom/packages/:id/duplicate", async (req, res) => {
    requirePerm(res, "bomPackages");
    const actor = actorOf(res);
    const src = await loadPackage(deps.db, actor.tenantId, String(req.params.id));
    if (!src) throw notFound("Package not found");
    const id = randomUUID();
    const name = `${src.name} (copy)`.slice(0, 160);
    let code: string | null = null;
    if (src.code) {
      for (let n = 1; n <= 50; n++) {
        const candidate = `${src.code}-COPY${n === 1 ? "" : n}`.slice(0, 40);
        const taken = await one<{ id: string }>(
          deps.db,
          `SELECT id FROM ims_bom_packages WHERE tenant_id = :tenantId AND code = :code LIMIT 1`,
          { tenantId: actor.tenantId, code: candidate },
        );
        if (!taken) {
          code = candidate;
          break;
        }
      }
      if (!code) {
        code = `${src.code.slice(0, 28)}-${randomUUID().slice(0, 8)}`.slice(0, 40);
      }
    }
    await tx(deps.db, async (conn) => {
      await exec(
        conn,
        `INSERT INTO ims_bom_packages
          (id, tenant_id, code, name, capacity_label, description, default_margin_pct, default_tax_pct, active, created_by, created_by_name)
         VALUES
          (:id, :tenantId, :code, :name, :capacityLabel, :description, :defaultMarginPct, :defaultTaxPct, 1, :createdBy, :createdByName)`,
        {
          id,
          tenantId: actor.tenantId,
          code,
          name,
          capacityLabel: src.capacityLabel,
          description: src.description,
          defaultMarginPct: src.defaultMarginPct,
          defaultTaxPct: src.defaultTaxPct,
          createdBy: actor.userId,
          createdByName: actor.name ?? actor.email ?? null,
        },
      );
      await replacePkgLines(
        conn,
        actor.tenantId,
        id,
        (src.lines ?? []).map((l) => ({
          section: l.section,
          lineKind: l.lineKind,
          itemId: l.itemId,
          description: l.description,
          makeText: l.makeText,
          qty: l.qty,
          unit: l.unit,
          scaleByCapacity: l.scaleByCapacity,
          defaultRate: l.defaultRate,
          remarks: l.remarks,
        })),
      );
    });
    await recordEvent(deps, actor, {
      type: "bom.package.duplicated",
      entityType: "bom_package",
      entityId: id,
      summary: `Duplicated BOM package ${src.name}`,
      payload: { fromId: src.id, name },
    });
    res.status(201).json({ package: await loadPackage(deps.db, actor.tenantId, id) });
  });

  router.post("/bom/packages/seed-samples", async (_req, res) => {
    requirePerm(res, "bomPackages");
    const ctx = getRequestContext();
    const features = ctx ? await getOrgFeatureSwitches(ctx.organizationId) : null;
    if (!features?.["ims.bom.sample_templates"]) {
      throw forbidden("Sample BOM templates are turned off. An admin can enable them in Admin → Tools → Justx IMS — Dealer → Switches.");
    }
    const actor = actorOf(res);
    const created: BomPackage[] = [];
    await tx(deps.db, async (conn) => {
      for (const sample of samplePackages()) {
        const existing = await one<{ id: string }>(conn, `SELECT id FROM ims_bom_packages WHERE tenant_id = :tenantId AND code = :code LIMIT 1`, {
          tenantId: actor.tenantId,
          code: sample.code,
        });
        if (existing) continue;
        const id = randomUUID();
        await exec(
          conn,
          `INSERT INTO ims_bom_packages
            (id, tenant_id, code, name, capacity_label, description, default_margin_pct, default_tax_pct, active, created_by, created_by_name)
           VALUES
            (:id, :tenantId, :code, :name, :capacityLabel, :description, :defaultMarginPct, :defaultTaxPct, 1, :createdBy, :createdByName)`,
          {
            id,
            tenantId: actor.tenantId,
            code: sample.code,
            name: sample.name,
            capacityLabel: sample.capacityLabel,
            description: sample.description,
            defaultMarginPct: sample.defaultMarginPct,
            defaultTaxPct: sample.defaultTaxPct,
            createdBy: actor.userId,
            createdByName: actor.name ?? actor.email ?? null,
          },
        );
        await replacePkgLines(conn, actor.tenantId, id, sample.lines);
        created.push((await loadPackage(conn, actor.tenantId, id))!);
      }
    });
    if (created.length) await recordEvent(deps, actorOf(res), { type: "bom.package.seeded", entityType: "bom_package", entityId: created[0]!.id, summary: `Seeded ${created.length} sample BOM package(s)`, payload: { count: created.length } });
    res.status(201).json({ created: created.length, packages: created });
  });

  /* ---------- Documents ---------- */

  router.get("/bom/docs", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const q = qstr(req.query.q, 80);
    const status = qstr(req.query.status, 16);
    const invoice = qstr(req.query.invoice, 16); // linked | none
    const stock = qstr(req.query.stock, 16); // issued | pending
    const limit = qint(req.query.limit, 50, 1, 200);
    const offset = qint(req.query.offset, 0, 0, 100000);
    const params: Record<string, unknown> = { tenantId: actor.tenantId, limit, offset };
    let where = `tenant_id = :tenantId`;
    if (status && status !== "all") {
      where += ` AND status = :status`;
      params.status = status;
    }
    if (invoice === "linked") where += ` AND invoice_id IS NOT NULL`;
    else if (invoice === "none") where += ` AND invoice_id IS NULL`;
    if (stock === "issued") where += ` AND stock_issued_at IS NOT NULL`;
    else if (stock === "pending") where += ` AND stock_issued_at IS NULL AND status = 'confirmed'`;
    if (q) {
      where += ` AND (doc_no LIKE :q OR customer_name LIKE :q OR IFNULL(location,'') LIKE :q OR IFNULL(title,'') LIKE :q OR IFNULL(capacity_label,'') LIKE :q)`;
      params.q = likeOf(q);
    }
    const [list, countRow] = await Promise.all([
      rows<DocRow>(
        deps.db,
        `SELECT * FROM ims_bom_docs WHERE ${where} ORDER BY doc_date DESC, created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      one<{ n: number }>(deps.db, `SELECT COUNT(*) AS n FROM ims_bom_docs WHERE ${where}`, params),
    ]);
    res.json({ docs: list.map((r) => mapDoc(r)), total: Number(countRow?.n ?? 0), invoiceConvertModes: BOM_INVOICE_CONVERT_MODES });
  });

  router.get("/bom/docs/:id", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const doc = await loadDoc(deps.db, actor.tenantId, String(req.params.id));
    if (!doc) throw notFound("BOM document not found");
    const [settings, brand] = await Promise.all([getSettings(deps, actor.tenantId), deps.host.brand(actor.tenantId)]);
    let linkedInvoice: { id: string; status: string; stockPosted: boolean } | null = null;
    if (doc.invoiceId) {
      const inv = await one<{ id: string; status: string; stock_posted: number }>(
        deps.db,
        `SELECT id, status, stock_posted FROM ims_invoices WHERE tenant_id = :tenantId AND id = :id LIMIT 1`,
        { tenantId: actor.tenantId, id: doc.invoiceId },
      );
      if (inv) linkedInvoice = { id: inv.id, status: inv.status, stockPosted: Boolean(inv.stock_posted) };
    }
    res.json({
      doc,
      linkedInvoice,
      business: {
        name: settings.businessName,
        gstin: settings.gstin,
        address: settings.address,
        state: settings.state,
        phone: settings.phone,
        email: settings.email,
        logoUrl: brand.logoUrl ?? null,
      },
    });
  });

  router.post("/bom/docs", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const raw = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const body = parse(docInput, req.body);
    const settings = await getSettings(deps, actor.tenantId);
    let packageName: string | null = null;
    let lines = body.lines ?? [];
    let marginPct = body.marginPct;
    let taxPct = body.taxPct;
    let capacityLabel = body.capacityLabel ?? null;
    let title = body.title ?? null;

    if (body.packageId) {
      const pkg = await loadPackage(deps.db, actor.tenantId, body.packageId);
      if (!pkg || !pkg.active) throw notFound("Package not found or inactive");
      packageName = pkg.name;
      if (!capacityLabel && pkg.capacityLabel) capacityLabel = pkg.capacityLabel;
      if (!body.lines?.length) {
        lines = (pkg.lines ?? [])
          .filter((l) => l.active)
          .map((l) => ({
            section: l.section,
            lineKind: l.lineKind,
            itemId: l.itemId,
            description: l.description,
            makeText: l.makeText,
            qty: qtyForCapacity(l.qty, l.scaleByCapacity, capacityLabel),
            unit: l.unit,
            scaleByCapacity: l.scaleByCapacity,
            rate: l.defaultRate,
            remarks: l.remarks,
          }));
      }
      if (raw.marginPct === undefined || raw.marginPct === null || raw.marginPct === "") marginPct = pkg.defaultMarginPct;
      if (raw.taxPct === undefined || raw.taxPct === null || raw.taxPct === "") taxPct = pkg.defaultTaxPct;
      if (!title) title = pkg.name;
    }

    if (!lines.length) throw conflict("Add at least one line, or start from a package template");

    const docDate = body.docDate ?? todayISO();
    const id = randomUUID();
    const totals = computeBomTotals(
      lines.map((l) => ({ qty: l.qty, rate: l.rate })),
      marginPct,
      taxPct,
    );

    await tx(deps.db, async (conn) => {
      const docNo = await nextDocNo(conn, actor.tenantId, "bom", "BOM", docDate, settings.fiscalYearStart);
      await exec(
        conn,
        `INSERT INTO ims_bom_docs
          (id, tenant_id, package_id, package_name, doc_no, status, doc_date, capacity_label, title,
           customer_name, location, party_id, margin_pct, tax_pct, materials_total, margin_amount, tax_amount, grand_total,
           notes, prepared_by, created_by, created_by_name)
         VALUES
          (:id, :tenantId, :packageId, :packageName, :docNo, 'draft', :docDate, :capacityLabel, :title,
           :customerName, :location, :partyId, :marginPct, :taxPct, :materialsTotal, :marginAmount, :taxAmount, :grandTotal,
           :notes, :preparedBy, :createdBy, :createdByName)`,
        {
          id,
          tenantId: actor.tenantId,
          packageId: body.packageId ?? null,
          packageName,
          docNo,
          docDate,
          capacityLabel,
          title,
          customerName: body.customerName || "",
          location: body.location ?? null,
          partyId: body.partyId ?? null,
          marginPct,
          taxPct,
          materialsTotal: totals.materialsTotal,
          marginAmount: totals.marginAmount,
          taxAmount: totals.taxAmount,
          grandTotal: totals.grandTotal,
          notes: body.notes ?? null,
          preparedBy: body.preparedBy ?? actor.name ?? actor.email ?? null,
          createdBy: actor.userId,
          createdByName: actor.name ?? actor.email ?? null,
        },
      );
      const lineTotals = await replaceDocLines(conn, actor.tenantId, id, lines);
      const full = computeBomTotals(lines.map((l) => ({ qty: l.qty, rate: l.rate })), marginPct, taxPct);
      if (lineTotals.materialsTotal !== full.materialsTotal) {
        /* amounts already stored per line; refresh header totals */
      }
      await exec(
        conn,
        `UPDATE ims_bom_docs SET materials_total = :materialsTotal, margin_amount = :marginAmount, tax_amount = :taxAmount, grand_total = :grandTotal
         WHERE tenant_id = :tenantId AND id = :id`,
        { tenantId: actor.tenantId, id, ...full },
      );
    });

    await recordEvent(deps, actor, { type: "bom.doc.created", entityType: "bom_doc", entityId: id, summary: `Created BOM ${body.customerName || "draft"}`, payload: { customer: body.customerName } });
    res.status(201).json({ doc: await loadDoc(deps.db, actor.tenantId, id) });
  });

  router.put("/bom/docs/:id", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const existing = await loadDoc(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("BOM document not found");
    if (existing.status !== "draft") throw conflict("Only draft BOMs can be edited");
    const body = parse(docInput, req.body);
    const lines = body.lines ?? existing.lines ?? [];
    if (!lines.length) throw conflict("Add at least one line");
    const totals = computeBomTotals(
      lines.map((l) => ({ qty: l.qty, rate: l.rate })),
      body.marginPct,
      body.taxPct,
    );
    await tx(deps.db, async (conn) => {
      await exec(
        conn,
        `UPDATE ims_bom_docs SET
          package_id = :packageId, doc_date = :docDate, capacity_label = :capacityLabel, title = :title,
          customer_name = :customerName, location = :location, party_id = :partyId,
          margin_pct = :marginPct, tax_pct = :taxPct,
          materials_total = :materialsTotal, margin_amount = :marginAmount, tax_amount = :taxAmount, grand_total = :grandTotal,
          notes = :notes, prepared_by = :preparedBy
         WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`,
        {
          id,
          tenantId: actor.tenantId,
          packageId: body.packageId ?? existing.packageId,
          docDate: body.docDate ?? existing.docDate,
          capacityLabel: body.capacityLabel ?? null,
          title: body.title ?? null,
          customerName: body.customerName || "",
          location: body.location ?? null,
          partyId: body.partyId ?? null,
          marginPct: body.marginPct,
          taxPct: body.taxPct,
          materialsTotal: totals.materialsTotal,
          marginAmount: totals.marginAmount,
          taxAmount: totals.taxAmount,
          grandTotal: totals.grandTotal,
          notes: body.notes ?? null,
          preparedBy: body.preparedBy ?? existing.preparedBy,
        },
      );
      await replaceDocLines(conn, actor.tenantId, id, lines);
    });
    await recordEvent(deps, actor, { type: "bom.doc.updated", entityType: "bom_doc", entityId: id, summary: "Updated BOM document" });
    res.json({ doc: await loadDoc(deps.db, actor.tenantId, id) });
  });

  router.post("/bom/docs/:id/confirm", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const existing = await loadDoc(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("BOM document not found");
    if (existing.status !== "draft") throw conflict("Only drafts can be confirmed");
    if (!existing.customerName.trim()) throw conflict("Customer name is required before confirming");
    if (!existing.lines?.length) throw conflict("Add at least one line before confirming");
    await exec(deps.db, `UPDATE ims_bom_docs SET status = 'confirmed' WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id });
    await recordEvent(deps, actor, { type: "bom.doc.confirmed", entityType: "bom_doc", entityId: id, summary: `Confirmed ${existing.docNo}`, payload: { docNo: existing.docNo } });
    res.json({ doc: await loadDoc(deps.db, actor.tenantId, id) });
  });

  router.post("/bom/docs/:id/reopen", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const existing = await loadDoc(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("BOM document not found");
    if (existing.status !== "confirmed") throw conflict("Only confirmed BOMs can be reopened");
    if (existing.invoiceId) throw conflict("This BOM is linked to an invoice and can't be reopened");
    if (existing.stockIssuedAt) throw conflict("Materials were already issued from this BOM — it can't be reopened");
    await exec(deps.db, `UPDATE ims_bom_docs SET status = 'draft' WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id });
    await recordEvent(deps, actor, { type: "bom.doc.reopened", entityType: "bom_doc", entityId: id, summary: `Reopened ${existing.docNo}`, payload: { docNo: existing.docNo } });
    res.json({ doc: await loadDoc(deps.db, actor.tenantId, id) });
  });

  router.post("/bom/docs/:id/cancel", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const existing = await loadDoc(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("BOM document not found");
    if (existing.status === "cancelled") throw conflict("Already cancelled");
    if (existing.invoiceId) throw conflict("This BOM is linked to an invoice and can't be cancelled");
    if (existing.stockIssuedAt) throw conflict("Materials were already issued from this BOM — it can't be cancelled");
    await exec(deps.db, `UPDATE ims_bom_docs SET status = 'cancelled' WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id });
    await recordEvent(deps, actor, { type: "bom.doc.cancelled", entityType: "bom_doc", entityId: id, summary: `Cancelled ${existing.docNo}`, payload: { docNo: existing.docNo } });
    res.json({ doc: await loadDoc(deps.db, actor.tenantId, id) });
  });

  router.delete("/bom/docs/:id", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const existing = await loadDoc(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("BOM document not found");
    if (existing.status !== "draft") throw conflict("Only draft BOMs can be deleted");
    await tx(deps.db, async (conn) => {
      await exec(conn, `DELETE FROM ims_bom_doc_lines WHERE tenant_id = :tenantId AND doc_id = :id`, { tenantId: actor.tenantId, id });
      await exec(conn, `DELETE FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id });
    });
    await recordEvent(deps, actor, { type: "bom.doc.deleted", entityType: "bom_doc", entityId: id, summary: `Deleted ${existing.docNo}`, payload: { docNo: existing.docNo } });
    res.status(204).end();
  });

  /* ---------- P3: invoice convert + stock issue ---------- */

  router.post("/bom/docs/:id/create-invoice", async (req, res) => {
    requirePerm(res, "bom");
    requirePerm(res, "sales");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const body = parse(
      z.object({
        mode: z.enum(BOM_INVOICE_CONVERT_MODES),
        issue: z.boolean().optional(),
        gstRate: z.coerce.number().min(0).max(100).optional(),
        invoiceDate: isoDate.optional(),
      }),
      req.body,
    );
    if (body.issue && body.mode === "explode_lines") requirePerm(res, "stockOut");

    const doc = await loadDoc(deps.db, actor.tenantId, id);
    if (!doc) throw notFound("BOM document not found");
    if (doc.status !== "confirmed") throw conflict("Confirm the BOM before creating an invoice");
    if (doc.invoiceId) throw conflict("This BOM already has an invoice. Open it from Sales.");
    if (!doc.customerName.trim()) throw conflict("Customer name is required");
    if (!doc.lines?.length) throw conflict("BOM has no lines");
    if (body.issue && body.mode === "explode_lines" && doc.stockIssuedAt) {
      throw conflict("Materials were already issued from this BOM. Create a draft explode invoice, or use lump-sum billing.");
    }

    const settings = await getSettings(deps, actor.tenantId);
    if (body.issue && body.mode === "explode_lines" && !settings.allowNegativeStock) {
      const availability = await computeBomAvailability(deps.db, actor.tenantId, doc.lines ?? []);
      if (bomHasShortfall(availability)) {
        const tip = availability
          .filter((a) => a.shortfall > 0)
          .slice(0, 3)
          .map((a) => `${a.name} (need ${a.need}, have ${a.have})`)
          .join("; ");
        throw conflict(`Insufficient stock to issue this explode invoice. ${tip}`);
      }
    }
    const gstRate = body.gstRate ?? (doc.taxPct > 0 ? doc.taxPct : settings.defaultGstRate);
    const invoiceDate = body.invoiceDate ?? doc.docDate ?? todayISO();

    const itemIds = [...new Set(doc.lines.map((l) => l.itemId).filter((x): x is string => Boolean(x)))];
    const itemMeta = new Map<string, { hsn: string | null; sku: string | null; unit: string; gst: number; name: string }>();
    if (itemIds.length) {
      const params: Record<string, unknown> = { tenantId: actor.tenantId };
      const inList = itemIds.map((iid, i) => {
        params[`i${i}`] = iid;
        return `:i${i}`;
      });
      const items = await rows<{ id: string; name: string; sku: string | null; hsn: string | null; unit: string; gst_rate: string }>(
        deps.db,
        `SELECT id, name, sku, hsn, unit, gst_rate FROM ims_items WHERE tenant_id = :tenantId AND id IN (${inList.join(",")})`,
        params,
      );
      for (const it of items) {
        itemMeta.set(it.id, { name: it.name, sku: it.sku, hsn: it.hsn, unit: it.unit, gst: money(it.gst_rate) });
      }
    }

    let lines: ImsLineInput[];
    if (body.mode === "lump_sum") {
      const taxable = round2(doc.materialsTotal + doc.marginAmount);
      if (taxable <= 0 && doc.grandTotal <= 0) throw badRequest("BOM total must be more than zero");
      lines = [
        {
          itemId: null,
          name: (doc.title || doc.packageName || doc.capacityLabel || "Package supply").slice(0, 200),
          sku: null,
          hsn: null,
          unit: "job",
          qty: 1,
          rate: taxable > 0 ? taxable : doc.grandTotal,
          discountPct: 0,
          gstRate,
        },
      ];
    } else {
      const billable = doc.lines.filter((l) => l.qty > 0);
      const inflatedRates = applyMarginToExplodeRates(
        billable.map((l) => ({ qty: l.qty, rate: l.rate })),
        doc.marginAmount,
      );
      lines = billable.map((l, i) => {
        const meta = l.itemId ? itemMeta.get(l.itemId) : null;
        const desc = l.makeText ? `${l.description} (${l.makeText})` : l.description;
        return {
          itemId: l.lineKind === "stock" ? l.itemId : null,
          name: desc.slice(0, 200),
          sku: meta?.sku ?? null,
          hsn: meta?.hsn ?? null,
          unit: l.unit || meta?.unit || "nos",
          qty: l.qty,
          rate: inflatedRates[i] ?? l.rate,
          discountPct: 0,
          gstRate: meta && meta.gst > 0 ? meta.gst : gstRate,
        };
      });
      if (!lines.length) throw badRequest("No billable lines on this BOM");
    }

    const notes = [
      `From BOM ${doc.docNo}`,
      doc.capacityLabel ? `Package: ${doc.capacityLabel}` : null,
      doc.location ? `Site: ${doc.location}` : null,
      body.mode === "explode_lines" && doc.marginAmount > 0 ? `Margin ${doc.marginPct}% (₹${doc.marginAmount}) spread across line rates` : null,
      doc.notes,
    ]
      .filter(Boolean)
      .join("\n");

    const stockLineCount = doc.lines.filter((l) => l.lineKind === "stock" && l.itemId && l.qty > 0).length;
    const invoice = await createLinkedInvoice(
      deps,
      actor,
      {
        customerId: doc.partyId,
        customerName: doc.customerName.trim(),
        // Billing address comes from the party; site stays in notes only.
        customerAddress: null,
        invoiceDate,
        lines,
        roundToRupee: true,
        notes,
        issue: Boolean(body.issue),
        sourceTool: "ims_bom",
        sourceRef: doc.id,
      },
      {
        before: async (conn) => {
          const locked = await one<{ id: string; status: string; invoice_id: string | null; stock_issued_at: string | null }>(
            conn,
            `SELECT id, status, invoice_id, stock_issued_at FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
            { tenantId: actor.tenantId, id },
          );
          if (!locked) throw notFound("BOM document not found");
          if (locked.status !== "confirmed") throw conflict("Confirm the BOM before creating an invoice");
          if (locked.invoice_id) throw conflict("This BOM already has an invoice. Open it from Sales.");
          if (body.issue && body.mode === "explode_lines" && locked.stock_issued_at) {
            throw conflict("Materials were already issued from this BOM. Create a draft explode invoice, or use lump-sum billing.");
          }
        },
        after: async (conn, invoiceId) => {
          const linked = await exec(
            conn,
            `UPDATE ims_bom_docs SET invoice_id = :invoiceId, invoice_convert_mode = :mode
             WHERE tenant_id = :tenantId AND id = :id AND invoice_id IS NULL`,
            { tenantId: actor.tenantId, id, invoiceId, mode: body.mode },
          );
          if (!linked.affectedRows) {
            throw conflict("Another invoice was linked to this BOM at the same time. Open Sales and check recent drafts.");
          }
          if (body.issue && body.mode === "explode_lines" && stockLineCount > 0) {
            const inv = await one<{ stock_posted: number }>(
              conn,
              `SELECT stock_posted FROM ims_invoices WHERE tenant_id = :tenantId AND id = :invoiceId LIMIT 1`,
              { tenantId: actor.tenantId, invoiceId },
            );
            if (inv?.stock_posted) {
              const uniqueItems = new Set(
                (doc.lines ?? []).filter((l) => l.lineKind === "stock" && l.itemId && l.qty > 0).map((l) => l.itemId!),
              ).size;
              await exec(
                conn,
                `UPDATE ims_bom_docs SET stock_issued_at = CURRENT_TIMESTAMP, stock_issue_count = :n
                 WHERE tenant_id = :tenantId AND id = :id AND stock_issued_at IS NULL`,
                { tenantId: actor.tenantId, id, n: uniqueItems },
              );
            }
          }
        },
      },
    );

    await recordEvent(deps, actor, {
      type: "bom.doc.invoiced",
      entityType: "bom_doc",
      entityId: id,
      summary: `BOM ${doc.docNo} → invoice ${invoice.invoice.invoiceNo} (${body.mode})`,
      payload: { mode: body.mode, invoiceId: invoice.invoice.id, issue: Boolean(body.issue) },
    });

    res.status(201).json({
      doc: await loadDoc(deps.db, actor.tenantId, id),
      invoice,
      mode: body.mode,
    });
  });

  router.get("/bom/docs/:id/availability", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const doc = await loadDoc(deps.db, actor.tenantId, id);
    if (!doc) throw notFound("BOM document not found");
    const settings = await getSettings(deps, actor.tenantId);
    const items = await computeBomAvailability(deps.db, actor.tenantId, doc.lines ?? []);
    res.json({
      allowNegativeStock: settings.allowNegativeStock,
      hasShortfall: bomHasShortfall(items),
      items,
    });
  });

  router.post("/bom/docs/:id/issue-stock", async (req, res) => {
    requirePerm(res, "bom");
    requirePerm(res, "stockOut");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const body = parse(z.object({ date: isoDate.optional() }), req.body);
    const doc = await loadDoc(deps.db, actor.tenantId, id);
    if (!doc) throw notFound("BOM document not found");
    if (doc.status !== "confirmed") throw conflict("Confirm the BOM before issuing stock");
    if (doc.stockIssuedAt) throw conflict("Stock was already issued for this BOM");
    if (doc.invoiceId && doc.invoiceConvertMode === "explode_lines") {
      const inv = await one<{ stock_posted: number; status: string }>(
        deps.db,
        `SELECT stock_posted, status FROM ims_invoices WHERE tenant_id = :tenantId AND id = :id LIMIT 1`,
        { tenantId: actor.tenantId, id: doc.invoiceId },
      );
      if (inv && inv.status === "draft") {
        throw conflict("A draft explode invoice is linked. Issue or delete that draft before issuing stock from the BOM.");
      }
      if (inv && inv.status === "issued" && inv.stock_posted) {
        throw conflict("Stock was already posted when the linked explode invoice was issued");
      }
    }

    const stockLines = (doc.lines ?? []).filter((l) => l.lineKind === "stock" && l.itemId && l.qty > 0);
    if (!stockLines.length) {
      throw conflict("No stock-linked lines to issue. Link catalogue items on stock lines first (or use explode invoice).");
    }

    // Aggregate qty by item
    const byItem = new Map<string, { qty: number; name: string }>();
    for (const l of stockLines) {
      const cur = byItem.get(l.itemId!) ?? { qty: 0, name: l.description };
      cur.qty = round3(cur.qty + l.qty);
      byItem.set(l.itemId!, cur);
    }

    const settings = await getSettings(deps, actor.tenantId);
    if (!settings.allowNegativeStock) {
      const availability = await computeBomAvailability(deps.db, actor.tenantId, doc.lines ?? []);
      if (bomHasShortfall(availability)) {
        const tip = availability
          .filter((a) => a.shortfall > 0)
          .slice(0, 3)
          .map((a) => `${a.name} (need ${a.need}, have ${a.have})`)
          .join("; ");
        throw conflict(`Insufficient stock. ${tip}`);
      }
    }
    const date = body.date ?? todayISO();
    const posted = await tx(deps.db, async (conn) => {
      const locked = await one<{
        stock_issued_at: string | null;
        status: string;
        invoice_id: string | null;
        invoice_convert_mode: string | null;
      }>(
        conn,
        `SELECT stock_issued_at, status, invoice_id, invoice_convert_mode FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id },
      );
      if (!locked) throw notFound("BOM document not found");
      if (locked.status !== "confirmed") throw conflict("Confirm the BOM before issuing stock");
      if (locked.stock_issued_at) throw conflict("Stock was already issued for this BOM");
      if (locked.invoice_id && locked.invoice_convert_mode === "explode_lines") {
        const inv = await one<{ stock_posted: number; status: string }>(
          conn,
          `SELECT stock_posted, status FROM ims_invoices WHERE tenant_id = :tenantId AND id = :id LIMIT 1`,
          { tenantId: actor.tenantId, id: locked.invoice_id },
        );
        if (inv && inv.status === "draft") {
          throw conflict("A draft explode invoice is linked. Issue or delete that draft before issuing stock from the BOM.");
        }
        if (inv && inv.status === "issued" && inv.stock_posted) {
          throw conflict("Stock was already posted when the linked explode invoice was issued");
        }
      }

      const out = [];
      for (const [itemId, v] of byItem) {
        out.push(
          await postMovement(
            conn,
            actor,
            {
              itemId,
              type: "OUT",
              qty: v.qty,
              refType: "bom",
              refId: doc.id,
              refNo: doc.docNo,
              partyId: doc.partyId,
              partyName: doc.customerName,
              reason: "BOM materials issue",
              notes: doc.title || doc.capacityLabel || null,
              date,
            },
            { allowNegative: settings.allowNegativeStock },
          ),
        );
      }
      const claimed = await exec(
        conn,
        `UPDATE ims_bom_docs SET stock_issued_at = CURRENT_TIMESTAMP, stock_issue_count = :n
         WHERE tenant_id = :tenantId AND id = :id AND stock_issued_at IS NULL`,
        { tenantId: actor.tenantId, id, n: byItem.size },
      );
      if (!claimed.affectedRows) throw conflict("Stock was already issued for this BOM");
      return out;
    });

    await recordEvent(deps, actor, {
      type: "bom.doc.stock_issued",
      entityType: "bom_doc",
      entityId: id,
      summary: `Issued stock for BOM ${doc.docNo} (${posted.length} item${posted.length === 1 ? "" : "s"})`,
      payload: { count: posted.length },
    });

    res.json({ doc: await loadDoc(deps.db, actor.tenantId, id), movements: posted });
  });

  router.post("/bom/docs/:id/reverse-stock", async (req, res) => {
    requirePerm(res, "bom");
    requirePerm(res, "stockOut");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const body = parse(z.object({ date: isoDate.optional() }), req.body);
    const doc = await loadDoc(deps.db, actor.tenantId, id);
    if (!doc) throw notFound("BOM document not found");
    if (!doc.stockIssuedAt) throw conflict("No BOM stock issue to reverse");
    if (doc.invoiceId && doc.invoiceConvertMode === "explode_lines") {
      const inv = await one<{ stock_posted: number; status: string }>(
        deps.db,
        `SELECT stock_posted, status FROM ims_invoices WHERE tenant_id = :tenantId AND id = :id LIMIT 1`,
        { tenantId: actor.tenantId, id: doc.invoiceId },
      );
      if (inv && inv.status === "issued" && inv.stock_posted) {
        throw conflict("Stock was posted by the linked explode invoice. Cancel that invoice to return materials.");
      }
    }

    const stockLines = (doc.lines ?? []).filter((l) => l.lineKind === "stock" && l.itemId && l.qty > 0);
    if (!stockLines.length) throw conflict("No stock-linked lines to reverse");

    const byItem = new Map<string, number>();
    for (const l of stockLines) {
      byItem.set(l.itemId!, round3((byItem.get(l.itemId!) ?? 0) + l.qty));
    }

    const settings = await getSettings(deps, actor.tenantId);
    const date = body.date ?? todayISO();
    const posted = await tx(deps.db, async (conn) => {
      const locked = await one<{
        stock_issued_at: string | null;
        invoice_id: string | null;
        invoice_convert_mode: string | null;
      }>(
        conn,
        `SELECT stock_issued_at, invoice_id, invoice_convert_mode FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id },
      );
      if (!locked?.stock_issued_at) throw conflict("No BOM stock issue to reverse");
      if (locked.invoice_id && locked.invoice_convert_mode === "explode_lines") {
        const inv = await one<{ stock_posted: number; status: string }>(
          conn,
          `SELECT stock_posted, status FROM ims_invoices WHERE tenant_id = :tenantId AND id = :id LIMIT 1`,
          { tenantId: actor.tenantId, id: locked.invoice_id },
        );
        if (inv && inv.status === "issued" && inv.stock_posted) {
          throw conflict("Stock was posted by the linked explode invoice. Cancel that invoice to return materials.");
        }
      }

      const out = [];
      for (const [itemId, qty] of byItem) {
        out.push(
          await postMovement(
            conn,
            actor,
            {
              itemId,
              type: "RETURN_IN",
              qty,
              refType: "bom",
              refId: doc.id,
              refNo: doc.docNo,
              partyId: doc.partyId,
              partyName: doc.customerName,
              reason: "BOM materials reverse",
              notes: doc.title || doc.capacityLabel || null,
              date,
            },
            { allowNegative: settings.allowNegativeStock },
          ),
        );
      }
      const cleared = await exec(
        conn,
        `UPDATE ims_bom_docs SET stock_issued_at = NULL, stock_issue_count = 0
         WHERE tenant_id = :tenantId AND id = :id AND stock_issued_at IS NOT NULL`,
        { tenantId: actor.tenantId, id },
      );
      if (!cleared.affectedRows) throw conflict("No BOM stock issue to reverse");
      return out;
    });

    await recordEvent(deps, actor, {
      type: "bom.doc.stock_reversed",
      entityType: "bom_doc",
      entityId: id,
      summary: `Reversed stock for BOM ${doc.docNo} (${posted.length} item${posted.length === 1 ? "" : "s"})`,
      payload: { count: posted.length },
    });

    res.json({ doc: await loadDoc(deps.db, actor.tenantId, id), movements: posted });
  });
}

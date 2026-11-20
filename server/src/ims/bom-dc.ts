/**
 * Delivery Challans (DC) for confirmed BOMs.
 * draft → verified (bom) → approved (approvals) → stock OUT.
 * Multiple DCs may partially deliver one BOM. Invoice stock OUT only when no DC links exist.
 */
import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BomDoc, BomDocLine } from "./bom.js";
import { availableDcQty, isLegacyFullIssue, planBomIssuedSync, returnableDcQty } from "./bom-enhance.js";
import { actorName, actorOf, can, isoDate, optText, parse, qstr, recordEvent, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { badRequest, conflict, forbidden, notFound } from "./host.js";
import { round3, todayISO } from "./logic.js";
import { assertDayOpen } from "./sales.js";
import { getSettings } from "./settings.js";
import { nextDocNo, postMovement } from "./stock.js";

export const BOM_DC_STATUSES = ["draft", "verified", "approved", "cancelled"] as const;
export type BomDcStatus = (typeof BOM_DC_STATUSES)[number];

const LIVE_STATUSES = ["draft", "verified", "approved"] as const;

type DcRow = {
  id: string;
  tenant_id: number;
  bom_doc_id: string;
  doc_no: string;
  status: string;
  doc_date: unknown;
  ship_to: string | null;
  transporter: string | null;
  vehicle_no: string | null;
  notes: string | null;
  verified_by: number | null;
  verified_by_name: string | null;
  verified_at: unknown;
  approved_by: number | null;
  approved_by_name: string | null;
  approved_at: unknown;
  stock_posted: number;
  created_by: number | null;
  created_by_name: string | null;
  created_at: unknown;
  updated_at: unknown;
};

type DcLineRow = {
  id: string;
  dc_id: string;
  bom_line_id: string;
  item_id: string | null;
  section: string;
  sort_no: number;
  description: string;
  make_text: string | null;
  qty: string | number;
  returned_qty?: string | number;
  unit: string;
  remarks: string | null;
};

export type BomDcLine = {
  id: string;
  dcId: string;
  bomLineId: string;
  itemId: string | null;
  section: string;
  sortNo: number;
  description: string;
  makeText: string | null;
  qty: number;
  /** Cumulative unused returns against this DC line (still on the approved DC). */
  returnedQty: number;
  /** qty − returnedQty — still out at site. */
  netQty: number;
  unit: string;
  remarks: string | null;
};

export type BomDcReturnLine = {
  id: string;
  returnId: string;
  dcId: string;
  dcLineId: string;
  bomLineId: string;
  itemId: string | null;
  description: string;
  qty: number;
  unit: string;
  remarks: string | null;
};

export type BomDcReturn = {
  id: string;
  dcId: string;
  bomDocId: string;
  returnNo: string;
  returnDate: string;
  notes: string | null;
  createdByName: string | null;
  createdAt: string | null;
  lines: BomDcReturnLine[];
  /** Parent DC number for stock / audit reference. */
  dcDocNo?: string | null;
};

export type BomDc = {
  id: string;
  bomDocId: string;
  docNo: string;
  status: BomDcStatus;
  docDate: string;
  shipTo: string | null;
  transporter: string | null;
  vehicleNo: string | null;
  notes: string | null;
  verifiedBy: number | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  approvedBy: number | null;
  approvedByName: string | null;
  approvedAt: string | null;
  stockPosted: boolean;
  createdByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lines?: BomDcLine[];
  returns?: BomDcReturn[];
  bomDocNo?: string | null;
  customerName?: string | null;
  quotationRef?: string | null;
  /** Live draft/issued invoice still references this DC (blocks return/reverse). */
  invoiceLinked?: boolean;
  invoiceId?: string | null;
  invoiceNo?: string | null;
  invoiceStatus?: string | null;
};

const statusOf = (v: string): BomDcStatus => ((BOM_DC_STATUSES as readonly string[]).includes(v) ? (v as BomDcStatus) : "draft");

function mapLine(r: DcLineRow): BomDcLine {
  const qty = round3(money(r.qty));
  const returnedQty = round3(money(r.returned_qty ?? 0));
  return {
    id: r.id,
    dcId: r.dc_id,
    bomLineId: r.bom_line_id,
    itemId: r.item_id,
    section: r.section,
    sortNo: Number(r.sort_no),
    description: r.description,
    makeText: r.make_text,
    qty,
    returnedQty,
    netQty: round3(Math.max(0, qty - returnedQty)),
    unit: r.unit,
    remarks: r.remarks,
  };
}

function mapDc(
  r: DcRow,
  lines?: BomDcLine[],
  extra?: {
    bomDocNo?: string | null;
    customerName?: string | null;
    quotationRef?: string | null;
    returns?: BomDcReturn[];
    invoiceLinked?: boolean;
    invoiceId?: string | null;
    invoiceNo?: string | null;
    invoiceStatus?: string | null;
  },
): BomDc {
  return {
    id: r.id,
    bomDocId: r.bom_doc_id,
    docNo: r.doc_no,
    status: statusOf(r.status),
    docDate: isoOf(r.doc_date),
    shipTo: r.ship_to,
    transporter: r.transporter,
    vehicleNo: r.vehicle_no,
    notes: r.notes,
    verifiedBy: r.verified_by,
    verifiedByName: r.verified_by_name,
    verifiedAt: tsOf(r.verified_at),
    approvedBy: r.approved_by,
    approvedByName: r.approved_by_name,
    approvedAt: tsOf(r.approved_at),
    stockPosted: Boolean(r.stock_posted),
    createdByName: r.created_by_name,
    createdAt: tsOf(r.created_at),
    updatedAt: tsOf(r.updated_at),
    lines,
    returns: extra?.returns,
    bomDocNo: extra?.bomDocNo ?? null,
    customerName: extra?.customerName ?? null,
    quotationRef: extra?.quotationRef ?? null,
    invoiceLinked: extra?.invoiceLinked ?? false,
    invoiceId: extra?.invoiceId ?? null,
    invoiceNo: extra?.invoiceNo ?? null,
    invoiceStatus: extra?.invoiceStatus ?? null,
  };
}

/**
 * Live commercial hold on a DC: direct invoice↔DC link, or the parent BOM’s draft/issued invoice.
 * Either case must block return/reverse so billed stock can’t silently come back.
 */
async function loadDcInvoiceLink(
  db: Queryable,
  tenantId: number,
  dcId: string,
): Promise<{ invoiceId: string; invoiceNo: string | null; invoiceStatus: string; via: "dc_link" | "bom_invoice" } | null> {
  const linked = await one<{ invoice_id: string; invoice_no: string | null; status: string }>(
    db,
    `SELECT i.id AS invoice_id, i.invoice_no, i.status FROM ims_invoice_dc_links l
     INNER JOIN ims_invoices i ON i.id = l.invoice_id AND i.tenant_id = l.tenant_id
     WHERE l.tenant_id = :tenantId AND l.dc_id = :dcId AND i.status IN ('draft','issued')
     ORDER BY CASE WHEN i.status = 'issued' THEN 0 ELSE 1 END
     LIMIT 1`,
    { tenantId, dcId },
  );
  if (linked) {
    return { invoiceId: linked.invoice_id, invoiceNo: linked.invoice_no, invoiceStatus: linked.status, via: "dc_link" };
  }
  const bomInv = await one<{ invoice_id: string; invoice_no: string | null; status: string }>(
    db,
    `SELECT i.id AS invoice_id, i.invoice_no, i.status
     FROM ims_bom_dcs d
     INNER JOIN ims_bom_docs b ON b.id = d.bom_doc_id AND b.tenant_id = d.tenant_id
     INNER JOIN ims_invoices i ON i.id = b.invoice_id AND i.tenant_id = b.tenant_id
     WHERE d.tenant_id = :tenantId AND d.id = :dcId AND i.status IN ('draft','issued')
     LIMIT 1`,
    { tenantId, dcId },
  );
  if (!bomInv) return null;
  return {
    invoiceId: bomInv.invoice_id,
    invoiceNo: bomInv.invoice_no,
    invoiceStatus: bomInv.status,
    via: "bom_invoice",
  };
}

async function loadDcLines(db: Queryable, tenantId: number, dcId: string): Promise<BomDcLine[]> {
  const list = await rows<DcLineRow>(
    db,
    `SELECT id, dc_id, bom_line_id, item_id, section, sort_no, description, make_text, qty,
            COALESCE(returned_qty, 0) AS returned_qty, unit, remarks
     FROM ims_bom_dc_lines WHERE tenant_id = :tenantId AND dc_id = :dcId ORDER BY sort_no ASC, created_at ASC`,
    { tenantId, dcId },
  );
  return list.map(mapLine);
}

/** Full RTN row for paper / maintain workspace (includes BOM site context). */
async function loadDcReturnDetail(
  db: Queryable,
  tenantId: number,
  id: string,
): Promise<{
  id: string;
  dcId: string;
  bomDocId: string;
  returnNo: string;
  returnDate: string;
  notes: string | null;
  createdByName: string | null;
  createdAt: string | null;
  dcDocNo: string | null;
  dcStatus: string | null;
  bomDocNo: string | null;
  customerName: string | null;
  quotationRef: string | null;
  location: string | null;
  projectRef: string | null;
  units: number;
  lineCount: number;
  lines: BomDcReturn["lines"];
} | null> {
  const h = await one<{
    id: string;
    dc_id: string;
    bom_doc_id: string;
    return_no: string;
    return_date: unknown;
    notes: string | null;
    created_by_name: string | null;
    created_at: unknown;
    dc_doc_no: string;
    dc_status: string;
    bom_doc_no: string;
    customer_name: string | null;
    quotation_ref: string | null;
    location: string | null;
    project_ref: string | null;
  }>(
    db,
    `SELECT r.id, r.dc_id, r.bom_doc_id, r.return_no, r.return_date, r.notes, r.created_by_name, r.created_at,
            d.doc_no AS dc_doc_no, d.status AS dc_status, b.doc_no AS bom_doc_no, b.customer_name, b.quotation_ref,
            b.location, b.project_ref
     FROM ims_bom_dc_returns r
     INNER JOIN ims_bom_dcs d ON d.id = r.dc_id AND d.tenant_id = r.tenant_id
     INNER JOIN ims_bom_docs b ON b.id = r.bom_doc_id AND b.tenant_id = r.tenant_id
     WHERE r.tenant_id = :tenantId AND r.id = :id
     LIMIT 1`,
    { tenantId, id },
  );
  if (!h) return null;
  const lineRows = await rows<{
    id: string;
    return_id: string;
    dc_id: string;
    dc_line_id: string;
    bom_line_id: string;
    item_id: string | null;
    description: string;
    qty: string | number;
    unit: string;
    remarks: string | null;
  }>(
    db,
    `SELECT id, return_id, dc_id, dc_line_id, bom_line_id, item_id, description, qty, unit, remarks
     FROM ims_bom_dc_return_lines WHERE tenant_id = :tenantId AND return_id = :returnId
     ORDER BY created_at ASC`,
    { tenantId, returnId: id },
  );
  const lines = lineRows.map((l) => ({
    id: l.id,
    returnId: l.return_id,
    dcId: l.dc_id,
    dcLineId: l.dc_line_id,
    bomLineId: l.bom_line_id,
    itemId: l.item_id,
    description: l.description,
    qty: round3(money(l.qty)),
    unit: l.unit,
    remarks: l.remarks,
  }));
  return {
    id: h.id,
    dcId: h.dc_id,
    bomDocId: h.bom_doc_id,
    returnNo: h.return_no,
    returnDate: isoOf(h.return_date),
    notes: h.notes,
    createdByName: h.created_by_name,
    createdAt: tsOf(h.created_at),
    dcDocNo: h.dc_doc_no,
    dcStatus: h.dc_status,
    bomDocNo: h.bom_doc_no,
    customerName: h.customer_name,
    quotationRef: h.quotation_ref,
    location: h.location,
    projectRef: h.project_ref,
    units: round3(lines.reduce((s, l) => s + l.qty, 0)),
    lineCount: lines.length,
    lines,
  };
}

async function loadDcReturns(db: Queryable, tenantId: number, dcId: string): Promise<BomDcReturn[]> {
  const headers = await rows<{
    id: string;
    dc_id: string;
    bom_doc_id: string;
    return_no: string;
    return_date: unknown;
    notes: string | null;
    created_by_name: string | null;
    created_at: unknown;
  }>(
    db,
    `SELECT id, dc_id, bom_doc_id, return_no, return_date, notes, created_by_name, created_at
     FROM ims_bom_dc_returns WHERE tenant_id = :tenantId AND dc_id = :dcId
     ORDER BY return_date DESC, created_at DESC`,
    { tenantId, dcId },
  );
  const out: BomDcReturn[] = [];
  for (const h of headers) {
    const lines = await rows<{
      id: string;
      return_id: string;
      dc_id: string;
      dc_line_id: string;
      bom_line_id: string;
      item_id: string | null;
      description: string;
      qty: string | number;
      unit: string;
      remarks: string | null;
    }>(
      db,
      `SELECT id, return_id, dc_id, dc_line_id, bom_line_id, item_id, description, qty, unit, remarks
       FROM ims_bom_dc_return_lines WHERE tenant_id = :tenantId AND return_id = :returnId
       ORDER BY created_at ASC`,
      { tenantId, returnId: h.id },
    );
    out.push({
      id: h.id,
      dcId: h.dc_id,
      bomDocId: h.bom_doc_id,
      returnNo: h.return_no,
      returnDate: isoOf(h.return_date),
      notes: h.notes,
      createdByName: h.created_by_name,
      createdAt: tsOf(h.created_at),
      lines: lines.map((l) => ({
        id: l.id,
        returnId: l.return_id,
        dcId: l.dc_id,
        dcLineId: l.dc_line_id,
        bomLineId: l.bom_line_id,
        itemId: l.item_id,
        description: l.description,
        qty: round3(money(l.qty)),
        unit: l.unit,
        remarks: l.remarks,
      })),
    });
  }
  return out;
}

export async function loadDc(db: Queryable, tenantId: number, id: string): Promise<BomDc | null> {
  const r = await one<DcRow & { bom_doc_no?: string; customer_name?: string; quotation_ref?: string | null }>(
    db,
    `SELECT d.*, b.doc_no AS bom_doc_no, b.customer_name, b.quotation_ref
     FROM ims_bom_dcs d
     LEFT JOIN ims_bom_docs b ON b.id = d.bom_doc_id AND b.tenant_id = d.tenant_id
     WHERE d.tenant_id = :tenantId AND d.id = :id LIMIT 1`,
    { tenantId, id },
  );
  if (!r) return null;
  const lines = await loadDcLines(db, tenantId, id);
  const returns = await loadDcReturns(db, tenantId, id);
  const inv = await loadDcInvoiceLink(db, tenantId, id);
  return mapDc(r, lines, {
    bomDocNo: r.bom_doc_no ?? null,
    customerName: r.customer_name ?? null,
    quotationRef: r.quotation_ref ?? null,
    returns,
    invoiceLinked: Boolean(inv),
    invoiceId: inv?.invoiceId ?? null,
    invoiceNo: inv?.invoiceNo ?? null,
    invoiceStatus: inv?.invoiceStatus ?? null,
  });
}

/** Qty reserved by live DCs per BOM line (draft/verified full qty + approved net after returns). */
export async function committedDcQtyByBomLine(
  db: Queryable,
  tenantId: number,
  bomDocId: string,
  opts?: { excludeDcId?: string },
): Promise<Map<string, number>> {
  const params: Record<string, unknown> = { tenantId, bomDocId };
  let exclude = "";
  if (opts?.excludeDcId) {
    exclude = " AND d.id <> :excludeDcId";
    params.excludeDcId = opts.excludeDcId;
  }
  // Draft/verified reserve full line qty; approved reserves net still out (delivered − returns).
  const list = await rows<{ bom_line_id: string; qty: string }>(
    db,
    `SELECT l.bom_line_id,
            SUM(
              CASE
                WHEN d.status = 'approved' THEN GREATEST(0, l.qty - COALESCE(l.returned_qty, 0))
                ELSE l.qty
              END
            ) AS qty
     FROM ims_bom_dc_lines l
     INNER JOIN ims_bom_dcs d ON d.id = l.dc_id AND d.tenant_id = l.tenant_id
     WHERE l.tenant_id = :tenantId AND d.bom_doc_id = :bomDocId
       AND d.status IN ('draft','verified','approved')${exclude}
     GROUP BY l.bom_line_id`,
    params,
  );
  const out = new Map<string, number>();
  for (const r of list) out.set(r.bom_line_id, round3(money(r.qty)));
  return out;
}

/** Net qty still out (approved + stock posted − returns) per BOM line. */
async function approvedDcQtyByBomLine(db: Queryable, tenantId: number, bomDocId: string): Promise<Map<string, number>> {
  const list = await rows<{ bom_line_id: string; qty: string }>(
    db,
    `SELECT l.bom_line_id, SUM(GREATEST(0, l.qty - COALESCE(l.returned_qty, 0))) AS qty
     FROM ims_bom_dc_lines l
     INNER JOIN ims_bom_dcs d ON d.id = l.dc_id AND d.tenant_id = l.tenant_id
     WHERE l.tenant_id = :tenantId AND d.bom_doc_id = :bomDocId
       AND d.status = 'approved' AND d.stock_posted = 1
     GROUP BY l.bom_line_id`,
    paramsOf(tenantId, bomDocId),
  );
  const out = new Map<string, number>();
  for (const r of list) out.set(r.bom_line_id, round3(money(r.qty)));
  return out;
}

function paramsOf(tenantId: number, bomDocId: string): Record<string, unknown> {
  return { tenantId, bomDocId };
}

export async function syncBomIssuedFromDcs(
  db: Queryable,
  tenantId: number,
  bomDocId: string,
  stockLines: ReadonlyArray<{ id: string; qty: number }>,
): Promise<void> {
  const approved = await approvedDcQtyByBomLine(db, tenantId, bomDocId);
  const approvedCount = await one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM ims_bom_dcs
     WHERE tenant_id = :tenantId AND bom_doc_id = :bomDocId AND status = 'approved' AND stock_posted = 1`,
    { tenantId, bomDocId },
  );
  const plan = planBomIssuedSync(stockLines, approved, Number(approvedCount?.n ?? 0));
  for (const row of plan.lineIssued) {
    await exec(
      db,
      `UPDATE ims_bom_doc_lines SET issued_qty = :issued WHERE tenant_id = :tenantId AND doc_id = :docId AND id = :lineId`,
      { tenantId, docId: bomDocId, lineId: row.lineId, issued: row.issued },
    );
  }
  if (plan.stockIssuedAt === "set") {
    await exec(
      db,
      `UPDATE ims_bom_docs
       SET stock_issued_at = COALESCE(stock_issued_at, CURRENT_TIMESTAMP), stock_issue_count = :n
       WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId, id: bomDocId, n: plan.stockIssueCount },
    );
  } else {
    // Partial or empty: stock_issued_at means fully covered; issued_qty tracks partial posts.
    await exec(
      db,
      `UPDATE ims_bom_docs SET stock_issued_at = NULL, stock_issue_count = :n WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId, id: bomDocId, n: plan.stockIssueCount },
    );
  }
}

export async function listInvoiceDcIds(db: Queryable, tenantId: number, invoiceId: string): Promise<string[]> {
  const list = await rows<{ dc_id: string }>(
    db,
    `SELECT dc_id FROM ims_invoice_dc_links WHERE tenant_id = :tenantId AND invoice_id = :invoiceId ORDER BY created_at ASC`,
    { tenantId, invoiceId },
  );
  return list.map((r) => r.dc_id);
}

export async function linkInvoiceDcs(db: Queryable, tenantId: number, invoiceId: string, dcIds: string[]): Promise<void> {
  const unique = [...new Set(dcIds)];
  await exec(db, `DELETE FROM ims_invoice_dc_links WHERE tenant_id = :tenantId AND invoice_id = :invoiceId`, { tenantId, invoiceId });
  for (const dcId of unique) {
    await exec(
      db,
      `INSERT INTO ims_invoice_dc_links (tenant_id, invoice_id, dc_id) VALUES (:tenantId, :invoiceId, :dcId)`,
      { tenantId, invoiceId, dcId },
    );
  }
}

export async function assertDcsLinkable(
  db: Queryable,
  tenantId: number,
  bomDocId: string,
  dcIds: string[],
  opts?: { invoiceId?: string },
): Promise<BomDc[]> {
  if (!dcIds.length) return [];
  const unique = [...new Set(dcIds)];
  const dcs: BomDc[] = [];
  for (const id of unique) {
    const dc = await loadDc(db, tenantId, id);
    if (!dc) throw notFound(`Delivery challan ${id}`);
    if (dc.bomDocId !== bomDocId) throw conflict(`Delivery challan ${dc.docNo} belongs to another BOM`);
    if (dc.status !== "approved" || !dc.stockPosted) {
      throw conflict(`Delivery challan ${dc.docNo} must be approved (stock posted) before linking to an invoice`);
    }
    const linked = await one<{ invoice_id: string }>(
      db,
      `SELECT l.invoice_id FROM ims_invoice_dc_links l
       INNER JOIN ims_invoices i ON i.id = l.invoice_id AND i.tenant_id = l.tenant_id
       WHERE l.tenant_id = :tenantId AND l.dc_id = :dcId AND i.status IN ('draft','issued')
       LIMIT 1`,
      { tenantId, dcId: id },
    );
    if (linked && linked.invoice_id !== opts?.invoiceId) {
      throw conflict(`Delivery challan ${dc.docNo} is already linked to another invoice`);
    }
    dcs.push(dc);
  }
  return dcs;
}

/** Block new DCs when BOM stock was already fully issued outside the DC flow. */
async function assertBomAllowsNewDc(db: Queryable, tenantId: number, doc: BomDoc): Promise<void> {
  if (doc.status !== "confirmed") throw conflict("Confirm the BOM before creating a delivery challan");
  const stock = stockLinesOf(doc);
  const hasApproved = await bomHasApprovedDcs(db, tenantId, doc.id);
  if (doc.stockIssuedAt && !hasApproved) {
    // Invoice explode or legacy BOM issue — no DC owns the stock movements.
    throw conflict(
      doc.invoiceId
        ? "Materials were already issued from this BOM’s invoice. Reverse/cancel that invoice stock before creating a delivery challan, or link approved DCs on a new draft invoice."
        : "Materials were already issued from this BOM. Reverse that stock before creating a delivery challan.",
    );
  }
  if (isLegacyFullIssue(doc.stockIssuedAt, stock) && !hasApproved) {
    throw conflict("Materials were already issued from this BOM. Reverse that stock before creating a delivery challan.");
  }
}

/** Preflight IMS on-hand before DC approve posts stock OUT. */
async function assertDcStockAvailable(
  db: Queryable,
  tenantId: number,
  lines: ReadonlyArray<{ itemId: string | null; description: string; qty: number }>,
  allowNegative: boolean,
): Promise<void> {
  if (allowNegative) return;
  const need = new Map<string, { qty: number; name: string }>();
  for (const line of lines) {
    if (!line.itemId || !(line.qty > 0)) continue;
    const cur = need.get(line.itemId) ?? { qty: 0, name: line.description };
    cur.qty = round3(cur.qty + line.qty);
    need.set(line.itemId, cur);
  }
  if (!need.size) return;
  const ids = [...need.keys()];
  const params: Record<string, unknown> = { tenantId };
  const inList = ids.map((id, i) => {
    params[`i${i}`] = id;
    return `:i${i}`;
  });
  const items = await rows<{ id: string; name: string; current_stock: string }>(
    db,
    `SELECT id, name, current_stock FROM ims_items WHERE tenant_id = :tenantId AND id IN (${inList.join(",")})`,
    params,
  );
  const have = new Map(items.map((i) => [i.id, i]));
  const short: string[] = [];
  for (const [itemId, n] of need) {
    const item = have.get(itemId);
    const onHand = item ? round3(money(item.current_stock)) : 0;
    if (n.qty > onHand + 1e-9) {
      short.push(`${item?.name ?? n.name} (need ${n.qty}, have ${onHand})`);
    }
  }
  if (short.length) {
    throw conflict(`Insufficient stock to approve this delivery challan. ${short.slice(0, 3).join("; ")}`);
  }
}

const lineInput = z.object({
  bomLineId: z.string().uuid(),
  qty: z.coerce.number().gt(0).max(1e9),
  remarks: optText(500),
});

const dcCreateInput = z.object({
  docDate: isoDate.optional(),
  shipTo: optText(500),
  transporter: optText(200),
  vehicleNo: optText(40),
  notes: optText(2000),
  lines: z.array(lineInput).min(1, "Add at least one line").max(500),
});

const dcPatchInput = z.object({
  docDate: isoDate.optional(),
  shipTo: optText(500),
  transporter: optText(200),
  vehicleNo: optText(40),
  notes: optText(2000),
  lines: z.array(lineInput).min(1).max(500).optional(),
});

function stockLinesOf(doc: BomDoc): BomDocLine[] {
  return (doc.lines ?? []).filter((l) => l.lineKind === "stock" && l.itemId && l.qty > 0);
}

/** Plan DC lines against BOM remaining capacity (live DC commits + already-issued stock). */
function planDcLinesAgainstBom(
  doc: BomDoc,
  requested: ReadonlyArray<{ bomLineId: string; qty: number; remarks?: string | null }>,
  committed: Map<string, number>,
): Array<{ line: BomDocLine; qty: number; remarks: string | null }> {
  const stock = stockLinesOf(doc);
  if (!stock.length) throw conflict("No stock-linked lines on this BOM");
  const byId = new Map(stock.map((l) => [l.id, l]));
  if (new Set(requested.map((l) => l.bomLineId)).size !== requested.length) {
    throw badRequest("Each BOM line may only appear once on a delivery challan");
  }
  const planned: Array<{ line: BomDocLine; qty: number; remarks: string | null }> = [];
  for (const reqLine of requested) {
    const line = byId.get(reqLine.bomLineId);
    if (!line) throw badRequest("Only stock lines linked to a catalogue item can go on a delivery challan");
    if (!line.itemId) throw badRequest(`“${line.description}” has no catalogue item — link an item before adding it to a DC`);
    const rem = availableDcQty(line.qty, committed.get(line.id) ?? 0, line.issuedQty ?? 0, doc.stockIssuedAt);
    const qty = round3(reqLine.qty);
    if (!(qty > 0)) throw conflict(`Quantity must be greater than zero for “${line.description}”`);
    if (qty > rem + 1e-9) {
      throw conflict(
        rem <= 0
          ? `No remaining quantity for “${line.description}” — already on a DC or issued from the BOM/invoice. Increase the BOM line qty and reconfirm before raising another delivery challan`
          : `Only ${rem} ${line.unit} remaining for “${line.description}” (approved DCs cannot exceed the confirmed BOM qty — increase the BOM and reconfirm to deliver more)`,
      );
    }
    planned.push({ line, qty, remarks: reqLine.remarks ?? null });
  }
  if (!planned.length) throw badRequest("Add at least one line with quantity");
  return planned;
}

/** Re-check an existing DC still fits the BOM before verify/approve (defence in depth). */
async function assertExistingDcFitsBom(
  db: Queryable,
  tenantId: number,
  doc: BomDoc,
  dcId: string,
  lines: BomDcLine[],
): Promise<void> {
  if (doc.status !== "confirmed") throw conflict("BOM must be confirmed");
  if (!lines.length) throw conflict("Delivery challan has no lines");
  const stockById = new Map(stockLinesOf(doc).map((l) => [l.id, l]));
  for (const line of lines) {
    const bomLine = stockById.get(line.bomLineId);
    if (!bomLine) {
      throw conflict(`“${line.description}” is no longer a stock line on this BOM — edit or cancel the delivery challan`);
    }
    if (line.itemId && bomLine.itemId && line.itemId !== bomLine.itemId) {
      throw conflict(
        `“${line.description}” catalogue item changed on the BOM — edit the draft delivery challan (or cancel it) before continuing`,
      );
    }
    if (!line.itemId && !bomLine.itemId) {
      throw conflict(`“${line.description}” has no catalogue item — link an item on the BOM before verifying`);
    }
  }
  const committed = await committedDcQtyByBomLine(db, tenantId, doc.id, { excludeDcId: dcId });
  planDcLinesAgainstBom(
    doc,
    lines.map((l) => ({ bomLineId: l.bomLineId, qty: l.qty, remarks: l.remarks })),
    committed,
  );
}

/** Prefer IMS team display name, then platform name/email. */
async function displayName(db: Queryable, actor: Parameters<typeof actorName>[0]): Promise<string> {
  if (actor.userId) {
    const row = await one<{ display_name: string | null }>(
      db,
      `SELECT display_name FROM ims_members WHERE tenant_id = :tenantId AND user_id = :userId LIMIT 1`,
      { tenantId: actor.tenantId, userId: actor.userId },
    );
    const custom = row?.display_name?.trim();
    if (custom) return custom;
  }
  return actorName(actor) ?? "User";
}

export type BomDcLoaders = {
  loadDoc: (db: Queryable, tenantId: number, id: string) => Promise<BomDoc | null>;
};

export function registerBomDc(router: Router, deps: ImsDeps, loaders: BomDcLoaders): void {
  /** Remaining qty available for new/edited DCs on a confirmed BOM. */
  router.get("/bom/docs/:id/dc-remaining", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const bomId = String(req.params.id);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, bomId);
    if (!doc) throw notFound("BOM document not found");
    const committed = await committedDcQtyByBomLine(deps.db, actor.tenantId, bomId, {
      excludeDcId: qstr(req.query.excludeDcId, 36) || undefined,
    });
    const lines = stockLinesOf(doc).map((l) => {
      const committedQty = committed.get(l.id) ?? 0;
      const issuedQty = l.issuedQty ?? 0;
      const remaining = availableDcQty(l.qty, committedQty, issuedQty, doc.stockIssuedAt);
      return {
        bomLineId: l.id,
        itemId: l.itemId,
        description: l.description,
        makeText: l.makeText,
        unit: l.unit,
        section: l.section,
        sortNo: l.sortNo,
        bomQty: l.qty,
        committedQty,
        remainingQty: remaining,
        issuedQty,
        stockIssuedAt: doc.stockIssuedAt,
      };
    });
    res.json({ bomDocId: bomId, lines, stockIssuedAt: doc.stockIssuedAt, bomDocNo: doc.docNo });
  });

  router.get("/bom/docs/:id/dcs", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const bomId = String(req.params.id);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, bomId);
    if (!doc) throw notFound("BOM document not found");
    const list = await rows<DcRow>(
      deps.db,
      `SELECT * FROM ims_bom_dcs WHERE tenant_id = :tenantId AND bom_doc_id = :bomId
       ORDER BY doc_date DESC, created_at DESC`,
      { tenantId: actor.tenantId, bomId },
    );
    const dcs = [];
    for (const r of list) {
      const inv = await loadDcInvoiceLink(deps.db, actor.tenantId, r.id);
      dcs.push(
        mapDc(r, await loadDcLines(deps.db, actor.tenantId, r.id), {
          bomDocNo: doc.docNo,
          customerName: doc.customerName,
          quotationRef: doc.quotationRef ?? null,
          invoiceLinked: Boolean(inv),
          invoiceId: inv?.invoiceId ?? null,
          invoiceNo: inv?.invoiceNo ?? null,
          invoiceStatus: inv?.invoiceStatus ?? null,
        }),
      );
    }
    res.json({ dcs, bomDocNo: doc.docNo, quotationRef: doc.quotationRef ?? null });
  });

  /** Tenant-wide DC list for the Bill of Materials → DC & Returns submodule. */
  router.get("/bom/dcs", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const q = qstr(req.query.q, 80);
    const statusRaw = qstr(req.query.status, 24);
    const status = (BOM_DC_STATUSES as readonly string[]).includes(statusRaw) ? statusRaw : "";
    const linkedOnly = String(req.query.linked ?? "") === "1" || String(req.query.linked ?? "").toLowerCase() === "true";
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.min(10_000, Math.max(0, Number(req.query.offset) || 0));
    const like = q ? `%${q.replace(/[%_]/g, "")}%` : "";
    const params: Record<string, unknown> = { tenantId: actor.tenantId };
    const where: string[] = ["d.tenant_id = :tenantId"];
    if (status) {
      where.push("d.status = :status");
      params.status = status;
    }
    if (linkedOnly) {
      where.push(`(
        EXISTS (
          SELECT 1 FROM ims_invoice_dc_links l
          INNER JOIN ims_invoices i ON i.id = l.invoice_id AND i.tenant_id = l.tenant_id
          WHERE l.tenant_id = d.tenant_id AND l.dc_id = d.id AND i.status IN ('draft','issued')
        )
        OR EXISTS (
          SELECT 1 FROM ims_invoices i
          WHERE i.tenant_id = d.tenant_id AND i.id = b.invoice_id AND i.status IN ('draft','issued')
        )
      )`);
    }
    const returnableOnly =
      String(req.query.returnable ?? "") === "1" || String(req.query.returnable ?? "").toLowerCase() === "true";
    if (returnableOnly) {
      where.push(`d.status = 'approved' AND d.stock_posted = 1`);
      where.push(`(
        SELECT COALESCE(SUM(l.qty - COALESCE(l.returned_qty, 0)), 0)
        FROM ims_bom_dc_lines l WHERE l.tenant_id = d.tenant_id AND l.dc_id = d.id
      ) > 0`);
      where.push(`NOT EXISTS (
        SELECT 1 FROM ims_invoice_dc_links l
        INNER JOIN ims_invoices i ON i.id = l.invoice_id AND i.tenant_id = l.tenant_id
        WHERE l.tenant_id = d.tenant_id AND l.dc_id = d.id AND i.status IN ('draft','issued')
      )`);
      where.push(`NOT EXISTS (
        SELECT 1 FROM ims_invoices i
        WHERE i.tenant_id = d.tenant_id AND i.id = b.invoice_id AND i.status IN ('draft','issued')
      )`);
    }
    if (like) {
      where.push(
        `(d.doc_no LIKE :like OR IFNULL(b.doc_no,'') LIKE :like OR IFNULL(b.customer_name,'') LIKE :like OR IFNULL(b.quotation_ref,'') LIKE :like OR IFNULL(d.vehicle_no,'') LIKE :like)`,
      );
      params.like = like;
    }
    const whereSql = where.join(" AND ");
    const totalRow = await one<{ n: number }>(
      deps.db,
      `SELECT COUNT(*) AS n
       FROM ims_bom_dcs d
       INNER JOIN ims_bom_docs b ON b.id = d.bom_doc_id AND b.tenant_id = d.tenant_id
       WHERE ${whereSql}`,
      params,
    );
    const list = await rows<
      DcRow & {
        bom_doc_no: string;
        bom_status: string;
        customer_name: string | null;
        quotation_ref: string | null;
        line_count: number;
        returned_units: string | number;
        delivered_units: string | number;
        linked_invoice_id: string | null;
        linked_invoice_no: string | null;
        linked_invoice_status: string | null;
      }
    >(
      deps.db,
      `SELECT d.*,
              b.doc_no AS bom_doc_no,
              b.status AS bom_status,
              b.customer_name,
              b.quotation_ref,
              (SELECT COUNT(*) FROM ims_bom_dc_lines l WHERE l.tenant_id = d.tenant_id AND l.dc_id = d.id) AS line_count,
              (SELECT COALESCE(SUM(l.qty), 0) FROM ims_bom_dc_lines l WHERE l.tenant_id = d.tenant_id AND l.dc_id = d.id) AS delivered_units,
              (SELECT COALESCE(SUM(COALESCE(l.returned_qty, 0)), 0) FROM ims_bom_dc_lines l WHERE l.tenant_id = d.tenant_id AND l.dc_id = d.id) AS returned_units,
              COALESCE(
                (
                  SELECT i.id FROM ims_invoice_dc_links l
                  INNER JOIN ims_invoices i ON i.id = l.invoice_id AND i.tenant_id = l.tenant_id
                  WHERE l.tenant_id = d.tenant_id AND l.dc_id = d.id AND i.status IN ('draft','issued')
                  ORDER BY CASE WHEN i.status = 'issued' THEN 0 ELSE 1 END
                  LIMIT 1
                ),
                (
                  SELECT i.id FROM ims_invoices i
                  WHERE i.tenant_id = d.tenant_id AND i.id = b.invoice_id AND i.status IN ('draft','issued')
                  LIMIT 1
                )
              ) AS linked_invoice_id,
              COALESCE(
                (
                  SELECT i.invoice_no FROM ims_invoice_dc_links l
                  INNER JOIN ims_invoices i ON i.id = l.invoice_id AND i.tenant_id = l.tenant_id
                  WHERE l.tenant_id = d.tenant_id AND l.dc_id = d.id AND i.status IN ('draft','issued')
                  ORDER BY CASE WHEN i.status = 'issued' THEN 0 ELSE 1 END
                  LIMIT 1
                ),
                (
                  SELECT i.invoice_no FROM ims_invoices i
                  WHERE i.tenant_id = d.tenant_id AND i.id = b.invoice_id AND i.status IN ('draft','issued')
                  LIMIT 1
                )
              ) AS linked_invoice_no,
              COALESCE(
                (
                  SELECT i.status FROM ims_invoice_dc_links l
                  INNER JOIN ims_invoices i ON i.id = l.invoice_id AND i.tenant_id = l.tenant_id
                  WHERE l.tenant_id = d.tenant_id AND l.dc_id = d.id AND i.status IN ('draft','issued')
                  ORDER BY CASE WHEN i.status = 'issued' THEN 0 ELSE 1 END
                  LIMIT 1
                ),
                (
                  SELECT i.status FROM ims_invoices i
                  WHERE i.tenant_id = d.tenant_id AND i.id = b.invoice_id AND i.status IN ('draft','issued')
                  LIMIT 1
                )
              ) AS linked_invoice_status
       FROM ims_bom_dcs d
       INNER JOIN ims_bom_docs b ON b.id = d.bom_doc_id AND b.tenant_id = d.tenant_id
       WHERE ${whereSql}
       ORDER BY d.doc_date DESC, d.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const countRows = await rows<{ status: string; n: number }>(
      deps.db,
      `SELECT status, COUNT(*) AS n FROM ims_bom_dcs WHERE tenant_id = :tenantId GROUP BY status`,
      { tenantId: actor.tenantId },
    );
    const counts: Record<string, number> = { all: 0, draft: 0, verified: 0, approved: 0, cancelled: 0 };
    for (const r of countRows) {
      const n = Number(r.n) || 0;
      counts.all += n;
      if (r.status in counts) counts[r.status] = n;
    }
    const linkedCountRow = await one<{ n: number }>(
      deps.db,
      `SELECT COUNT(*) AS n FROM ims_bom_dcs d
       INNER JOIN ims_bom_docs b ON b.id = d.bom_doc_id AND b.tenant_id = d.tenant_id
       WHERE d.tenant_id = :tenantId AND (
         EXISTS (
           SELECT 1 FROM ims_invoice_dc_links l
           INNER JOIN ims_invoices i ON i.id = l.invoice_id AND i.tenant_id = l.tenant_id
           WHERE l.tenant_id = d.tenant_id AND l.dc_id = d.id AND i.status IN ('draft','issued')
         )
         OR EXISTS (
           SELECT 1 FROM ims_invoices i
           WHERE i.tenant_id = d.tenant_id AND i.id = b.invoice_id AND i.status IN ('draft','issued')
         )
       )`,
      { tenantId: actor.tenantId },
    );
    counts.linked = Number(linkedCountRow?.n ?? 0);
    const dcs = list.map((r) => ({
      ...mapDc(r, undefined, {
        bomDocNo: r.bom_doc_no,
        customerName: r.customer_name,
        quotationRef: r.quotation_ref,
        invoiceLinked: Boolean(r.linked_invoice_id),
        invoiceId: r.linked_invoice_id,
        invoiceNo: r.linked_invoice_no,
        invoiceStatus: r.linked_invoice_status,
      }),
      bomStatus: r.bom_status,
      lineCount: Number(r.line_count) || 0,
      deliveredUnits: round3(money(r.delivered_units)),
      returnedUnits: round3(money(r.returned_units)),
    }));
    res.json({ dcs, total: Number(totalRow?.n ?? 0), limit, offset, counts });
  });

  router.get("/bom/dcs/:id", async (req, res) => {
    requirePerm(res, "bom");
    const dc = await loadDc(deps.db, actorOf(res).tenantId, String(req.params.id));
    if (!dc) throw notFound("Delivery challan not found");
    res.json({ dc });
  });

  router.post("/bom/docs/:id/dcs", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const bomId = String(req.params.id);
    const body = parse(dcCreateInput, req.body);
    const doc = await loaders.loadDoc(deps.db, actor.tenantId, bomId);
    if (!doc) throw notFound("BOM document not found");
    await assertBomAllowsNewDc(deps.db, actor.tenantId, doc);

    const settings = await getSettings(deps, actor.tenantId);
    const docDate = body.docDate ?? todayISO();
    if (docDate > todayISO()) throw badRequest("Challan date can’t be in the future");
    const id = randomUUID();
    const userName = await displayName(deps.db, actor);

    await tx(deps.db, async (conn) => {
      const locked = await one<{ status: string; stock_issued_at: unknown; invoice_id: string | null }>(
        conn,
        `SELECT status, stock_issued_at, invoice_id FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id: bomId },
      );
      if (!locked || locked.status !== "confirmed") throw conflict("Confirm the BOM before creating a delivery challan");
      const fresh = await loaders.loadDoc(conn, actor.tenantId, bomId);
      if (!fresh) throw notFound("BOM document not found");
      await assertBomAllowsNewDc(conn, actor.tenantId, fresh);

      const committed = await committedDcQtyByBomLine(conn, actor.tenantId, bomId);
      const planned = planDcLinesAgainstBom(fresh, body.lines, committed);

      const docNo = await nextDocNo(conn, actor.tenantId, "bom_dc", "DC", docDate, settings.businessName);
      await exec(
        conn,
        `INSERT INTO ims_bom_dcs
           (id, tenant_id, bom_doc_id, doc_no, status, doc_date, ship_to, transporter, vehicle_no, notes, created_by, created_by_name)
         VALUES
           (:id, :tenantId, :bomId, :docNo, 'draft', :docDate, :shipTo, :transporter, :vehicleNo, :notes, :userId, :userName)`,
        {
          id,
          tenantId: actor.tenantId,
          bomId,
          docNo,
          docDate,
          shipTo: body.shipTo ?? null,
          transporter: body.transporter ?? null,
          vehicleNo: body.vehicleNo ?? null,
          notes: body.notes ?? null,
          userId: actor.userId,
          userName,
        },
      );
      let sort = 0;
      for (const p of planned) {
        await exec(
          conn,
          `INSERT INTO ims_bom_dc_lines
             (id, tenant_id, dc_id, bom_line_id, item_id, section, sort_no, description, make_text, qty, unit, remarks)
           VALUES
             (:id, :tenantId, :dcId, :bomLineId, :itemId, :section, :sortNo, :description, :makeText, :qty, :unit, :remarks)`,
          {
            id: randomUUID(),
            tenantId: actor.tenantId,
            dcId: id,
            bomLineId: p.line.id,
            itemId: p.line.itemId,
            section: p.line.section,
            sortNo: sort++,
            description: p.line.description,
            makeText: p.line.makeText,
            qty: p.qty,
            unit: p.line.unit,
            remarks: p.remarks,
          },
        );
      }
    });

    await recordEvent(deps, actor, {
      type: "bom.dc.created",
      entityType: "bom_dc",
      entityId: id,
      summary: `Drafted delivery challan for BOM ${doc.docNo}`,
      payload: { bomDocId: bomId },
    });
    res.status(201).json({ dc: await loadDc(deps.db, actor.tenantId, id) });
  });

  router.patch("/bom/dcs/:id", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const body = parse(dcPatchInput, req.body);
    const existing = await loadDc(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("Delivery challan not found");
    if (existing.status !== "draft") throw conflict("Only draft delivery challans can be edited");
    if (body.docDate !== undefined && body.docDate > todayISO()) {
      throw badRequest("Challan date can’t be in the future");
    }

    const doc = await loaders.loadDoc(deps.db, actor.tenantId, existing.bomDocId);
    if (!doc || doc.status !== "confirmed") throw conflict("BOM must stay confirmed");

    await tx(deps.db, async (conn) => {
      const locked = await one<{ status: string; bom_doc_id: string }>(
        conn,
        `SELECT status, bom_doc_id FROM ims_bom_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id },
      );
      if (!locked || locked.status !== "draft") throw conflict("Only draft delivery challans can be edited");

      const bomLocked = await one<{ status: string }>(
        conn,
        `SELECT status FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id: locked.bom_doc_id },
      );
      if (!bomLocked || bomLocked.status !== "confirmed") throw conflict("BOM must stay confirmed");
      const fresh = await loaders.loadDoc(conn, actor.tenantId, locked.bom_doc_id);
      if (!fresh) throw notFound("BOM document not found");

      if (body.shipTo !== undefined || body.transporter !== undefined || body.vehicleNo !== undefined || body.notes !== undefined || body.docDate !== undefined) {
        await exec(
          conn,
          `UPDATE ims_bom_dcs SET
             doc_date = IF(:hasDate, :docDate, doc_date),
             ship_to = IF(:hasShip, :shipTo, ship_to),
             transporter = IF(:hasTrans, :transporter, transporter),
             vehicle_no = IF(:hasVeh, :vehicleNo, vehicle_no),
             notes = IF(:hasNotes, :notes, notes)
           WHERE tenant_id = :tenantId AND id = :id`,
          {
            tenantId: actor.tenantId,
            id,
            hasDate: body.docDate !== undefined ? 1 : 0,
            docDate: body.docDate ?? null,
            hasShip: body.shipTo !== undefined ? 1 : 0,
            shipTo: body.shipTo ?? null,
            hasTrans: body.transporter !== undefined ? 1 : 0,
            transporter: body.transporter ?? null,
            hasVeh: body.vehicleNo !== undefined ? 1 : 0,
            vehicleNo: body.vehicleNo ?? null,
            hasNotes: body.notes !== undefined ? 1 : 0,
            notes: body.notes ?? null,
          },
        );
      }

      if (body.lines) {
        const committed = await committedDcQtyByBomLine(conn, actor.tenantId, existing.bomDocId, { excludeDcId: id });
        const planned = planDcLinesAgainstBom(fresh, body.lines, committed);
        await exec(conn, `DELETE FROM ims_bom_dc_lines WHERE tenant_id = :tenantId AND dc_id = :dcId`, { tenantId: actor.tenantId, dcId: id });
        let sort = 0;
        for (const p of planned) {
          await exec(
            conn,
            `INSERT INTO ims_bom_dc_lines
               (id, tenant_id, dc_id, bom_line_id, item_id, section, sort_no, description, make_text, qty, unit, remarks)
             VALUES
               (:id, :tenantId, :dcId, :bomLineId, :itemId, :section, :sortNo, :description, :makeText, :qty, :unit, :remarks)`,
            {
              id: randomUUID(),
              tenantId: actor.tenantId,
              dcId: id,
              bomLineId: p.line.id,
              itemId: p.line.itemId,
              section: p.line.section,
              sortNo: sort++,
              description: p.line.description,
              makeText: p.line.makeText,
              qty: p.qty,
              unit: p.line.unit,
              remarks: p.remarks,
            },
          );
        }
      } else {
        // Header-only edit — still ensure current lines fit remaining (concurrent DCs may have reserved qty).
        const lines = await loadDcLines(conn, actor.tenantId, id);
        await assertExistingDcFitsBom(conn, actor.tenantId, fresh, id, lines);
      }
    });

    await recordEvent(deps, actor, {
      type: "bom.dc.updated",
      entityType: "bom_dc",
      entityId: id,
      summary: `Updated delivery challan ${existing.docNo}`,
    });
    res.json({ dc: await loadDc(deps.db, actor.tenantId, id) });
  });

  router.post("/bom/dcs/:id/verify", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const existing = await loadDc(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("Delivery challan not found");
    if (existing.status !== "draft") throw conflict("Only draft delivery challans can be verified");
    if (!existing.lines?.length) throw conflict("Add lines before verifying");

    const name = await displayName(deps.db, actor);
    await tx(deps.db, async (conn) => {
      const locked = await one<{ status: string; bom_doc_id: string; doc_date: unknown }>(
        conn,
        `SELECT status, bom_doc_id, doc_date FROM ims_bom_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id },
      );
      if (!locked || locked.status !== "draft") throw conflict("Only draft delivery challans can be verified");

      await one(
        conn,
        `SELECT id FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id: locked.bom_doc_id },
      );
      const doc = await loaders.loadDoc(conn, actor.tenantId, locked.bom_doc_id);
      if (!doc) throw notFound("BOM document not found");
      const lines = await loadDcLines(conn, actor.tenantId, id);
      await assertExistingDcFitsBom(conn, actor.tenantId, doc, id, lines);
      if (isoOf(locked.doc_date) > todayISO()) throw badRequest("Challan date can’t be in the future");

      const verified = await exec(
        conn,
        `UPDATE ims_bom_dcs SET status = 'verified', verified_by = :userId, verified_by_name = :userName, verified_at = CURRENT_TIMESTAMP
         WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`,
        { tenantId: actor.tenantId, id, userId: actor.userId, userName: name },
      );
      if (!verified.affectedRows) throw conflict("Only draft delivery challans can be verified");
    });
    await recordEvent(deps, actor, {
      type: "bom.dc.verified",
      entityType: "bom_dc",
      entityId: id,
      summary: `Verified delivery challan ${existing.docNo} by ${name}`,
      payload: { verifiedByName: name },
    });
    res.json({ dc: await loadDc(deps.db, actor.tenantId, id) });
  });

  router.post("/bom/dcs/:id/approve", async (req, res) => {
    requirePerm(res, "bom");
    requirePerm(res, "approvals", "Approvals permission is required to approve a delivery challan");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const body = parse(z.object({ date: isoDate.optional() }), req.body);
    const existing = await loadDc(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("Delivery challan not found");
    if (existing.status !== "verified") throw conflict("Verify the delivery challan before approving");
    if (!existing.lines?.length) throw conflict("Delivery challan has no lines");

    const doc = await loaders.loadDoc(deps.db, actor.tenantId, existing.bomDocId);
    if (!doc || doc.status !== "confirmed") throw conflict("BOM must be confirmed");

    const settings = await getSettings(deps, actor.tenantId);
    const date = body.date ?? todayISO();
    if (date > todayISO()) throw badRequest("Stock date can’t be in the future");
    await assertDayOpen(deps.db, actor.tenantId, date);
    const name = await displayName(deps.db, actor);

    const posted = await tx(deps.db, async (conn) => {
      const locked = await one<{ status: string; stock_posted: number; bom_doc_id: string; doc_no: string; doc_date: unknown }>(
        conn,
        `SELECT status, stock_posted, bom_doc_id, doc_no, doc_date FROM ims_bom_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id },
      );
      if (!locked || locked.status !== "verified") throw conflict("Verify the delivery challan before approving");
      if (locked.stock_posted) throw conflict("Stock was already posted for this delivery challan");

      await one(
        conn,
        `SELECT id FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id: locked.bom_doc_id },
      );
      const freshBom = await loaders.loadDoc(conn, actor.tenantId, locked.bom_doc_id);
      if (!freshBom || freshBom.status !== "confirmed") throw conflict("BOM must be confirmed");
      const lines = await loadDcLines(conn, actor.tenantId, id);
      await assertExistingDcFitsBom(conn, actor.tenantId, freshBom, id, lines);
      await assertDayOpen(conn, actor.tenantId, date);
      await assertDcStockAvailable(conn, actor.tenantId, lines, settings.allowNegativeStock);

      const movements = [];
      for (const line of lines) {
        if (!line.itemId || !(line.qty > 0)) continue;
        movements.push(
          await postMovement(
            conn,
            actor,
            {
              itemId: line.itemId,
              type: "OUT",
              qty: line.qty,
              refType: "dc",
              refId: id,
              refNo: locked.doc_no,
              partyId: freshBom.partyId ?? null,
              partyName: freshBom.customerName,
              reason: "Delivery challan (BOM)",
              notes: freshBom.title || freshBom.capacityLabel || null,
              date,
            },
            { allowNegative: settings.allowNegativeStock },
          ),
        );
      }
      if (!movements.length) throw conflict("No stock lines to post");

      const claimed = await exec(
        conn,
        `UPDATE ims_bom_dcs SET
           status = 'approved', stock_posted = 1,
           approved_by = :userId, approved_by_name = :userName, approved_at = CURRENT_TIMESTAMP
         WHERE tenant_id = :tenantId AND id = :id AND status = 'verified' AND stock_posted = 0`,
        { tenantId: actor.tenantId, id, userId: actor.userId, userName: name },
      );
      if (!claimed.affectedRows) throw conflict("Delivery challan was already approved");

      await syncBomIssuedFromDcs(conn, actor.tenantId, locked.bom_doc_id, stockLinesOf(freshBom));
      return movements;
    });

    await recordEvent(deps, actor, {
      type: "bom.dc.approved",
      entityType: "bom_dc",
      entityId: id,
      summary: `Approved delivery challan ${existing.docNo} — stock out (${posted.length} item${posted.length === 1 ? "" : "s"})`,
      payload: { approvedByName: name, count: posted.length },
    });
    res.json({
      dc: await loadDc(deps.db, actor.tenantId, id),
      movements: posted,
      doc: await loaders.loadDoc(deps.db, actor.tenantId, existing.bomDocId),
    });
  });

  router.post("/bom/dcs/:id/cancel", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const existing = await loadDc(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("Delivery challan not found");
    if (existing.status === "cancelled") throw conflict("Delivery challan is already cancelled");
    if (existing.status === "approved") {
      throw conflict("Approved delivery challans must be reversed to return stock");
    }
    // Verified DCs sit in Approvals — only approvers (or owners via approvals perm) may reject them.
    if (existing.status === "verified") {
      requirePerm(res, "approvals", "Approvals permission is required to reject a verified delivery challan");
    }

    await tx(deps.db, async (conn) => {
      const locked = await one<{ status: string; bom_doc_id: string }>(
        conn,
        `SELECT status, bom_doc_id FROM ims_bom_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id },
      );
      if (!locked || !["draft", "verified"].includes(locked.status)) {
        throw conflict("Only draft or verified delivery challans can be cancelled");
      }
      if (locked.status === "verified" && !can(res, "approvals")) {
        throw forbidden("Approvals permission is required to reject a verified delivery challan");
      }
      await one(
        conn,
        `SELECT id FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id: locked.bom_doc_id },
      );
      const linked = await one<{ n: number }>(
        conn,
        `SELECT COUNT(*) AS n FROM ims_invoice_dc_links WHERE tenant_id = :tenantId AND dc_id = :dcId`,
        { tenantId: actor.tenantId, dcId: id },
      );
      if (Number(linked?.n) > 0) throw conflict("Unlink this delivery challan from its invoice before cancelling");
      const cancelled = await exec(
        conn,
        `UPDATE ims_bom_dcs SET status = 'cancelled' WHERE tenant_id = :tenantId AND id = :id AND status IN ('draft','verified')`,
        { tenantId: actor.tenantId, id },
      );
      if (!cancelled.affectedRows) throw conflict("Only draft or verified delivery challans can be cancelled");
    });
    await recordEvent(deps, actor, {
      type: "bom.dc.cancelled",
      entityType: "bom_dc",
      entityId: id,
      summary: `Cancelled delivery challan ${existing.docNo}`,
    });
    res.json({ dc: await loadDc(deps.db, actor.tenantId, id) });
  });

  /**
   * Partial unused return against an approved DC.
   * Posts RETURN_IN with the DC doc_no, marks lines Returned, frees BOM remaining capacity.
   */
  router.post("/bom/dcs/:id/returns", async (req, res) => {
    requirePerm(res, "bom");
    if (!can(res, "approvals") && !can(res, "stockOut")) {
      throw forbidden("Approvals or Stock out permission is required to record a delivery challan return");
    }
    const actor = actorOf(res);
    const id = String(req.params.id);
    const body = parse(
      z.object({
        returnDate: isoDate.optional(),
        notes: optText(2000),
        lines: z
          .array(
            z.object({
              dcLineId: z.string().uuid(),
              qty: z.coerce.number().gt(0).max(1e9),
              remarks: optText(500),
            }),
          )
          .min(1)
          .max(500),
      }),
      req.body,
    );
    const existing = await loadDc(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("Delivery challan not found");
    if (existing.status !== "approved" || !existing.stockPosted) {
      throw conflict("Only approved delivery challans with posted stock can record returns");
    }
    await assertDcFreeOfInvoiceLinks(deps.db, actor.tenantId, id, "return unused materials");
    const returnDate = body.returnDate ?? todayISO();
    if (returnDate > todayISO()) throw badRequest("Return date can’t be in the future");
    await assertDayOpen(deps.db, actor.tenantId, returnDate);
    const settings = await getSettings(deps, actor.tenantId);
    const userName = await displayName(deps.db, actor);
    const returnId = randomUUID();

    const outcome = await tx(deps.db, async (conn) => {
      const locked = await one<{ status: string; stock_posted: number; bom_doc_id: string; doc_no: string }>(
        conn,
        `SELECT status, stock_posted, bom_doc_id, doc_no FROM ims_bom_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id },
      );
      if (!locked || locked.status !== "approved" || !locked.stock_posted) {
        throw conflict("Only approved delivery challans with posted stock can record returns");
      }
      await one(
        conn,
        `SELECT id FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id: locked.bom_doc_id },
      );
      await assertDcFreeOfInvoiceLinks(conn, actor.tenantId, id, "return unused materials");
      await assertDayOpen(conn, actor.tenantId, returnDate);

      const dcLines = await loadDcLines(conn, actor.tenantId, id);
      const byId = new Map(dcLines.map((l) => [l.id, l]));
      if (new Set(body.lines.map((l) => l.dcLineId)).size !== body.lines.length) {
        throw badRequest("Each DC line may only appear once on a return");
      }

      const planned: Array<{ line: BomDcLine; qty: number; remarks: string | null }> = [];
      for (const reqLine of body.lines) {
        const line = byId.get(reqLine.dcLineId);
        if (!line) throw badRequest("Return line must belong to this delivery challan");
        if (!line.itemId) throw conflict(`“${line.description}” has no catalogue item`);
        const rem = returnableDcQty(line.qty, line.returnedQty);
        const qty = round3(reqLine.qty);
        if (!(qty > 0)) throw conflict(`Return quantity must be greater than zero for “${line.description}”`);
        if (qty > rem + 1e-9) {
          throw conflict(
            rem <= 0
              ? `Nothing left to return for “${line.description}” on ${locked.doc_no}`
              : `Only ${rem} ${line.unit} can still be returned for “${line.description}” on ${locked.doc_no}`,
          );
        }
        planned.push({ line, qty, remarks: reqLine.remarks ?? null });
      }

      const returnNo = await nextDocNo(conn, actor.tenantId, "bom_dc_rtn", "RTN", returnDate, settings.businessName);
      await exec(
        conn,
        `INSERT INTO ims_bom_dc_returns
           (id, tenant_id, dc_id, bom_doc_id, return_no, return_date, notes, created_by, created_by_name)
         VALUES
           (:id, :tenantId, :dcId, :bomId, :returnNo, :returnDate, :notes, :userId, :userName)`,
        {
          id: returnId,
          tenantId: actor.tenantId,
          dcId: id,
          bomId: locked.bom_doc_id,
          returnNo,
          returnDate,
          notes: body.notes ?? null,
          userId: actor.userId,
          userName,
        },
      );

      const movements = [];
      const freshBom = await loaders.loadDoc(conn, actor.tenantId, locked.bom_doc_id);
      for (const p of planned) {
        await exec(
          conn,
          `INSERT INTO ims_bom_dc_return_lines
             (id, tenant_id, return_id, dc_id, dc_line_id, bom_line_id, item_id, description, qty, unit, remarks)
           VALUES
             (:id, :tenantId, :returnId, :dcId, :dcLineId, :bomLineId, :itemId, :description, :qty, :unit, :remarks)`,
          {
            id: randomUUID(),
            tenantId: actor.tenantId,
            returnId,
            dcId: id,
            dcLineId: p.line.id,
            bomLineId: p.line.bomLineId,
            itemId: p.line.itemId,
            description: p.line.description,
            qty: p.qty,
            unit: p.line.unit,
            remarks: p.remarks,
          },
        );
        const bumped = await exec(
          conn,
          `UPDATE ims_bom_dc_lines
           SET returned_qty = ROUND(returned_qty + :qty, 3)
           WHERE tenant_id = :tenantId AND id = :lineId AND dc_id = :dcId
             AND ROUND(returned_qty + :qty, 3) <= ROUND(qty, 3)`,
          { tenantId: actor.tenantId, lineId: p.line.id, dcId: id, qty: p.qty },
        );
        if (!bumped.affectedRows) {
          throw conflict(`Could not return ${p.qty} ${p.line.unit} for “${p.line.description}” — exceed delivered qty or concurrent return`);
        }
        movements.push(
          await postMovement(
            conn,
            actor,
            {
              itemId: p.line.itemId!,
              type: "RETURN_IN",
              qty: p.qty,
              refType: "dc",
              refId: id,
              refNo: locked.doc_no,
              partyId: freshBom?.partyId ?? null,
              partyName: freshBom?.customerName ?? null,
              reason: "Delivery challan return (unused)",
              notes: `Return ${returnNo} · ${p.remarks || p.line.description}`,
              date: returnDate,
            },
            { allowNegative: settings.allowNegativeStock },
          ),
        );
      }

      await syncBomIssuedFromDcs(conn, actor.tenantId, locked.bom_doc_id, stockLinesOf(freshBom!));
      return { movements, returnNo, bomDocId: locked.bom_doc_id };
    });

    await recordEvent(deps, actor, {
      type: "bom.dc.returned",
      entityType: "bom_dc_return",
      entityId: returnId,
      summary: `Returned unused materials on ${existing.docNo} (${outcome.returnNo})`,
      payload: { dcId: id, returnId, returnNo: outcome.returnNo, count: outcome.movements.length },
    });
    const dc = await loadDc(deps.db, actor.tenantId, id);
    const rtn = dc?.returns?.find((r) => r.id === returnId) ?? null;
    res.status(201).json({
      return: rtn,
      dc,
      movements: outcome.movements,
      doc: await loaders.loadDoc(deps.db, actor.tenantId, outcome.bomDocId),
    });
  });

  router.get("/bom/dcs/:id/returns", async (req, res) => {
    requirePerm(res, "bom");
    const dc = await loadDc(deps.db, actorOf(res).tenantId, String(req.params.id));
    if (!dc) throw notFound("Delivery challan not found");
    res.json({ returns: dc.returns ?? [], dcDocNo: dc.docNo });
  });

  /** Tenant-wide unused-material returns (Bill of Materials → DC & Returns → Returns). */
  router.get("/bom/dc-returns", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const q = qstr(req.query.q, 80);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.min(10_000, Math.max(0, Number(req.query.offset) || 0));
    const like = q ? `%${q.replace(/[%_]/g, "")}%` : "";
    const params: Record<string, unknown> = { tenantId: actor.tenantId };
    const where: string[] = ["r.tenant_id = :tenantId"];
    if (like) {
      where.push(
        `(r.return_no LIKE :like OR IFNULL(d.doc_no,'') LIKE :like OR IFNULL(b.doc_no,'') LIKE :like OR IFNULL(b.customer_name,'') LIKE :like OR IFNULL(r.notes,'') LIKE :like)`,
      );
      params.like = like;
    }
    const whereSql = where.join(" AND ");
    const totalRow = await one<{ n: number }>(
      deps.db,
      `SELECT COUNT(*) AS n
       FROM ims_bom_dc_returns r
       INNER JOIN ims_bom_dcs d ON d.id = r.dc_id AND d.tenant_id = r.tenant_id
       INNER JOIN ims_bom_docs b ON b.id = r.bom_doc_id AND b.tenant_id = r.tenant_id
       WHERE ${whereSql}`,
      params,
    );
    const headers = await rows<{
      id: string;
      dc_id: string;
      bom_doc_id: string;
      return_no: string;
      return_date: unknown;
      notes: string | null;
      created_by_name: string | null;
      created_at: unknown;
      dc_doc_no: string;
      dc_status: string;
      bom_doc_no: string;
      customer_name: string | null;
      units: string | number;
      line_count: number;
    }>(
      deps.db,
      `SELECT r.id, r.dc_id, r.bom_doc_id, r.return_no, r.return_date, r.notes, r.created_by_name, r.created_at,
              d.doc_no AS dc_doc_no, d.status AS dc_status, b.doc_no AS bom_doc_no, b.customer_name,
              (SELECT COALESCE(SUM(l.qty), 0) FROM ims_bom_dc_return_lines l WHERE l.tenant_id = r.tenant_id AND l.return_id = r.id) AS units,
              (SELECT COUNT(*) FROM ims_bom_dc_return_lines l WHERE l.tenant_id = r.tenant_id AND l.return_id = r.id) AS line_count
       FROM ims_bom_dc_returns r
       INNER JOIN ims_bom_dcs d ON d.id = r.dc_id AND d.tenant_id = r.tenant_id
       INNER JOIN ims_bom_docs b ON b.id = r.bom_doc_id AND b.tenant_id = r.tenant_id
       WHERE ${whereSql}
       ORDER BY r.return_date DESC, r.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const returns = [];
    for (const h of headers) {
      const lineRows = await rows<{
        id: string;
        return_id: string;
        dc_id: string;
        dc_line_id: string;
        bom_line_id: string;
        item_id: string | null;
        description: string;
        qty: string | number;
        unit: string;
        remarks: string | null;
      }>(
        deps.db,
        `SELECT id, return_id, dc_id, dc_line_id, bom_line_id, item_id, description, qty, unit, remarks
         FROM ims_bom_dc_return_lines WHERE tenant_id = :tenantId AND return_id = :returnId
         ORDER BY created_at ASC`,
        { tenantId: actor.tenantId, returnId: h.id },
      );
      returns.push({
        id: h.id,
        dcId: h.dc_id,
        bomDocId: h.bom_doc_id,
        returnNo: h.return_no,
        returnDate: isoOf(h.return_date),
        notes: h.notes,
        createdByName: h.created_by_name,
        createdAt: tsOf(h.created_at),
        dcDocNo: h.dc_doc_no,
        dcStatus: h.dc_status,
        bomDocNo: h.bom_doc_no,
        customerName: h.customer_name,
        units: round3(money(h.units)),
        lineCount: Number(h.line_count) || 0,
        lines: lineRows.map((l) => ({
          id: l.id,
          returnId: l.return_id,
          dcId: l.dc_id,
          dcLineId: l.dc_line_id,
          bomLineId: l.bom_line_id,
          itemId: l.item_id,
          description: l.description,
          qty: round3(money(l.qty)),
          unit: l.unit,
          remarks: l.remarks,
        })),
      });
    }
    res.json({ returns, total: Number(totalRow?.n ?? 0), limit, offset });
  });

  /** Single unused-material return (RTN doc) with DC / BOM context. */
  router.get("/bom/dc-returns/:id", async (req, res) => {
    requirePerm(res, "bom");
    const actor = actorOf(res);
    const id = String(req.params.id);
    const mapped = await loadDcReturnDetail(deps.db, actor.tenantId, id);
    if (!mapped) throw notFound("Return not found");
    res.json({ return: mapped });
  });

  /**
   * Maintain a posted return paper: date, notes, and line remarks.
   * Quantities stay fixed (stock already returned); amend by posting another return on the DC.
   */
  router.patch("/bom/dc-returns/:id", async (req, res) => {
    requirePerm(res, "bom");
    if (!can(res, "approvals") && !can(res, "stockOut")) {
      throw forbidden("Approvals or Stock out permission is required to maintain a material return");
    }
    const actor = actorOf(res);
    const id = String(req.params.id);
    const body = parse(
      z.object({
        returnDate: isoDate.optional(),
        notes: optText(2000),
        lines: z
          .array(
            z.object({
              id: z.string().uuid(),
              remarks: optText(500),
            }),
          )
          .max(500)
          .optional(),
      }),
      req.body,
    );
    const existing = await loadDcReturnDetail(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("Return not found");
    // Return date is frozen after stock RETURN_IN — changing it would desync the ledger / day close.
    if (body.returnDate != null && body.returnDate !== existing.returnDate) {
      throw conflict("Return date can’t be changed after stock was received. Notes and line remarks can still be updated.");
    }

    await tx(deps.db, async (conn) => {
      const locked = await one<{ id: string }>(
        conn,
        `SELECT id FROM ims_bom_dc_returns WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id },
      );
      if (!locked) throw notFound("Return not found");
      if (body.notes !== undefined) {
        await exec(
          conn,
          `UPDATE ims_bom_dc_returns SET notes = :notes WHERE tenant_id = :tenantId AND id = :id`,
          { tenantId: actor.tenantId, id, notes: body.notes ?? null },
        );
      }
      if (body.lines?.length) {
        const allowed = new Set((existing.lines ?? []).map((l) => l.id));
        for (const line of body.lines) {
          if (!allowed.has(line.id)) throw badRequest("Return line does not belong to this return");
          await exec(
            conn,
            `UPDATE ims_bom_dc_return_lines SET remarks = :remarks
             WHERE tenant_id = :tenantId AND return_id = :returnId AND id = :lineId`,
            { tenantId: actor.tenantId, returnId: id, lineId: line.id, remarks: line.remarks ?? null },
          );
        }
      }
    });

    await recordEvent(deps, actor, {
      type: "bom.dc.return.updated",
      entityType: "bom_dc_return",
      entityId: id,
      summary: `Updated material return ${existing.returnNo}`,
    });
    const mapped = await loadDcReturnDetail(deps.db, actor.tenantId, id);
    res.json({ return: mapped });
  });

  /** Reverse an approved DC: RETURN_IN remaining net stock and cancel. */
  router.post("/bom/dcs/:id/reverse", async (req, res) => {
    requirePerm(res, "bom");
    if (!can(res, "approvals") && !can(res, "stockOut")) {
      throw forbidden("Approvals or Stock out permission is required to reverse a delivery challan");
    }
    const actor = actorOf(res);
    const id = String(req.params.id);
    const body = parse(z.object({ date: isoDate.optional() }), req.body);
    const existing = await loadDc(deps.db, actor.tenantId, id);
    if (!existing) throw notFound("Delivery challan not found");
    if (existing.status !== "approved" || !existing.stockPosted) {
      throw conflict("Only approved delivery challans with posted stock can be reversed");
    }
    await assertDcFreeOfInvoiceLinks(deps.db, actor.tenantId, id, "reverse");

    const settings = await getSettings(deps, actor.tenantId);
    const date = body.date ?? todayISO();
    if (date > todayISO()) throw badRequest("Stock date can’t be in the future");
    await assertDayOpen(deps.db, actor.tenantId, date);

    const posted = await tx(deps.db, async (conn) => {
      const locked = await one<{ status: string; stock_posted: number; bom_doc_id: string; doc_no: string }>(
        conn,
        `SELECT status, stock_posted, bom_doc_id, doc_no FROM ims_bom_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id },
      );
      if (!locked || locked.status !== "approved" || !locked.stock_posted) {
        throw conflict("Only approved delivery challans with posted stock can be reversed");
      }
      await one(
        conn,
        `SELECT id FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id: locked.bom_doc_id },
      );
      await assertDcFreeOfInvoiceLinks(conn, actor.tenantId, id, "reverse");
      await assertDayOpen(conn, actor.tenantId, date);
      const freshBom = await loaders.loadDoc(conn, actor.tenantId, locked.bom_doc_id);
      const lines = await loadDcLines(conn, actor.tenantId, id);
      const movements = [];
      for (const line of lines) {
        // Only return what is still out (qty already returned via partial returns stays as history).
        if (!line.itemId || !(line.netQty > 0)) continue;
        movements.push(
          await postMovement(
            conn,
            actor,
            {
              itemId: line.itemId,
              type: "RETURN_IN",
              qty: line.netQty,
              refType: "dc",
              refId: id,
              refNo: locked.doc_no,
              partyId: freshBom?.partyId ?? null,
              partyName: freshBom?.customerName ?? null,
              reason: line.returnedQty > 0 ? "Delivery challan reverse (remaining after returns)" : "Delivery challan reverse",
              date,
            },
            { allowNegative: settings.allowNegativeStock },
          ),
        );
      }
      await exec(
        conn,
        `UPDATE ims_bom_dcs SET status = 'cancelled', stock_posted = 0 WHERE tenant_id = :tenantId AND id = :id`,
        { tenantId: actor.tenantId, id },
      );
      await syncBomIssuedFromDcs(conn, actor.tenantId, locked.bom_doc_id, stockLinesOf(freshBom!));
      return movements;
    });

    await recordEvent(deps, actor, {
      type: "bom.dc.reversed",
      entityType: "bom_dc",
      entityId: id,
      summary: `Reversed delivery challan ${existing.docNo}`,
      payload: { count: posted.length },
    });
    res.json({
      dc: await loadDc(deps.db, actor.tenantId, id),
      movements: posted,
      doc: await loaders.loadDoc(deps.db, actor.tenantId, existing.bomDocId),
    });
  });

  router.get("/invoices/:id/dc-links", async (req, res) => {
    requirePerm(res, "sales");
    const actor = actorOf(res);
    const invoiceId = String(req.params.id);
    const ids = await listInvoiceDcIds(deps.db, actor.tenantId, invoiceId);
    const dcs = [];
    for (const dcId of ids) {
      const dc = await loadDc(deps.db, actor.tenantId, dcId);
      if (dc) dcs.push(dc);
    }
    res.json({ dcIds: ids, dcs });
  });

  router.put("/invoices/:id/dc-links", async (req, res) => {
    requirePerm(res, "sales");
    const actor = actorOf(res);
    const invoiceId = String(req.params.id);
    const body = parse(z.object({ dcIds: z.array(z.string().uuid()).max(100) }), req.body);
    const ids = await tx(deps.db, async (conn) => {
      const inv = await one<{ id: string; status: string; source_tool: string | null; source_ref: string | null }>(
        conn,
        `SELECT id, status, source_tool, source_ref FROM ims_invoices WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id: invoiceId },
      );
      if (!inv) throw notFound("Invoice");
      if (inv.status !== "draft") throw conflict("Only draft invoices can change delivery challan links");
      if (body.dcIds.length && !(inv.source_tool === "ims_bom" && inv.source_ref)) {
        throw conflict("Delivery challan links are only for invoices created from a BOM");
      }
      if (body.dcIds.length) {
        await assertDcsLinkable(conn, actor.tenantId, inv.source_ref!, body.dcIds, { invoiceId });
      }
      await linkInvoiceDcs(conn, actor.tenantId, invoiceId, body.dcIds);
      return listInvoiceDcIds(conn, actor.tenantId, invoiceId);
    });
    res.json({ dcIds: ids });
  });
}

/** Block return/reverse while a live draft/issued invoice holds this DC (direct link or BOM invoice). */
async function assertDcFreeOfInvoiceLinks(db: Queryable, tenantId: number, dcId: string, action: string): Promise<void> {
  const hold = await loadDcInvoiceLink(db, tenantId, dcId);
  if (!hold) return;
  if (hold.via === "bom_invoice") {
    if (hold.invoiceStatus === "draft") {
      throw conflict(
        `This BOM already has a draft invoice${hold.invoiceNo ? ` (${hold.invoiceNo})` : ""}. Cancel or delete that invoice before you ${action}.`,
      );
    }
    throw conflict(
      `This BOM is billed on issued invoice ${hold.invoiceNo || ""}. Cancel that invoice before you ${action} (stock remains on the delivery challan).`
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
  if (hold.invoiceStatus === "draft") {
    throw conflict(
      `This delivery challan is linked to a draft invoice${hold.invoiceNo ? ` (${hold.invoiceNo})` : ""}. Unlink it from the invoice (or delete the draft) before you ${action}.`,
    );
  }
  throw conflict(
    `This delivery challan is linked to issued invoice ${hold.invoiceNo || ""}. Cancel that invoice before you ${action} (stock remains on the delivery challan).`
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/** All approved + stock-posted DC ids on a BOM (for invoice link completeness). */
export async function listApprovedPostedDcIds(db: Queryable, tenantId: number, bomDocId: string): Promise<string[]> {
  const list = await rows<{ id: string }>(
    db,
    `SELECT id FROM ims_bom_dcs
     WHERE tenant_id = :tenantId AND bom_doc_id = :bomDocId AND status = 'approved' AND stock_posted = 1
     ORDER BY doc_date ASC, created_at ASC`,
    { tenantId, bomDocId },
  );
  return list.map((r) => r.id);
}

/** True when any live DC exists for the BOM (blocks reopen / legacy stock issue). */
export async function bomHasLiveDcs(db: Queryable, tenantId: number, bomDocId: string): Promise<boolean> {
  const row = await one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM ims_bom_dcs
     WHERE tenant_id = :tenantId AND bom_doc_id = :bomDocId AND status IN ('draft','verified','approved')`,
    { tenantId, bomDocId },
  );
  return Number(row?.n ?? 0) > 0;
}

/** True when at least one approved (stock-posted) DC exists — distinguishes DC stock from invoice explode. */
export async function bomHasApprovedDcs(db: Queryable, tenantId: number, bomDocId: string): Promise<boolean> {
  const row = await one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM ims_bom_dcs
     WHERE tenant_id = :tenantId AND bom_doc_id = :bomDocId AND status = 'approved' AND stock_posted = 1`,
    { tenantId, bomDocId },
  );
  return Number(row?.n ?? 0) > 0;
}

export { LIVE_STATUSES };

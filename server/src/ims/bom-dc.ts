/**
 * Delivery Challans (DC) for confirmed BOMs.
 * draft → verified (bom) → approved (approvals) → stock OUT.
 * Multiple DCs may partially deliver one BOM. Invoice stock OUT only when no DC links exist.
 */
import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BomDoc, BomDocLine } from "./bom.js";
import { remainingIssueQty } from "./bom-enhance.js";
import { actorName, actorOf, can, isoDate, optText, parse, qstr, recordEvent, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { badRequest, conflict, forbidden, notFound } from "./host.js";
import { round3, todayISO } from "./logic.js";
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
  unit: string;
  remarks: string | null;
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
  bomDocNo?: string | null;
  customerName?: string | null;
};

const statusOf = (v: string): BomDcStatus => ((BOM_DC_STATUSES as readonly string[]).includes(v) ? (v as BomDcStatus) : "draft");

function mapLine(r: DcLineRow): BomDcLine {
  return {
    id: r.id,
    dcId: r.dc_id,
    bomLineId: r.bom_line_id,
    itemId: r.item_id,
    section: r.section,
    sortNo: Number(r.sort_no),
    description: r.description,
    makeText: r.make_text,
    qty: round3(money(r.qty)),
    unit: r.unit,
    remarks: r.remarks,
  };
}

function mapDc(r: DcRow, lines?: BomDcLine[], extra?: { bomDocNo?: string | null; customerName?: string | null }): BomDc {
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
    bomDocNo: extra?.bomDocNo ?? null,
    customerName: extra?.customerName ?? null,
  };
}

async function loadDcLines(db: Queryable, tenantId: number, dcId: string): Promise<BomDcLine[]> {
  const list = await rows<DcLineRow>(
    db,
    `SELECT id, dc_id, bom_line_id, item_id, section, sort_no, description, make_text, qty, unit, remarks
     FROM ims_bom_dc_lines WHERE tenant_id = :tenantId AND dc_id = :dcId ORDER BY sort_no ASC, created_at ASC`,
    { tenantId, dcId },
  );
  return list.map(mapLine);
}

export async function loadDc(db: Queryable, tenantId: number, id: string): Promise<BomDc | null> {
  const r = await one<DcRow & { bom_doc_no?: string; customer_name?: string }>(
    db,
    `SELECT d.*, b.doc_no AS bom_doc_no, b.customer_name
     FROM ims_bom_dcs d
     LEFT JOIN ims_bom_docs b ON b.id = d.bom_doc_id AND b.tenant_id = d.tenant_id
     WHERE d.tenant_id = :tenantId AND d.id = :id LIMIT 1`,
    { tenantId, id },
  );
  if (!r) return null;
  return mapDc(r, await loadDcLines(db, tenantId, id), { bomDocNo: r.bom_doc_no ?? null, customerName: r.customer_name ?? null });
}

/** Qty already on live (non-cancelled) DCs for each BOM line — reserves draft/verified/approved. */
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
  const list = await rows<{ bom_line_id: string; qty: string }>(
    db,
    `SELECT l.bom_line_id, SUM(l.qty) AS qty
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

/** Qty delivered (approved + stock posted) per BOM line. */
async function approvedDcQtyByBomLine(db: Queryable, tenantId: number, bomDocId: string): Promise<Map<string, number>> {
  const list = await rows<{ bom_line_id: string; qty: string }>(
    db,
    `SELECT l.bom_line_id, SUM(l.qty) AS qty
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

export async function syncBomIssuedFromDcs(db: Queryable, tenantId: number, bomDocId: string, stockLines: BomDocLine[]): Promise<void> {
  const approved = await approvedDcQtyByBomLine(db, tenantId, bomDocId);
  const approvedCount = await one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM ims_bom_dcs
     WHERE tenant_id = :tenantId AND bom_doc_id = :bomDocId AND status = 'approved' AND stock_posted = 1`,
    { tenantId, bomDocId },
  );
  let anyIssued = false;
  let allDone = stockLines.length > 0;
  for (const line of stockLines) {
    const issued = approved.get(line.id) ?? 0;
    if (issued > 0) anyIssued = true;
    if (remainingIssueQty(line.qty, issued) > 0) allDone = false;
    await exec(
      db,
      `UPDATE ims_bom_doc_lines SET issued_qty = :issued WHERE tenant_id = :tenantId AND doc_id = :docId AND id = :lineId`,
      { tenantId, docId: bomDocId, lineId: line.id, issued },
    );
  }
  if (allDone && anyIssued) {
    await exec(
      db,
      `UPDATE ims_bom_docs
       SET stock_issued_at = COALESCE(stock_issued_at, CURRENT_TIMESTAMP), stock_issue_count = :n
       WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId, id: bomDocId, n: Number(approvedCount?.n ?? 0) },
    );
  } else if (!anyIssued) {
    await exec(
      db,
      `UPDATE ims_bom_docs SET stock_issued_at = NULL, stock_issue_count = 0 WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId, id: bomDocId },
    );
  } else {
    await exec(
      db,
      `UPDATE ims_bom_docs
       SET stock_issued_at = COALESCE(stock_issued_at, CURRENT_TIMESTAMP), stock_issue_count = :n
       WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId, id: bomDocId, n: Number(approvedCount?.n ?? 0) },
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
    dcs.push(dc);
  }
  return dcs;
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

function displayName(actor: Parameters<typeof actorName>[0]): string {
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
      const remaining = remainingIssueQty(l.qty, committedQty);
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
        issuedQty: l.issuedQty ?? 0,
      };
    });
    res.json({ bomDocId: bomId, lines });
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
      dcs.push(mapDc(r, await loadDcLines(deps.db, actor.tenantId, r.id), { bomDocNo: doc.docNo, customerName: doc.customerName }));
    }
    res.json({ dcs, bomDocNo: doc.docNo });
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
    if (doc.status !== "confirmed") throw conflict("Confirm the BOM before creating a delivery challan");

    const stock = stockLinesOf(doc);
    if (!stock.length) throw conflict("No stock-linked lines on this BOM");
    const byId = new Map(stock.map((l) => [l.id, l]));
    if (new Set(body.lines.map((l) => l.bomLineId)).size !== body.lines.length) {
      throw badRequest("Each BOM line may only appear once on a delivery challan");
    }

    const settings = await getSettings(deps, actor.tenantId);
    const docDate = body.docDate ?? todayISO();
    const id = randomUUID();

    await tx(deps.db, async (conn) => {
      const locked = await one<{ status: string }>(
        conn,
        `SELECT status FROM ims_bom_docs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id: bomId },
      );
      if (!locked || locked.status !== "confirmed") throw conflict("Confirm the BOM before creating a delivery challan");

      const committed = await committedDcQtyByBomLine(conn, actor.tenantId, bomId);
      const planned: Array<{ line: BomDocLine; qty: number; remarks: string | null }> = [];
      for (const reqLine of body.lines) {
        const line = byId.get(reqLine.bomLineId);
        if (!line) throw badRequest("Only stock lines linked to a catalogue item can go on a delivery challan");
        const rem = remainingIssueQty(line.qty, committed.get(line.id) ?? 0);
        const qty = round3(Math.min(reqLine.qty, rem));
        if (!(qty > 0)) throw conflict(`No remaining quantity for “${line.description}”`);
        if (reqLine.qty > rem + 1e-9) throw conflict(`Only ${rem} ${line.unit} remaining for “${line.description}”`);
        planned.push({ line, qty, remarks: reqLine.remarks ?? null });
      }

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
          userName: displayName(actor),
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

    const doc = await loaders.loadDoc(deps.db, actor.tenantId, existing.bomDocId);
    if (!doc || doc.status !== "confirmed") throw conflict("BOM must stay confirmed");

    await tx(deps.db, async (conn) => {
      const locked = await one<{ status: string; bom_doc_id: string }>(
        conn,
        `SELECT status, bom_doc_id FROM ims_bom_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id },
      );
      if (!locked || locked.status !== "draft") throw conflict("Only draft delivery challans can be edited");

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
        const stock = stockLinesOf(doc);
        const byId = new Map(stock.map((l) => [l.id, l]));
        if (new Set(body.lines.map((l) => l.bomLineId)).size !== body.lines.length) {
          throw badRequest("Each BOM line may only appear once on a delivery challan");
        }
        const committed = await committedDcQtyByBomLine(conn, actor.tenantId, existing.bomDocId, { excludeDcId: id });
        await exec(conn, `DELETE FROM ims_bom_dc_lines WHERE tenant_id = :tenantId AND dc_id = :dcId`, { tenantId: actor.tenantId, dcId: id });
        let sort = 0;
        for (const reqLine of body.lines) {
          const line = byId.get(reqLine.bomLineId);
          if (!line) throw badRequest("Only stock lines linked to a catalogue item can go on a delivery challan");
          const rem = remainingIssueQty(line.qty, committed.get(line.id) ?? 0);
          if (reqLine.qty > rem + 1e-9) throw conflict(`Only ${rem} ${line.unit} remaining for “${line.description}”`);
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
              bomLineId: line.id,
              itemId: line.itemId,
              section: line.section,
              sortNo: sort++,
              description: line.description,
              makeText: line.makeText,
              qty: round3(reqLine.qty),
              unit: line.unit,
              remarks: reqLine.remarks ?? null,
            },
          );
        }
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

    const name = displayName(actor);
    const verified = await exec(
      deps.db,
      `UPDATE ims_bom_dcs SET status = 'verified', verified_by = :userId, verified_by_name = :userName, verified_at = CURRENT_TIMESTAMP
       WHERE tenant_id = :tenantId AND id = :id AND status = 'draft'`,
      { tenantId: actor.tenantId, id, userId: actor.userId, userName: name },
    );
    if (!verified.affectedRows) throw conflict("Only draft delivery challans can be verified");
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
    const name = displayName(actor);

    const posted = await tx(deps.db, async (conn) => {
      const locked = await one<{ status: string; stock_posted: number; bom_doc_id: string; doc_no: string }>(
        conn,
        `SELECT status, stock_posted, bom_doc_id, doc_no FROM ims_bom_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id },
      );
      if (!locked || locked.status !== "verified") throw conflict("Verify the delivery challan before approving");
      if (locked.stock_posted) throw conflict("Stock was already posted for this delivery challan");

      const lines = await loadDcLines(conn, actor.tenantId, id);
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
              partyId: doc.partyId ?? null,
              partyName: doc.customerName,
              reason: "Delivery challan (BOM)",
              notes: doc.title || doc.capacityLabel || null,
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

      const fresh = await loaders.loadDoc(conn, actor.tenantId, locked.bom_doc_id);
      await syncBomIssuedFromDcs(conn, actor.tenantId, locked.bom_doc_id, stockLinesOf(fresh!));
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
    const linked = await one<{ n: number }>(
      deps.db,
      `SELECT COUNT(*) AS n FROM ims_invoice_dc_links WHERE tenant_id = :tenantId AND dc_id = :dcId`,
      { tenantId: actor.tenantId, dcId: id },
    );
    if (Number(linked?.n) > 0) throw conflict("Unlink this delivery challan from its invoice before cancelling");

    const cancelled = await exec(
      deps.db,
      `UPDATE ims_bom_dcs SET status = 'cancelled' WHERE tenant_id = :tenantId AND id = :id AND status IN ('draft','verified')`,
      { tenantId: actor.tenantId, id },
    );
    if (!cancelled.affectedRows) throw conflict("Only draft or verified delivery challans can be cancelled");
    await recordEvent(deps, actor, {
      type: "bom.dc.cancelled",
      entityType: "bom_dc",
      entityId: id,
      summary: `Cancelled delivery challan ${existing.docNo}`,
    });
    res.json({ dc: await loadDc(deps.db, actor.tenantId, id) });
  });

  /** Reverse an approved DC: RETURN_IN stock and cancel. */
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
    const linked = await one<{ n: number }>(
      deps.db,
      `SELECT COUNT(*) AS n FROM ims_invoice_dc_links l
       INNER JOIN ims_invoices i ON i.id = l.invoice_id AND i.tenant_id = l.tenant_id
       WHERE l.tenant_id = :tenantId AND l.dc_id = :dcId AND i.status = 'issued'`,
      { tenantId: actor.tenantId, dcId: id },
    );
    if (Number(linked?.n) > 0) {
      throw conflict("This delivery challan is linked to an issued invoice. Cancel or unlink the invoice first.");
    }

    const doc = await loaders.loadDoc(deps.db, actor.tenantId, existing.bomDocId);
    const settings = await getSettings(deps, actor.tenantId);
    const date = body.date ?? todayISO();

    const posted = await tx(deps.db, async (conn) => {
      const locked = await one<{ status: string; stock_posted: number; bom_doc_id: string; doc_no: string }>(
        conn,
        `SELECT status, stock_posted, bom_doc_id, doc_no FROM ims_bom_dcs WHERE tenant_id = :tenantId AND id = :id LIMIT 1 FOR UPDATE`,
        { tenantId: actor.tenantId, id },
      );
      if (!locked || locked.status !== "approved" || !locked.stock_posted) {
        throw conflict("Only approved delivery challans with posted stock can be reversed");
      }
      const lines = await loadDcLines(conn, actor.tenantId, id);
      const movements = [];
      for (const line of lines) {
        if (!line.itemId || !(line.qty > 0)) continue;
        movements.push(
          await postMovement(
            conn,
            actor,
            {
              itemId: line.itemId,
              type: "RETURN_IN",
              qty: line.qty,
              refType: "dc",
              refId: id,
              refNo: locked.doc_no,
              partyId: doc?.partyId ?? null,
              partyName: doc?.customerName ?? null,
              reason: "Delivery challan reverse",
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
      await exec(conn, `DELETE FROM ims_invoice_dc_links WHERE tenant_id = :tenantId AND dc_id = :dcId`, {
        tenantId: actor.tenantId,
        dcId: id,
      });
      const fresh = await loaders.loadDoc(conn, actor.tenantId, locked.bom_doc_id);
      await syncBomIssuedFromDcs(conn, actor.tenantId, locked.bom_doc_id, stockLinesOf(fresh!));
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
    const inv = await one<{ id: string; status: string; source_tool: string | null; source_ref: string | null }>(
      deps.db,
      `SELECT id, status, source_tool, source_ref FROM ims_invoices WHERE tenant_id = :tenantId AND id = :id LIMIT 1`,
      { tenantId: actor.tenantId, id: invoiceId },
    );
    if (!inv) throw notFound("Invoice");
    if (inv.status !== "draft") throw conflict("Only draft invoices can change delivery challan links");

    if (body.dcIds.length) {
      // All DCs must share one BOM (prefer invoice source_ref when from BOM).
      const first = await loadDc(deps.db, actor.tenantId, body.dcIds[0]!);
      if (!first) throw notFound("Delivery challan not found");
      const bomId = inv.source_tool === "ims_bom" && inv.source_ref ? inv.source_ref : first.bomDocId;
      await assertDcsLinkable(deps.db, actor.tenantId, bomId, body.dcIds);
    }
    await linkInvoiceDcs(deps.db, actor.tenantId, invoiceId, body.dcIds);
    const ids = await listInvoiceDcIds(deps.db, actor.tenantId, invoiceId);
    res.json({ dcIds: ids });
  });
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

export { LIVE_STATUSES };

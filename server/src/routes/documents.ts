import { Router } from "express";
import { pool } from "../db.js";
import { isDocumentToolId } from "../lib/constants.js";
import { getActiveProfileId } from "../lib/request-context.js";
import { getDocumentUsage, syncDocumentUsage } from "../lib/document-usage.js";
import {
  newDocumentId,
  syncInvoiceToPaymentTracker,
} from "../lib/documents.js";
import { syncToolUsage } from "../lib/usage.js";
import { LimitReachedError, runCreateWithLimit } from "../lib/usage-limits.js";
import { logAudit } from "../lib/audit.js";
import { requireWriteAccess } from "../middleware/require-write.js";
import { ValidationError, validateDocumentState } from "../lib/validation/record-data.js";

const router = Router();

router.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") {
    next();
    return;
  }
  void requireWriteAccess(req, res, next);
});

type DocumentRow = {
  id: string;
  tool_id: string;
  doc_no: string;
  doc_date: string;
  extra_date: string | null;
  party_name: string | null;
  grand_total: number | string;
  status: string;
  data: string | Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function parseData(data: DocumentRow["data"]): Record<string, unknown> {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return data ?? {};
}

function computeGrandFromState(state: Record<string, unknown>): number {
  const items = (state.items as Array<{ qty?: number; rate?: number }>) ?? [];
  const igstPct = Number(state.igstPct) || 0;
  const cgstPct = Number(state.cgstPct) || 0;
  const sgstPct = Number(state.sgstPct) || 0;
  let taxable = 0;
  let totalTax = 0;
  for (const it of items) {
    const lineTaxable = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    taxable += lineTaxable;
    totalTax +=
      lineTaxable * (cgstPct / 100) +
      lineTaxable * (sgstPct / 100) +
      lineTaxable * (igstPct / 100);
  }
  return taxable + totalTax;
}

function toListItem(row: DocumentRow) {
  return {
    id: row.id,
    docNo: row.doc_no,
    partyName: row.party_name ?? "",
    docDate: row.doc_date,
    grandTotal: Number(row.grand_total),
    status: row.status,
  };
}

function toFullDocument(row: DocumentRow) {
  const data = parseData(row.data);
  return {
    id: row.id,
    toolId: row.tool_id,
    ...data,
    docNo: row.doc_no,
    docDate: row.doc_date,
    extraDate: row.extra_date,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get("/:toolId", async (req, res) => {
  const toolId = req.params.toolId;
  if (!isDocumentToolId(toolId)) {
    res.status(400).json({ error: "Invalid document tool" });
    return;
  }
  const [rows] = await pool.query(
    `SELECT id, tool_id, doc_no, doc_date, party_name, grand_total, status, data, extra_date, created_at, updated_at
     FROM document_records
     WHERE business_profile_id = :profileId AND tool_id = :toolId
     ORDER BY updated_at DESC`,
    { profileId: getActiveProfileId(), toolId },
  );
  const list = (Array.isArray(rows) ? rows : []).map((row) =>
    toListItem(row as DocumentRow),
  );
  res.json(list);
});

router.get("/:toolId/usage", async (req, res) => {
  const toolId = req.params.toolId;
  if (!isDocumentToolId(toolId)) {
    res.status(400).json({ error: "Invalid document tool" });
    return;
  }
  res.json(await getDocumentUsage(toolId));
});

router.get("/:toolId/:id", async (req, res) => {
  const toolId = req.params.toolId;
  const id = req.params.id;
  if (!isDocumentToolId(toolId)) {
    res.status(400).json({ error: "Invalid document tool" });
    return;
  }
  const [rows] = await pool.query(
    `SELECT * FROM document_records
     WHERE id = :id AND business_profile_id = :profileId AND tool_id = :toolId`,
    { id, profileId: getActiveProfileId(), toolId },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(toFullDocument(row as DocumentRow));
});

router.post("/:toolId", async (req, res) => {
  const toolId = req.params.toolId;
  if (!isDocumentToolId(toolId)) {
    res.status(400).json({ error: "Invalid document tool" });
    return;
  }

  const body = req.body ?? {};
  let validated: Record<string, unknown>;
  try {
    validated = validateDocumentState(body as Record<string, unknown>);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: "VALIDATION_ERROR", details: err.details });
      return;
    }
    throw err;
  }

  const id = String(validated.id ?? body.id ?? newDocumentId(toolId));
  const docNo = String(validated.docNo ?? body.docNo ?? "");
  const docDate = String(validated.docDate ?? body.docDate ?? new Date().toISOString().slice(0, 10));
  const extraDate = validated.extraDate ? String(validated.extraDate) : null;
  const party = validated.party as { name?: string } | undefined;
  const partyName = party?.name ? String(party.name) : null;
  const status = String(validated.status ?? body.status ?? "saved");
  const grandTotal = computeGrandFromState(validated);

  try {
    const document = await runCreateWithLimit(toolId, "document", async (conn) => {
      await conn.query(
        `INSERT INTO document_records
         (id, business_profile_id, tool_id, doc_no, doc_date, extra_date, party_name, grand_total, status, data)
         VALUES (:id, :profileId, :toolId, :docNo, :docDate, :extraDate, :partyName, :grandTotal, :status, :data)`,
        {
          id,
          profileId: getActiveProfileId(),
          toolId,
          docNo,
          docDate,
          extraDate,
          partyName,
          grandTotal,
          status,
          data: JSON.stringify({ ...body, ...validated }),
        },
      );

      const [rows] = await conn.query(`SELECT * FROM document_records WHERE id = :id`, { id });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) {
        throw new Error("Failed to load created document");
      }
      return toFullDocument(row as DocumentRow);
    });

    if (toolId === "invoice") {
      await syncInvoiceToPaymentTracker(id, docNo, partyName ?? "", docDate, grandTotal);
    }

    await logAudit("document.create", "document", id, { toolId, docNo }, req.ip);
    res.status(201).json(document);
  } catch (err) {
    if (err instanceof LimitReachedError) {
      res.status(403).json({ error: "FREE_LIMIT_REACHED", limit: err.limit });
      return;
    }
    throw err;
  }
});

router.put("/:toolId/:id", async (req, res) => {
  const toolId = req.params.toolId;
  const id = req.params.id;
  if (!isDocumentToolId(toolId)) {
    res.status(400).json({ error: "Invalid document tool" });
    return;
  }

  const body = req.body ?? {};
  let validated: Record<string, unknown>;
  try {
    validated = validateDocumentState(body as Record<string, unknown>);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: "VALIDATION_ERROR", details: err.details });
      return;
    }
    throw err;
  }

  const docNo = String(validated.docNo ?? body.docNo ?? "");
  const docDate = String(validated.docDate ?? body.docDate ?? new Date().toISOString().slice(0, 10));
  const extraDate = validated.extraDate ? String(validated.extraDate) : null;
  const party = validated.party as { name?: string } | undefined;
  const partyName = party?.name ? String(party.name) : null;
  const status = String(validated.status ?? body.status ?? "saved");
  const grandTotal = computeGrandFromState(validated);

  const [result] = await pool.query(
    `UPDATE document_records SET
      doc_no = :docNo, doc_date = :docDate, extra_date = :extraDate,
      party_name = :partyName, grand_total = :grandTotal, status = :status, data = :data
     WHERE id = :id AND business_profile_id = :profileId AND tool_id = :toolId`,
    {
      id,
      profileId: getActiveProfileId(),
      toolId,
      docNo,
      docDate,
      extraDate,
      partyName,
      grandTotal,
      status,
      data: JSON.stringify({ ...body, ...validated }),
    },
  );
  const affected = (result as { affectedRows?: number }).affectedRows ?? 0;
  if (!affected) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  await syncDocumentUsage(toolId);

  if (toolId === "invoice") {
    await syncInvoiceToPaymentTracker(id, docNo, partyName ?? "", docDate, grandTotal);
  }

  const [rows] = await pool.query(`SELECT * FROM document_records WHERE id = :id`, { id });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    res.status(500).json({ error: "Failed to load updated document" });
    return;
  }
  await logAudit("document.update", "document", id, { toolId, docNo }, req.ip);
  res.json(toFullDocument(row as DocumentRow));
});

router.delete("/:toolId/:id", async (req, res) => {
  const toolId = req.params.toolId;
  const id = req.params.id;
  if (!isDocumentToolId(toolId)) {
    res.status(400).json({ error: "Invalid document tool" });
    return;
  }

  const [result] = await pool.query(
    `DELETE FROM document_records
     WHERE id = :id AND business_profile_id = :profileId AND tool_id = :toolId`,
    { id, profileId: getActiveProfileId(), toolId },
  );
  const affected = (result as { affectedRows?: number }).affectedRows ?? 0;
  if (!affected) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (toolId === "invoice") {
    await pool.query(
      `DELETE FROM tool_records WHERE id = :id AND business_profile_id = :profileId`,
      { id: `recv_${id}`, profileId: getActiveProfileId() },
    );
    await syncToolUsage("paymenttracker");
  }

  await syncDocumentUsage(toolId);
  await logAudit("document.delete", "document", id, { toolId }, req.ip);
  res.status(204).send();
});

export default router;

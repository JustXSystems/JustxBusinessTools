import type { Pool } from "mysql2/promise";
import { num, type BosLineInput } from "../logic.js";
import { listDocuments, str, type DocumentRow } from "./document-records.js";
import type { BosConnector, ConnectorRecord } from "./types.js";

const TOOL_ID = "quotationv1";

function toRecord(row: DocumentRow & { payload: Record<string, unknown> }): ConnectorRecord {
  const q = row.payload;
  const c = (q.customer ?? {}) as Record<string, unknown>;
  const items = Array.isArray(q.items) ? (q.items as Array<Record<string, unknown>>) : [];
  const lines: BosLineInput[] = items
    .filter((it) => str(it.desc) || num(it.rate) !== 0)
    .map((it) => ({
      description: str(it.desc) || "Item",
      hsn: str(it.hsn) || null,
      unit: str(it.unit) || null,
      quantity: num(it.qty, 1),
      rate: num(it.rate),
      discountPct: num(it.discount),
      taxRate: num(it.gst),
    }));
  const extra = (q.extraCharge ?? {}) as Record<string, unknown>;
  if (num(extra.amount) > 0) {
    lines.push({ description: str(extra.label) || "Additional charges", quantity: 1, rate: num(extra.amount), taxRate: num(extra.gst) });
  }
  const category = str(q.categoryCustomLabel) || str(q.category);
  return {
    ref: row.id,
    docNo: row.doc_no,
    date: row.doc_date,
    status: row.status,
    amount: num(row.grand_total),
    title: [category, str(q.engagement)].filter(Boolean).join(" · ") || "Quotation",
    party: {
      name: str(c.name) || row.party_name || "Customer",
      company: str(c.company) || null,
      gstin: str(c.gstin) || null,
      email: str(c.email) || null,
      phone: str(c.phone) || null,
      address: str(c.address) || null,
      city: str(c.city) || null,
      state: str(c.state) || null,
    },
    lines,
    placeOfSupply: str(c.state) || null,
    notes: `From quotation ${row.doc_no}`,
    updatedAt: row.updated_at,
  };
}

/** Quotation V1 → BOS: customers on submit/send, a draft invoice once the customer approves. */
export function quotationV1Connector(db: Pool): BosConnector {
  return {
    id: TOOL_ID,
    label: "Quotation V1",
    icon: "📑",
    description: "Approved quotations become draft GST invoices; every quoted customer joins your BOS customer book.",
    href: "/tools/quotationv1",
    targets: ["party", "invoice"],
    autoTargets: (r) => (r.status === "approved" ? ["party", "invoice"] : r.status === "sent" || r.status === "submitted" ? ["party"] : []),
    async list(tenantId) {
      return (await listDocuments(db, tenantId, TOOL_ID)).filter((r) => r.status !== "draft").map(toRecord);
    },
    async get(tenantId, ref) {
      const [row] = await listDocuments(db, tenantId, TOOL_ID, ref);
      return row ? toRecord(row) : null;
    },
  };
}

import type { Pool } from "mysql2/promise";
import { json, money, rows } from "../db.js";
import { num, type BosLineInput } from "../logic.js";
import { str } from "./document-records.js";
import type { BosConnector, ConnectorRecord } from "./types.js";

const TOOL_ID = "imsdealer";

type InvoiceRow = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  customer_name: string;
  customer_gstin: string | null;
  customer_address: string | null;
  customer_mobile: string | null;
  place_of_supply: string | null;
  lines: unknown;
  grand_total: string | number;
  amount_paid: string | number;
  notes: string | null;
  updated_at: string | null;
  p_contact: string | null;
  p_email: string | null;
  p_city: string | null;
  p_state: string | null;
};

function toRecord(r: InvoiceRow): ConnectorRecord {
  const items = json<Array<Record<string, unknown>>>(r.lines, []);
  const lines: BosLineInput[] = items
    .filter((l) => str(l.name) && num(l.qty) > 0)
    .map((l) => ({
      description: str(l.name),
      hsn: str(l.hsn) || null,
      unit: str(l.unit) || null,
      quantity: num(l.qty, 1),
      rate: num(l.rate),
      discountPct: num(l.discountPct),
      taxRate: num(l.gstRate),
    }));
  const total = money(r.grand_total);
  const paid = money(r.amount_paid);
  const units = lines.reduce((s, l) => s + num(l.quantity), 0);
  return {
    ref: r.id,
    docNo: r.invoice_no,
    date: String(r.invoice_date).slice(0, 10),
    status: paid >= total - 0.005 ? "paid" : paid > 0 ? "partially_paid" : "issued",
    amount: total,
    title: `${lines.length} line${lines.length === 1 ? "" : "s"} · ${Math.round(units * 1000) / 1000} units`,
    party: {
      name: r.p_contact || r.customer_name || "Customer",
      company: r.p_contact ? r.customer_name : null,
      gstin: r.customer_gstin,
      email: r.p_email,
      phone: r.customer_mobile,
      address: r.customer_address,
      city: r.p_city,
      state: r.p_state ?? r.place_of_supply,
    },
    lines,
    placeOfSupply: r.place_of_supply ?? r.p_state,
    notes: `From Justx IMS invoice ${r.invoice_no}`,
    updatedAt: r.updated_at,
  };
}

async function listInvoices(db: Pool, tenantId: number, ref?: string): Promise<ConnectorRecord[]> {
  try {
    const list = await rows<InvoiceRow>(
      db,
      `SELECT i.id, i.invoice_no, i.invoice_date, i.customer_name, i.customer_gstin, i.customer_address, i.customer_mobile, i.place_of_supply,
              i.lines, i.grand_total, i.amount_paid, i.notes, i.updated_at,
              p.contact_person AS p_contact, p.email AS p_email, p.city AS p_city, p.state AS p_state
       FROM ims_invoices i LEFT JOIN ims_parties p ON p.tenant_id = i.tenant_id AND p.id = i.customer_id
       WHERE i.tenant_id = :tenantId AND i.status = 'issued' AND (i.source_tool IS NULL OR i.source_tool <> 'bos') ${ref ? "AND i.id = :ref" : ""}
       ORDER BY i.invoice_date DESC, i.updated_at DESC
       LIMIT 500`,
      { tenantId, ref: ref ?? null },
    );
    return list.map(toRecord);
  } catch (err) {
    if ((err as { code?: string }).code === "ER_NO_SUCH_TABLE") return [];
    throw err;
  }
}

/** Justx IMS — Dealer → BOS: issued sales invoices (customers sync automatically; invoices on demand so books aren't doubled). */
export function imsDealerConnector(db: Pool): BosConnector {
  return {
    id: TOOL_ID,
    label: "Justx IMS — Dealer",
    icon: "📦",
    description: "Issued IMS sales invoices with their GST lines; every billed customer joins your BOS customer book.",
    href: "/tools/imsdealer",
    targets: ["party", "invoice"],
    autoTargets: () => ["party"],
    list: (tenantId) => listInvoices(db, tenantId),
    async get(tenantId, ref) {
      const [row] = await listInvoices(db, tenantId, ref);
      return row ?? null;
    },
  };
}

import { isoOf, json, money, rows, type Queryable } from "./db.js";
import { bookStatements, buildBookVouchers, isIntraState, round2, round3, splitInclusiveNote, type BookSources, type BookStatements, type BookVoucher, type ImsLineInput } from "./logic.js";
import type { ImsSettings } from "./settings.js";

type Range = { from: string; to: string };

export type ReturnNote = {
  id: string;
  no: string;
  kind: "Credit Note" | "Debit Note";
  date: string;
  party: string;
  partyGstin: string | null;
  partyState: string | null;
  intraState: boolean;
  against: string | null;
  narration: string | null;
  lines: Array<{ itemId: string | null; name: string; unit: string; qty: number; amount: number; stock: boolean }>;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
};

/**
 * Completed returns settled as a credit note — the same set, at the same amount, that the party
 * ledger uses. The amount is GST-inclusive; tax is backed out at each item's rate.
 */
export async function loadReturnNotes(db: Queryable, tenantId: number, settings: ImsSettings, range: { from?: string; to: string; since?: string | null }): Promise<ReturnNote[]> {
  const list = await rows<{
    id: string;
    return_no: string;
    kind: string;
    party_name: string;
    ref_doc_no: string | null;
    return_date: string;
    lines: unknown;
    total: string;
    refund_amount: string;
    reason: string | null;
    notes: string | null;
    gstin: string | null;
    state: string | null;
  }>(
    db,
    `SELECT r.id, r.return_no, r.kind, r.party_name, r.ref_doc_no, r.return_date, r.lines, r.total, r.refund_amount, r.reason, r.notes, p.gstin, p.state
     FROM ims_returns r LEFT JOIN ims_parties p ON p.tenant_id = r.tenant_id AND p.id = r.party_id
     WHERE r.tenant_id = :tenantId AND r.status = 'completed' AND r.refund_status = 'credit_note' AND r.return_date <= :to
       ${range.from ? "AND r.return_date >= :from" : ""} ${range.since ? "AND r.updated_at >= :since" : ""}
     ORDER BY r.return_date, r.return_no LIMIT 5000`,
    { tenantId, from: range.from ?? null, to: range.to, since: range.since ?? null },
  );
  if (!list.length) return [];
  const items = await rows<{ id: string; name: string; unit: string; hsn: string | null; gst_rate: string }>(db, `SELECT id, name, unit, hsn, gst_rate FROM ims_items WHERE tenant_id = :tenantId LIMIT 20000`, { tenantId });
  const byId = new Map(items.map((i) => [i.id, i]));
  return list.map((r) => {
    const intra = isIntraState(settings.state, r.state);
    const input = json<Array<{ itemId?: string | null; name?: string; unit?: string; qty?: number; rate?: number }>>(r.lines, [])
      .filter((l) => l && typeof l === "object")
      .map<ImsLineInput>((l) => {
        const item = l.itemId ? byId.get(l.itemId) : undefined;
        return {
          itemId: l.itemId ?? null,
          name: item?.name ?? l.name ?? "Item",
          unit: item?.unit ?? l.unit ?? "pcs",
          hsn: item?.hsn ?? null,
          qty: Number(l.qty) || 0,
          rate: Number(l.rate) || 0,
          gstRate: item ? money(item.gst_rate) : settings.defaultGstRate,
        };
      });
    const amount = money(r.refund_amount) > 0 ? money(r.refund_amount) : money(r.total);
    const split = splitInclusiveNote(input, amount, intra);
    const narration = [r.ref_doc_no ? `Against ${r.ref_doc_no}` : "", r.reason ?? "", r.notes ?? ""].filter(Boolean).join(" · ");
    return {
      id: r.id,
      no: r.return_no,
      kind: r.kind === "supplier" ? "Debit Note" : "Credit Note",
      date: isoOf(r.return_date),
      party: r.party_name,
      partyGstin: r.gstin,
      partyState: r.state,
      intraState: intra,
      against: r.ref_doc_no,
      narration: narration || null,
      lines: split.lines.map((l) => ({ ...l, stock: Boolean(l.itemId && byId.has(l.itemId)) })),
      taxable: split.taxable,
      cgst: split.cgst,
      sgst: split.sgst,
      igst: split.igst,
      total: split.total,
    };
  });
}

/** Stock value (current purchase price) as at the end of `from - 1` and of `to`, rebuilt from the movement ledger. */
export async function stockValues(db: Queryable, tenantId: number, range: Range): Promise<{ opening: number; closing: number }> {
  const list = await rows<{ purchase_price: string; current_stock: string; after_to: string | null; in_range: string | null }>(
    db,
    `SELECT i.purchase_price, i.current_stock,
            SUM(CASE WHEN m.movement_date > :to THEN m.delta END) AS after_to,
            SUM(CASE WHEN m.movement_date BETWEEN :from AND :to THEN m.delta END) AS in_range
     FROM ims_items i LEFT JOIN ims_movements m ON m.tenant_id = i.tenant_id AND m.item_id = i.id
     WHERE i.tenant_id = :tenantId
     GROUP BY i.id, i.purchase_price, i.current_stock LIMIT 20000`,
    { tenantId, ...range },
  );
  let opening = 0;
  let closing = 0;
  for (const r of list) {
    const cost = money(r.purchase_price);
    const close = round3(money(r.current_stock) - money(r.after_to));
    const open = round3(close - money(r.in_range));
    closing += Math.max(0, close) * cost;
    opening += Math.max(0, open) * cost;
  }
  return { opening: round2(opening), closing: round2(closing) };
}

/** Everything recorded up to `to`, in the shape the pure book builder expects. */
export async function loadBookSources(db: Queryable, tenantId: number, settings: ImsSettings, to: string): Promise<BookSources> {
  const p = { tenantId, to };
  const [parties, invoices, bills, payments, notes, expenses, entries] = await Promise.all([
    rows<{ id: string; name: string; opening_balance: string }>(db, `SELECT id, name, opening_balance FROM ims_parties WHERE tenant_id = :tenantId AND opening_balance <> 0`, p),
    rows<{ id: string; invoice_no: string; invoice_date: string; customer_name: string; subtotal: string; discount_total: string; cgst: string; sgst: string; igst: string; grand_total: string }>(
      db,
      `SELECT id, invoice_no, invoice_date, customer_name, subtotal, discount_total, cgst, sgst, igst, grand_total
       FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND invoice_date <= :to`,
      p,
    ),
    rows<{ id: string; bill_no: string; supplier_bill_no: string | null; bill_date: string; supplier_name: string; state: string | null; subtotal: string; tax_total: string; grand_total: string }>(
      db,
      `SELECT b.id, b.bill_no, b.supplier_bill_no, b.bill_date, b.supplier_name, p.state, b.subtotal, b.tax_total, b.grand_total
       FROM ims_bills b LEFT JOIN ims_parties p ON p.tenant_id = b.tenant_id AND p.id = b.supplier_id
       WHERE b.tenant_id = :tenantId AND b.status <> 'cancelled' AND b.bill_date <= :to`,
      p,
    ),
    rows<{ id: string; direction: string; paid_on: string; party_name: string; amount: string; method: string; doc_no: string | null; reference: string | null }>(
      db,
      `SELECT id, direction, paid_on, party_name, amount, method, doc_no, reference FROM ims_payments WHERE tenant_id = :tenantId AND paid_on <= :to`,
      p,
    ),
    loadReturnNotes(db, tenantId, settings, { to }),
    rows<{ id: string; expense_date: string; category: string; description: string | null; vendor: string | null; amount: string; gst_amount: string; pay_method: string }>(
      db,
      `SELECT id, expense_date, category, description, vendor, amount, gst_amount, pay_method FROM ims_expenses WHERE tenant_id = :tenantId AND expense_date <= :to`,
      p,
    ),
    rows<{ id: string; entry_date: string; party_name: string; entry_type: string; category: string; amount: string; ref_no: string | null; settled_on: string | null; settle_method: string | null }>(
      db,
      `SELECT id, entry_date, party_name, entry_type, category, amount, ref_no, settled_on, settle_method FROM ims_ledger_entries WHERE tenant_id = :tenantId AND entry_date <= :to`,
      p,
    ),
  ]);
  return {
    homeState: settings.state ?? null,
    parties: parties.map((r) => ({ id: r.id, name: r.name, opening: money(r.opening_balance) })),
    invoices: invoices.map((r) => ({
      id: r.id,
      no: r.invoice_no,
      date: isoOf(r.invoice_date),
      party: r.customer_name,
      taxable: round2(money(r.subtotal) - money(r.discount_total)),
      cgst: money(r.cgst),
      sgst: money(r.sgst),
      igst: money(r.igst),
      total: money(r.grand_total),
    })),
    bills: bills.map((r) => ({ id: r.id, no: r.bill_no, supplierBillNo: r.supplier_bill_no, date: isoOf(r.bill_date), party: r.supplier_name, partyState: r.state, taxable: money(r.subtotal), tax: money(r.tax_total), total: money(r.grand_total) })),
    payments: payments.map((r) => ({ id: r.id, direction: r.direction, date: isoOf(r.paid_on), party: r.party_name, amount: money(r.amount), method: r.method, docNo: r.doc_no, reference: r.reference })),
    notes: notes.map((n) => ({ id: n.id, no: n.no, kind: n.kind, date: n.date, party: n.party, against: n.against, taxable: n.taxable, cgst: n.cgst, sgst: n.sgst, igst: n.igst, total: n.total })),
    expenses: expenses.map((r) => ({ id: r.id, date: isoOf(r.expense_date), category: r.category, description: r.description, vendor: r.vendor, amount: money(r.amount), gst: money(r.gst_amount), method: r.pay_method })),
    entries: entries.map((r) => ({
      id: r.id,
      date: isoOf(r.entry_date),
      party: r.party_name,
      type: r.entry_type,
      category: r.category,
      amount: money(r.amount),
      refNo: r.ref_no,
      settledOn: r.settled_on && isoOf(r.settled_on) <= to ? isoOf(r.settled_on) : null,
      settleMethod: r.settle_method,
    })),
  };
}

export type BooksReport = BookStatements & { dayBook: { rows: BookVoucher[]; truncated: boolean; totals: Record<string, { count: number; amount: number }> } };

const DAY_BOOK_LIMIT = 3000;

export async function loadBooks(db: Queryable, tenantId: number, settings: ImsSettings, range: Range): Promise<BooksReport> {
  const [sources, stock] = await Promise.all([loadBookSources(db, tenantId, settings, range.to), stockValues(db, tenantId, range)]);
  const vouchers = buildBookVouchers(sources);
  const statements = bookStatements(vouchers, { ...range, openingStock: stock.opening, closingStock: stock.closing });
  const inRange = vouchers.filter((v) => v.date >= range.from && v.date <= range.to);
  const totals: Record<string, { count: number; amount: number }> = {};
  for (const v of inRange) {
    const t = (totals[v.type] ??= { count: 0, amount: 0 });
    t.count += 1;
    t.amount = round2(t.amount + v.amount);
  }
  return { ...statements, dayBook: { rows: inRange.slice(-DAY_BOOK_LIMIT), truncated: inRange.length > DAY_BOOK_LIMIT, totals } };
}

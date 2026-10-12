import { z } from "zod";
import { isoOf, money, rows, type Queryable } from "./db.js";
import { addDaysISO, AUDIT_RULES, daysBetween, round2 } from "./logic.js";

/* ---------- GSTR-2B ↔ purchase bills: what input credit the portal confirms vs what the books claim ---------- */

export const Gstr2bRowSchema = z.object({
  gstin: z.string().trim().toUpperCase().max(20),
  supplier: z.string().trim().max(200).optional().default(""),
  invoiceNo: z.string().trim().max(64),
  date: z
    .string()
    .trim()
    .max(10)
    .nullable()
    .optional()
    .transform((d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null)),
  value: z.coerce.number().min(-1e12).max(1e12).default(0),
  taxable: z.coerce.number().min(-1e12).max(1e12).default(0),
  igst: z.coerce.number().min(-1e12).max(1e12).default(0),
  cgst: z.coerce.number().min(-1e12).max(1e12).default(0),
  sgst: z.coerce.number().min(-1e12).max(1e12).default(0),
  /** GSTR-2B "ITC availability"; false when the portal says the credit can't be taken. */
  itcAvailable: z.boolean().nullable().optional(),
});
export type Gstr2bRow = z.infer<typeof Gstr2bRowSchema>;

export type BookBill = { id: string; no: string; supplierBillNo: string | null; gstin: string | null; supplier: string; date: string; taxable: number; tax: number; total: number; inRange: boolean };

export type RecoStatus = "matched" | "mismatch" | "missing_2b" | "missing_books";
export type RecoRow = {
  status: RecoStatus;
  gstin: string;
  supplier: string;
  invoiceNo: string;
  date: string | null;
  bill: { id: string; no: string; taxable: number; tax: number; total: number } | null;
  portal: { taxable: number; tax: number; total: number } | null;
  taxDiff: number;
  note: string;
};
export type RecoSummary = {
  counts: Record<RecoStatus, number>;
  itcBooks: number;
  itcPortal: number;
  itcMatched: number;
  itcAtRisk: number;
  itcNotBooked: number;
};

/** "INV/0012" and "inv-12" compare equal. */
export const normInvoiceNo = (s: string | null | undefined) =>
  String(s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/(^|[A-Z])0+(?=\d)/g, "$1");

export function reconcileGstr2b(bills: ReadonlyArray<BookBill>, portal: ReadonlyArray<Gstr2bRow>, tolerance: number = AUDIT_RULES.gstTolerance): { rows: RecoRow[]; summary: RecoSummary } {
  const pool = bills.filter((b) => b.gstin);
  const used = new Set<string>();
  const byKey = new Map<string, BookBill[]>();
  for (const b of pool) {
    for (const no of [b.supplierBillNo, b.no]) {
      const k = `${b.gstin}|${normInvoiceNo(no)}`;
      if (!no || !normInvoiceNo(no)) continue;
      byKey.set(k, [...(byKey.get(k) ?? []), b]);
    }
  }
  const out: RecoRow[] = [];
  for (const p of portal) {
    const pTax = round2(p.igst + p.cgst + p.sgst);
    const pTotal = p.value || round2(p.taxable + pTax);
    let bill = (byKey.get(`${p.gstin}|${normInvoiceNo(p.invoiceNo)}`) ?? []).find((b) => !used.has(b.id)) ?? null;
    let byAmount = false;
    if (!bill) {
      bill = pool.find((b) => !used.has(b.id) && b.gstin === p.gstin && Math.abs(b.total - pTotal) <= tolerance && (!p.date || Math.abs(daysBetween(b.date, p.date)) <= 5)) ?? null;
      byAmount = Boolean(bill);
    }
    const blocked = p.itcAvailable === false;
    const claimable = blocked ? 0 : pTax;
    const base = { gstin: p.gstin, supplier: p.supplier || bill?.supplier || "", invoiceNo: p.invoiceNo, date: p.date ?? null, portal: { taxable: round2(p.taxable), tax: claimable, total: round2(pTotal) } };
    if (!bill) {
      out.push({ ...base, status: "missing_books", bill: null, taxDiff: claimable, note: `In GSTR-2B but no bill recorded — record the purchase or confirm it isn't yours${blocked ? ". The portal marks its credit as not available" : ""}` });
      continue;
    }
    used.add(bill.id);
    const taxDiff = round2(bill.tax - claimable);
    const valueDiff = round2(bill.total - pTotal);
    const ok = !blocked && Math.abs(taxDiff) <= tolerance && Math.abs(valueDiff) <= Math.max(tolerance, 1);
    const notes: string[] = [];
    if (blocked) notes.push(`GSTR-2B marks this ₹${pTax.toLocaleString("en-IN")} credit as not available — don't claim it`);
    else if (Math.abs(taxDiff) > tolerance) notes.push(`GST differs by ₹${Math.abs(taxDiff).toLocaleString("en-IN")} (${taxDiff > 0 ? "books higher" : "portal higher"})`);
    if (Math.abs(valueDiff) > Math.max(tolerance, 1)) notes.push(`invoice value differs by ₹${Math.abs(valueDiff).toLocaleString("en-IN")}`);
    if (byAmount) notes.push(`matched by amount — bill records invoice no. "${bill.supplierBillNo ?? bill.no}"`);
    out.push({
      ...base,
      status: ok ? "matched" : "mismatch",
      bill: { id: bill.id, no: bill.no, taxable: bill.taxable, tax: bill.tax, total: bill.total },
      taxDiff,
      note: notes.length ? `${notes.join("; ")}.`.replace(/^\w/, (c) => c.toUpperCase()) : "Agrees with GSTR-2B",
    });
  }
  for (const b of bills) {
    if (used.has(b.id) || !b.inRange || b.tax <= 0) continue;
    out.push({
      status: "missing_2b",
      gstin: b.gstin ?? "",
      supplier: b.supplier,
      invoiceNo: b.supplierBillNo ?? b.no,
      date: b.date,
      bill: { id: b.id, no: b.no, taxable: b.taxable, tax: b.tax, total: b.total },
      portal: null,
      taxDiff: b.tax,
      note: b.gstin ? "Not in GSTR-2B — the supplier may not have filed yet; hold the credit until it appears" : "Supplier GSTIN missing — credit can't be matched or claimed",
    });
  }
  const order: Record<RecoStatus, number> = { mismatch: 0, missing_2b: 1, missing_books: 2, matched: 3 };
  out.sort((a, b) => order[a.status] - order[b.status] || Math.abs(b.taxDiff) - Math.abs(a.taxDiff));
  const of = (s: RecoStatus) => out.filter((r) => r.status === s);
  const sum = (l: RecoRow[], f: (r: RecoRow) => number) => round2(l.reduce((s, r) => s + f(r), 0));
  return {
    rows: out,
    summary: {
      counts: { matched: of("matched").length, mismatch: of("mismatch").length, missing_2b: of("missing_2b").length, missing_books: of("missing_books").length },
      itcBooks: sum(
        out.filter((r) => r.bill && r.status !== "missing_books"),
        (r) => r.bill?.tax ?? 0,
      ),
      itcPortal: sum(
        out.filter((r) => r.portal),
        (r) => r.portal?.tax ?? 0,
      ),
      itcMatched: sum(of("matched"), (r) => r.bill?.tax ?? 0),
      itcAtRisk: round2(sum(of("missing_2b"), (r) => r.taxDiff) + sum(of("mismatch"), (r) => Math.max(0, r.taxDiff))),
      itcNotBooked: sum(of("missing_books"), (r) => r.taxDiff),
    },
  };
}

/** Bills in the period plus up to 180 days earlier (2B often carries late-filed invoices). Read-only. */
export async function loadBookBills(db: Queryable, tenantId: number, range: { from: string; to: string }): Promise<BookBill[]> {
  const list = await rows<{ id: string; bill_no: string; supplier_bill_no: string | null; gstin: string | null; supplier_name: string; bill_date: string; subtotal: string; tax_total: string; grand_total: string }>(
    db,
    `SELECT b.id, b.bill_no, b.supplier_bill_no, p.gstin, b.supplier_name, b.bill_date, b.subtotal, b.tax_total, b.grand_total
     FROM ims_bills b LEFT JOIN ims_parties p ON p.tenant_id = b.tenant_id AND p.id = b.supplier_id
     WHERE b.tenant_id = :tenantId AND b.status <> 'cancelled' AND b.bill_date BETWEEN :early AND :to
     ORDER BY b.bill_date LIMIT 20000`,
    { tenantId, early: addDaysISO(range.from, -180), to: range.to },
  );
  return list.map((b) => {
    const date = isoOf(b.bill_date);
    return {
      id: b.id,
      no: b.bill_no,
      supplierBillNo: b.supplier_bill_no,
      gstin: b.gstin ? b.gstin.trim().toUpperCase() : null,
      supplier: b.supplier_name,
      date,
      taxable: money(b.subtotal),
      tax: money(b.tax_total),
      total: money(b.grand_total),
      inRange: date >= range.from && date <= range.to,
    };
  });
}

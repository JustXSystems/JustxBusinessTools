import { Router } from "express";
import { pool } from "../db.js";
import { one } from "../ims/db.js";
import { round2, todayISO } from "../ims/logic.js";
import { mapInvoice, type InvoiceRow } from "../ims/sales.js";
import { loadInstallmentPlan } from "../ims/wave6-db.js";
import { isPortalToken, upiIntent } from "../ims/wave6-logic.js";
import { withBrowserFileAccessToken } from "../lib/storage.js";

/**
 * Customer portal: a magic link (random token) that shows ONE issued invoice — lines, balance, payment plan and the
 * seller's bank / UPI details with a UPI pay intent for a QR. View-only: no card charge or payment capture happens here.
 * Mounted at /api/public/invoice-portal behind the public rate limiter; it never exposes internal ids, phone numbers or e-mails.
 */
const router = Router();

type SellerRow = {
  business_name: string | null;
  gstin: string | null;
  state: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bank_upi: string | null;
  bank_account_name: string | null;
  bank_account_no: string | null;
  bank_ifsc: string | null;
  bank_name: string | null;
  msme_registered: number | boolean | null;
  msme_udyam: string | null;
};

async function sellerForTenant(tenantId: number) {
  const s = await one<SellerRow>(
    pool,
    `SELECT business_name, gstin, state, address, phone, email, bank_upi, bank_account_name, bank_account_no, bank_ifsc, bank_name, msme_registered, msme_udyam
     FROM ims_settings WHERE tenant_id = :tenantId LIMIT 1`,
    { tenantId },
  ).catch(() => null);
  let logoUrl: string | null = null;
  let profileName: string | null = null;
  try {
    const p = await one<{ business_name: string | null; logo_data_url: string | null }>(pool, `SELECT business_name, logo_data_url FROM business_profiles WHERE id = :id LIMIT 1`, { id: tenantId });
    profileName = p?.business_name?.trim() || null;
    logoUrl = p?.logo_data_url ? withBrowserFileAccessToken(p.logo_data_url) : null;
  } catch {
    /* branding is optional */
  }
  return {
    name: s?.business_name?.trim() || profileName || "Your supplier",
    gstin: s?.gstin ?? null,
    state: s?.state ?? null,
    address: s?.address ?? null,
    phone: s?.phone ?? null,
    email: s?.email ?? null,
    logoUrl,
    bankName: s?.bank_name ?? null,
    bankAccountName: s?.bank_account_name ?? null,
    bankAccountNo: s?.bank_account_no ?? null,
    bankIfsc: s?.bank_ifsc ?? null,
    bankUpi: s?.bank_upi ?? null,
    msmeRegistered: Boolean(s?.msme_registered),
    msmeUdyam: s?.msme_udyam ?? null,
  };
}

router.get("/:token", async (req, res) => {
  const token = String(req.params.token ?? "").trim();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (!isPortalToken(token)) {
    res.status(404).json({ error: "This link is not valid" });
    return;
  }
  const row = await one<InvoiceRow & { tenant_id: number }>(
    pool,
    `SELECT * FROM ims_invoices WHERE portal_token = :token AND status = 'issued' AND COALESCE(doc_kind, 'tax_invoice') <> 'proforma' LIMIT 1`,
    { token },
  );
  if (!row) {
    res.status(404).json({ error: "This link is no longer active" });
    return;
  }
  const today = todayISO();
  const inv = mapInvoice(row, today, true);
  const [seller, plan] = await Promise.all([
    sellerForTenant(Number(row.tenant_id)),
    loadInstallmentPlan(pool, Number(row.tenant_id), row.id, today).catch(() => null),
  ]);
  const payable = inv.docKind === "tax_invoice" && inv.balance > 0.005 && inv.currencyCode === "INR";
  const intent = payable
    ? upiIntent({ vpa: seller.bankUpi, payeeName: seller.name, amount: inv.balance, note: inv.invoiceNo })
    : null;
  const { bankUpi, ...sellerPublic } = seller;
  res.json({
    portal: {
      asOf: today,
      invoice: {
        invoiceNo: inv.invoiceNo,
        docKind: inv.docKind,
        displayStatus: inv.displayStatus,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        customerName: inv.customerName,
        customerGstin: inv.customerGstin,
        customerAddress: inv.customerAddress,
        placeOfSupply: inv.placeOfSupply,
        intraState: inv.intraState,
        customerPoNo: inv.customerPoNo,
        currencyCode: inv.currencyCode,
        fxRate: inv.fxRate,
        fxBaseTotal: inv.fxBaseTotal,
        subtotal: inv.subtotal,
        discountTotal: inv.discountTotal,
        taxable: inv.taxable,
        taxTotal: inv.taxTotal,
        cgst: inv.cgst,
        sgst: inv.sgst,
        igst: inv.igst,
        shippingCharges: inv.shippingCharges,
        shippingTax: inv.shippingTax,
        roundOff: inv.roundOff,
        grandTotal: inv.grandTotal,
        amountPaid: inv.amountPaid,
        creditApplied: inv.creditApplied,
        advanceApplied: inv.advanceApplied,
        retentionAmount: inv.retentionAmount,
        balance: inv.balance,
        daysOverdue: inv.daysOverdue,
        notes: inv.notes,
        terms: inv.terms,
        lines: (inv.lines ?? []).map((l) => ({
          name: l.name,
          hsn: l.hsn ?? null,
          unit: l.unit ?? null,
          qty: l.qty,
          rate: l.rate,
          discountPct: l.discountPct ?? 0,
          gstRate: l.gstRate,
          taxable: round2(Number(l.taxable) || 0),
          tax: round2(Number(l.tax) || 0),
          amount: round2(Number(l.amount) || 0),
        })),
      },
      installments:
        plan && plan.status !== "cancelled"
          ? plan.installments.map((i) => ({ seqNo: i.seqNo, dueOn: i.dueOn, amount: i.amount, amountPaid: i.amountPaid, balance: i.balance, status: i.status, overdue: i.overdue, label: i.label }))
          : null,
      seller: sellerPublic,
      upi: intent && bankUpi ? { vpa: bankUpi, intent } : null,
    },
  });
});

export default router;

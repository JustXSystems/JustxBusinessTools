/**
 * Quality audit for JustTestX IMS seed.
 *   npm run db:audit:justtestx:ims -w server
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../../src/db.js";
import { computeTotals, todayISO } from "../../src/ims/logic.js";

const TODAY = todayISO(new Date(), "Asia/Kolkata");
const ok: string[] = [];
const warn: string[] = [];
const fail: string[] = [];
const pass = (m: string) => ok.push(m);
const soft = (m: string) => warn.push(m);
const bad = (m: string) => fail.push(m);

async function one<T extends RowDataPacket = RowDataPacket>(sql: string, p: Record<string, unknown> = {}) {
  const [rows] = await pool.query<T[]>(sql, p);
  return rows[0] ?? null;
}
async function many<T extends RowDataPacket = RowDataPacket>(sql: string, p: Record<string, unknown> = {}) {
  const [rows] = await pool.query<T[]>(sql, p);
  return rows;
}
async function count(sql: string, p: Record<string, unknown> = {}) {
  const r = await one<RowDataPacket & { n?: number }>(sql, p);
  return Number(r?.n ?? 0);
}

async function main() {
  const profile = await one<{ id: number; organization_id: number }>(
    `SELECT id, organization_id FROM business_profiles WHERE business_name = 'JustTestX' ORDER BY id DESC LIMIT 1`,
  );
  if (!profile) {
    console.error("JustTestX profile missing");
    process.exit(1);
  }
  const t = Number(profile.id);
  const orgId = Number(profile.organization_id);
  pass(`Profile id=${t}`);

  const imsOn = await one<{ available: number }>(`SELECT available FROM tool_catalog WHERE organization_id = :o AND tool_id = 'imsdealer'`, { o: orgId });
  if (!imsOn || Number(imsOn.available) !== 1) bad("IMS not enabled in tool_catalog");
  else pass("IMS enabled");

  const settings = await one(`SELECT business_name, business_type FROM ims_settings WHERE tenant_id = :t`, { t });
  if (!settings) bad("ims_settings missing");
  else pass(`settings: ${settings.business_name} (${settings.business_type})`);

  const coverage: Record<string, number> = {};
  for (const [k, table] of [
    ["parties", "ims_parties"],
    ["items", "ims_items"],
    ["movements", "ims_movements"],
    ["pos", "ims_purchase_orders"],
    ["bills", "ims_bills"],
    ["invoices", "ims_invoices"],
    ["payments", "ims_payments"],
    ["returns", "ims_returns"],
    ["checks", "ims_stock_checks"],
    ["expenses", "ims_expenses"],
    ["closings", "ims_daily_closings"],
    ["ar", "ims_ar_activity"],
    ["ledger", "ims_ledger_entries"],
    ["pay_runs", "ims_payment_runs"],
    ["field_tasks", "ims_field_tasks"],
    ["field_visits", "ims_field_visits"],
    ["bank", "ims_bank_txns"],
    ["audit", "ims_audit_items"],
    ["tickets", "ims_tickets"],
    ["reports", "ims_reports"],
  ] as const) {
    coverage[k] = await count(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = :t`, { t });
    if (coverage[k]! <= 0) bad(`Empty: ${k}`);
    else pass(`${k}=${coverage[k]}`);
  }
  console.log("\n=== COVERAGE ===");
  console.log(coverage);

  console.log("\n=== STATUS MIX ===");
  for (const [table, col] of [
    ["ims_invoices", "status"],
    ["ims_purchase_orders", "status"],
    ["ims_bills", "status"],
    ["ims_returns", "status"],
    ["ims_stock_checks", "status"],
    ["ims_payment_runs", "status"],
    ["ims_field_tasks", "status"],
    ["ims_bank_txns", "status"],
    ["ims_audit_items", "status"],
    ["ims_tickets", "status"],
  ] as const) {
    const d = await many<{ k: string; n: number }>(`SELECT ${col} AS k, COUNT(*) AS n FROM ${table} WHERE tenant_id = :t GROUP BY ${col}`, { t });
    console.log(`${table}.${col}:`, d.map((x) => `${x.k}=${x.n}`).join(", ") || "(none)");
  }

  // Invoice totals
  const invs = await many<RowDataPacket>(`SELECT * FROM ims_invoices WHERE tenant_id = :t AND status = 'issued'`, { t });
  let invBad = 0;
  for (const inv of invs) {
    const linesRaw = typeof inv.lines === "string" ? JSON.parse(inv.lines as string) : inv.lines;
    const lines = (linesRaw as Array<Record<string, unknown>>).map((l) => ({
      name: String(l.name ?? ""),
      qty: Number(l.qty),
      rate: Number(l.rate),
      discountPct: Number(l.discountPct ?? 0),
      gstRate: Number(l.gstRate ?? l.gst_rate ?? 18),
    }));
    const roundToRupee = Math.abs(Number(inv.round_off ?? 0)) > 0.001;
    const totals = computeTotals(lines, Number(inv.intra_state) === 1, roundToRupee);
    if (Math.abs(Number(inv.grand_total) - totals.grandTotal) > 1) {
      invBad++;
      if (invBad <= 3) bad(`Invoice total mismatch ${inv.invoice_no}`);
    }
    if (Number(inv.intra_state) === 1 && Number(inv.igst) > 0.01) bad(`Intra has IGST ${inv.invoice_no}`);
    if (Number(inv.intra_state) === 0 && Number(inv.igst) <= 0 && Number(inv.tax_total) > 0) bad(`Inter missing IGST ${inv.invoice_no}`);
    if (Number(inv.amount_paid) - Number(inv.grand_total) > 0.5) bad(`Overpaid ${inv.invoice_no}`);
  }
  if (!invBad) pass(`Issued invoice totals OK (${invs.length})`);

  // Stock: current_stock should match last movement after_qty (date, then created_at tie-break).
  const stockMismatch = await count(
    `SELECT COUNT(*) AS n FROM ims_items i
     WHERE i.tenant_id = :t AND i.active = 1 AND EXISTS (
       SELECT 1 FROM ims_movements m WHERE m.tenant_id = :t AND m.item_id = i.id
     ) AND ABS(i.current_stock - (
       SELECT m.after_qty FROM ims_movements m WHERE m.tenant_id = :t AND m.item_id = i.id
       ORDER BY m.movement_date DESC, m.created_at DESC, m.id DESC LIMIT 1
     )) > 0.01`,
    { t },
  );
  if (stockMismatch) bad(`Stock vs last movement mismatch: ${stockMismatch}`);
  else pass("Item stock matches last movement");

  // Window span ≥ 700 days
  const span = await one<{ mn: string; mx: string }>(
    `SELECT MIN(invoice_date) AS mn, MAX(invoice_date) AS mx FROM ims_invoices WHERE tenant_id = :t AND status = 'issued'`,
    { t },
  );
  if (span?.mn && span?.mx) {
    const days = Math.round((Date.parse(span.mx) - Date.parse(span.mn)) / 86400000);
    if (days < 600) soft(`Invoice span only ${days} days (want ≥ ~700)`);
    else pass(`Invoice date span ${days} days (${span.mn} → ${span.mx})`);
  }

  // Scenarios
  const need: Array<[string, string]> = [
    ["issued invoices", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id = :t AND status = 'issued'`],
    ["draft invoices", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id = :t AND status = 'draft'`],
    ["cancelled invoices", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id = :t AND status = 'cancelled'`],
    ["IGST invoices", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id = :t AND intra_state = 0 AND igst > 0`],
    ["partial payments", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id = :t AND status = 'issued' AND amount_paid > 0 AND amount_paid < grand_total`],
    ["overdue unpaid", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id = :t AND status = 'issued' AND due_date < :today AND amount_paid < grand_total`],
    ["PO received", `SELECT COUNT(*) AS n FROM ims_purchase_orders WHERE tenant_id = :t AND status = 'received'`],
    ["PO draft/pending", `SELECT COUNT(*) AS n FROM ims_purchase_orders WHERE tenant_id = :t AND status IN ('draft','pending_approval')`],
    ["unmatched bank", `SELECT COUNT(*) AS n FROM ims_bank_txns WHERE tenant_id = :t AND status = 'unmatched'`],
    ["customer returns", `SELECT COUNT(*) AS n FROM ims_returns WHERE tenant_id = :t AND kind = 'customer'`],
    ["supplier returns", `SELECT COUNT(*) AS n FROM ims_returns WHERE tenant_id = :t AND kind = 'supplier'`],
    ["field visits", `SELECT COUNT(*) AS n FROM ims_field_visits WHERE tenant_id = :t`],
    ["audit open", `SELECT COUNT(*) AS n FROM ims_audit_items WHERE tenant_id = :t AND status = 'open'`],
    ["low stock items", `SELECT COUNT(*) AS n FROM ims_items WHERE tenant_id = :t AND active = 1 AND current_stock <= min_stock`],
  ];
  console.log("\n=== SCENARIOS ===");
  for (const [label, sql] of need) {
    const n = await count(sql, { t, today: TODAY });
    if (n < 1) bad(`Missing: ${label}`);
    else pass(`${label}=${n}`);
  }

  // Orphans
  for (const [label, sql] of [
    ["payments→invoices", `SELECT COUNT(*) AS n FROM ims_payments p LEFT JOIN ims_invoices i ON i.id = p.doc_id WHERE p.tenant_id = :t AND p.doc_type = 'invoice' AND i.id IS NULL`],
    ["movements→items", `SELECT COUNT(*) AS n FROM ims_movements m LEFT JOIN ims_items i ON i.id = m.item_id WHERE m.tenant_id = :t AND i.id IS NULL`],
    ["bank→payments", `SELECT COUNT(*) AS n FROM ims_bank_txns b LEFT JOIN ims_payments p ON p.id = b.matched_id WHERE b.tenant_id = :t AND b.status = 'matched' AND b.matched_type = 'payment' AND p.id IS NULL`],
  ] as const) {
    const n = await count(sql, { t });
    if (n) bad(`Orphans ${label}: ${n}`);
    else pass(`No orphans: ${label}`);
  }

  const total = ok.length + warn.length + fail.length;
  const score = total ? Math.round((ok.length / total) * 100) : 0;
  console.log("\n========== IMS QUALITY SUMMARY ==========");
  console.log(`TODAY=${TODAY} tenant=${t}`);
  console.log(`PASS: ${ok.length}  WARN: ${warn.length}  FAIL: ${fail.length}  SCORE: ${score}/100`);
  if (warn.length) warn.forEach((w) => console.log(`  warn: ${w}`));
  if (fail.length) fail.forEach((f) => console.log(`  fail: ${f}`));
  await pool.end();
  process.exit(fail.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});

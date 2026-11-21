/**
 * Honest "nook & corner" coverage check for JustTestX IMS seed.
 *   npx tsx scripts/justtestx/coverage-nooks.ts
 */
import "dotenv/config";
import { pool } from "../../src/db.js";
import { IMS_MODULE_CATALOG } from "../../src/lib/ims-profile-modules.js";
import {
  BILL_STATUSES,
  FIELD_TASK_PRIORITIES,
  FIELD_TASK_STATUSES,
  FIELD_TASK_TYPES,
  PO_STATUSES,
  REPORT_APPROVAL_STATUSES,
  REPORT_TYPES,
  VISIT_OUTCOMES,
} from "../../src/ims/logic.js";
import { BOM_DOC_STATUSES } from "../../src/ims/bom.js";
import { BOM_DC_STATUSES } from "../../src/ims/bom-dc.js";

type Gap = { area: string; severity: "gap" | "thin" | "ok"; detail: string };

async function count(sql: string, p: Record<string, unknown> = {}) {
  const [rows] = await pool.query<Array<{ n: number }>>(sql, p);
  return Number(rows[0]?.n ?? 0);
}
async function groups(sql: string, p: Record<string, unknown> = {}) {
  const [rows] = await pool.query<Array<{ k: string; n: number }>>(sql, p);
  return rows.map((r) => ({ k: String(r.k ?? "(null)"), n: Number(r.n) }));
}

async function main() {
  const [profiles] = await pool.query<Array<{ id: number }>>(
    `SELECT id FROM business_profiles WHERE business_name = 'JustTestX' ORDER BY id DESC LIMIT 1`,
  );
  const t = Number(profiles[0]?.id ?? 0);
  if (!t) throw new Error("JustTestX missing");
  const gaps: Gap[] = [];
  const note = (area: string, severity: Gap["severity"], detail: string) => gaps.push({ area, severity, detail });

  console.log(`\n=== JustTestX IMS nook coverage (tenant=${t}) ===\n`);
  console.log("Modules in catalog:", IMS_MODULE_CATALOG.map((m) => m.key).join(", "));

  // ——— Core volumes ———
  const tables: Array<[string, string, number]> = [
    ["parties", "ims_parties", 10],
    ["items", "ims_items", 10],
    ["movements", "ims_movements", 100],
    ["pos", "ims_purchase_orders", 20],
    ["bills", "ims_bills", 10],
    ["invoices", "ims_invoices", 100],
    ["payments", "ims_payments", 50],
    ["returns", "ims_returns", 3],
    ["checks", "ims_stock_checks", 3],
    ["expenses", "ims_expenses", 10],
    ["closings", "ims_daily_closings", 10],
    ["ar", "ims_ar_activity", 5],
    ["ledger", "ims_ledger_entries", 1],
    ["pay_runs", "ims_payment_runs", 2],
    ["field_tasks", "ims_field_tasks", 10],
    ["field_visits", "ims_field_visits", 10],
    ["field_checkins", "ims_field_checkins", 20],
    ["bank", "ims_bank_txns", 20],
    ["audit", "ims_audit_items", 3],
    ["tickets", "ims_tickets", 3],
    ["reports", "ims_reports", 10],
    ["bom_packages", "ims_bom_packages", 2],
    ["bom_docs", "ims_bom_docs", 5],
    ["bom_dcs", "ims_bom_dcs", 4],
    ["bom_rate_cards", "ims_bom_rate_cards", 2],
    ["bom_dc_returns", "ims_bom_dc_returns", 1],
    ["excise", "ims_excise_records", 1],
    ["documents", "ims_documents", 1],
    ["integrations", "ims_integrations", 1],
    ["sync_log", "ims_sync_log", 1],
  ];
  for (const [label, table, min] of tables) {
    const n = await count(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ?`, [t]);
    if (n < 1) note(label, "gap", `empty (${table})`);
    else if (n < min) note(label, "thin", `${n} rows (want ≥${min})`);
    else note(label, "ok", `${n} rows`);
  }

  // ——— Status completeness ———
  const statusChecks: Array<{ area: string; table: string; col: string; expected: readonly string[] }> = [
    { area: "PO statuses", table: "ims_purchase_orders", col: "status", expected: PO_STATUSES },
    { area: "Bill statuses", table: "ims_bills", col: "status", expected: BILL_STATUSES },
    { area: "Invoice statuses", table: "ims_invoices", col: "status", expected: ["draft", "issued", "cancelled"] },
    { area: "Return statuses", table: "ims_returns", col: "status", expected: ["open", "completed", "cancelled"] },
    { area: "Stock-check statuses", table: "ims_stock_checks", col: "status", expected: ["counting", "submitted", "adjusted", "cancelled"] },
    { area: "Payment-run statuses", table: "ims_payment_runs", col: "status", expected: ["scheduled", "paid", "cancelled"] },
    { area: "Field-task statuses", table: "ims_field_tasks", col: "status", expected: FIELD_TASK_STATUSES },
    { area: "Bank statuses", table: "ims_bank_txns", col: "status", expected: ["matched", "unmatched", "ignored"] },
    { area: "BOM doc statuses", table: "ims_bom_docs", col: "status", expected: BOM_DOC_STATUSES },
    { area: "BOM DC statuses", table: "ims_bom_dcs", col: "status", expected: BOM_DC_STATUSES },
    { area: "Ticket statuses", table: "ims_tickets", col: "status", expected: ["open", "in_progress", "waiting", "resolved", "closed"] },
    { area: "Report approval", table: "ims_reports", col: "approval_status", expected: REPORT_APPROVAL_STATUSES },
  ];
  for (const c of statusChecks) {
    const g = await groups(`SELECT ${c.col} AS k, COUNT(*) AS n FROM ${c.table} WHERE tenant_id = ? GROUP BY ${c.col}`, [t]);
    const have = new Set(g.map((x) => x.k));
    const missing = c.expected.filter((e) => !have.has(e));
    if (missing.length) note(c.area, "gap", `missing: ${missing.join(", ")} | have: ${g.map((x) => `${x.k}=${x.n}`).join(", ")}`);
    else note(c.area, "ok", g.map((x) => `${x.k}=${x.n}`).join(", "));
  }

  // ——— Scenario / edge checks ———
  const scenarios: Array<[string, string, number]> = [
    ["inactive item", `SELECT COUNT(*) AS n FROM ims_items WHERE tenant_id=? AND active=0`, 1],
    ["low stock", `SELECT COUNT(*) AS n FROM ims_items WHERE tenant_id=? AND active=1 AND current_stock<=min_stock`, 1],
    ["out of stock", `SELECT COUNT(*) AS n FROM ims_items WHERE tenant_id=? AND active=1 AND current_stock<=0`, 1],
    ["dead stock idle 90d", `SELECT COUNT(*) AS n FROM ims_items WHERE tenant_id=? AND active=1 AND current_stock>0 AND last_movement_at < DATE_SUB(CURDATE(), INTERVAL 90 DAY)`, 1],
    ["damage moves", `SELECT COUNT(*) AS n FROM ims_movements WHERE tenant_id=? AND type='DAMAGE'`, 5],
    ["write-off moves", `SELECT COUNT(*) AS n FROM ims_movements WHERE tenant_id=? AND type='WRITE_OFF'`, 1],
    ["adjustment moves", `SELECT COUNT(*) AS n FROM ims_movements WHERE tenant_id=? AND type='ADJUSTMENT'`, 1],
    ["return IN", `SELECT COUNT(*) AS n FROM ims_movements WHERE tenant_id=? AND type='RETURN_IN'`, 1],
    ["return OUT", `SELECT COUNT(*) AS n FROM ims_movements WHERE tenant_id=? AND type='RETURN_OUT'`, 1],
    ["opening moves", `SELECT COUNT(*) AS n FROM ims_movements WHERE tenant_id=? AND type='OPENING'`, 1],
    ["IGST invoices", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id=? AND status='issued' AND intra_state=0 AND igst>0`, 1],
    ["CGST invoices", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id=? AND status='issued' AND intra_state=1 AND cgst>0`, 1],
    ["unregistered B2C", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id=? AND status='issued' AND (customer_gstin IS NULL OR customer_gstin='')`, 1],
    ["B2CL-ish (>1L inter unreg)", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id=? AND status='issued' AND intra_state=0 AND (customer_gstin IS NULL OR customer_gstin='') AND grand_total>100000`, 1],
    ["disputed invoices", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id=? AND disputed=1`, 1],
    ["POS-sourced invoices", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id=? AND source_tool='pos'`, 1],
    ["partial AR", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id=? AND status='issued' AND amount_paid>0 AND amount_paid<grand_total`, 1],
    ["AR overdue unpaid", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id=? AND status='issued' AND due_date<CURDATE() AND amount_paid<grand_total`, 1],
    ["AR >90d", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id=? AND status='issued' AND due_date<DATE_SUB(CURDATE(), INTERVAL 90 DAY) AND amount_paid<grand_total`, 1],
    ["customer returns", `SELECT COUNT(*) AS n FROM ims_returns WHERE tenant_id=? AND kind='customer'`, 1],
    ["supplier returns", `SELECT COUNT(*) AS n FROM ims_returns WHERE tenant_id=? AND kind='supplier'`, 1],
    ["BOM draft/confirmed/cancelled", `SELECT COUNT(DISTINCT status) AS n FROM ims_bom_docs WHERE tenant_id=?`, 3],
    ["BOM DC all 4 statuses", `SELECT COUNT(DISTINCT status) AS n FROM ims_bom_dcs WHERE tenant_id=?`, 4],
    ["BOM DC returns", `SELECT COUNT(*) AS n FROM ims_bom_dc_returns WHERE tenant_id=?`, 1],
    ["BOM rate cards", `SELECT COUNT(*) AS n FROM ims_bom_rate_cards WHERE tenant_id=?`, 2],
    ["inactive BOM package", `SELECT COUNT(*) AS n FROM ims_bom_packages WHERE tenant_id=? AND active=0`, 1],
    ["invoice↔DC links", `SELECT COUNT(*) AS n FROM ims_invoice_dc_links WHERE tenant_id=?`, 1],
    ["PO linked to BOM", `SELECT COUNT(*) AS n FROM ims_purchase_orders WHERE tenant_id=? AND bom_doc_id IS NOT NULL`, 1],
    ["saved report types", `SELECT COUNT(DISTINCT report_type) AS n FROM ims_reports WHERE tenant_id=?`, REPORT_TYPES.length],
    ["GST rate diversity", `SELECT COUNT(DISTINCT gst_rate) AS n FROM ims_items WHERE tenant_id=? AND active=1`, 2],
    ["unmatched bank", `SELECT COUNT(*) AS n FROM ims_bank_txns WHERE tenant_id=? AND status='unmatched'`, 1],
    ["ignored bank", `SELECT COUNT(*) AS n FROM ims_bank_txns WHERE tenant_id=? AND status='ignored'`, 1],
    ["sync success+fail", `SELECT COUNT(DISTINCT status) AS n FROM ims_sync_log WHERE tenant_id=?`, 2],
    ["both payment directions", `SELECT COUNT(DISTINCT direction) AS n FROM ims_payments WHERE tenant_id=?`, 2],
    ["closing open+closed", `SELECT COUNT(DISTINCT status) AS n FROM ims_daily_closings WHERE tenant_id=?`, 2],
    ["party both kinds", `SELECT COUNT(DISTINCT kind) AS n FROM ims_parties WHERE tenant_id=?`, 2],
    ["excise rows", `SELECT COUNT(*) AS n FROM ims_excise_records WHERE tenant_id=?`, 1],
    ["field visit outcomes", `SELECT COUNT(DISTINCT outcome) AS n FROM ims_field_visits WHERE tenant_id=?`, 4],
    ["field task types", `SELECT COUNT(DISTINCT task_type) AS n FROM ims_field_tasks WHERE tenant_id=?`, 3],
    ["multi-user field", `SELECT COUNT(DISTINCT user_id) AS n FROM ims_field_visits WHERE tenant_id=?`, 2],
  ];
  for (const [label, sql, min] of scenarios) {
    const n = await count(sql, [t]);
    if (n < min) note(label, n < 1 ? "gap" : "thin", `got ${n}, want ≥${min}`);
    else note(label, "ok", `n=${n}`);
  }

  // Field type / priority / outcome completeness
  const taskTypes = await groups(`SELECT task_type AS k, COUNT(*) AS n FROM ims_field_tasks WHERE tenant_id=? GROUP BY task_type`, [t]);
  const missTypes = FIELD_TASK_TYPES.filter((x) => !taskTypes.some((g) => g.k === x));
  if (missTypes.length) note("Field task types", "thin", `missing: ${missTypes.join(", ")}`);
  else note("Field task types", "ok", "all");

  const prios = await groups(`SELECT priority AS k, COUNT(*) AS n FROM ims_field_tasks WHERE tenant_id=? GROUP BY priority`, [t]);
  const missP = FIELD_TASK_PRIORITIES.filter((x) => !prios.some((g) => g.k === x));
  if (missP.length) note("Field priorities", "thin", `missing: ${missP.join(", ")}`);
  else note("Field priorities", "ok", "all");

  const outs = await groups(`SELECT outcome AS k, COUNT(*) AS n FROM ims_field_visits WHERE tenant_id=? GROUP BY outcome`, [t]);
  const missO = VISIT_OUTCOMES.filter((x) => !outs.some((g) => g.k === x));
  if (missO.length) note("Visit outcomes", "thin", `missing: ${missO.join(", ")}`);
  else note("Visit outcomes", "ok", "all");

  // Module → data mapping (screens that can look empty)
  const moduleHints: Array<[string, string, number]> = [
    ["dashboard", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id=?`, 1],
    ["stockin", `SELECT COUNT(*) AS n FROM ims_movements WHERE tenant_id=? AND type='IN'`, 1],
    ["stockout", `SELECT COUNT(*) AS n FROM ims_movements WHERE tenant_id=? AND type='OUT'`, 1],
    ["stock", `SELECT COUNT(*) AS n FROM ims_items WHERE tenant_id=?`, 1],
    ["checks", `SELECT COUNT(*) AS n FROM ims_stock_checks WHERE tenant_id=?`, 1],
    ["lowstock", `SELECT COUNT(*) AS n FROM ims_items WHERE tenant_id=? AND current_stock<=min_stock`, 1],
    ["items", `SELECT COUNT(*) AS n FROM ims_items WHERE tenant_id=?`, 1],
    ["parties", `SELECT COUNT(*) AS n FROM ims_parties WHERE tenant_id=?`, 1],
    ["purchase", `SELECT COUNT(*) AS n FROM ims_purchase_orders WHERE tenant_id=?`, 1],
    ["approvals", `SELECT COUNT(*) AS n FROM ims_purchase_orders WHERE tenant_id=? AND status='pending_approval'`, 1],
    ["bom", `SELECT COUNT(*) AS n FROM ims_bom_docs WHERE tenant_id=?`, 1],
    ["bomDc", `SELECT COUNT(*) AS n FROM ims_bom_dcs WHERE tenant_id=?`, 1],
    ["bomPackages", `SELECT COUNT(*) AS n FROM ims_bom_packages WHERE tenant_id=?`, 1],
    ["bomRateCards", `SELECT COUNT(*) AS n FROM ims_bom_rate_cards WHERE tenant_id=?`, 1],
    ["bomCompare", `SELECT COUNT(*) AS n FROM ims_bom_docs WHERE tenant_id=?`, 2],
    ["sales", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id=?`, 1],
    ["receivables", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id=? AND status='issued' AND amount_paid<grand_total`, 1],
    ["payables", `SELECT COUNT(*) AS n FROM ims_bills WHERE tenant_id=? AND amount_paid<grand_total`, 1],
    ["ledger", `SELECT COUNT(*) AS n FROM ims_ledger_entries WHERE tenant_id=?`, 1],
    ["closing", `SELECT COUNT(*) AS n FROM ims_daily_closings WHERE tenant_id=?`, 1],
    ["field", `SELECT COUNT(*) AS n FROM ims_field_visits WHERE tenant_id=?`, 1],
    ["returns", `SELECT COUNT(*) AS n FROM ims_returns WHERE tenant_id=?`, 1],
    ["reports", `SELECT COUNT(*) AS n FROM ims_reports WHERE tenant_id=?`, 1],
    ["gst", `SELECT COUNT(*) AS n FROM ims_invoices WHERE tenant_id=? AND status='issued'`, 1],
    ["history", `SELECT COUNT(*) AS n FROM ims_movements WHERE tenant_id=?`, 1],
    ["audit", `SELECT COUNT(*) AS n FROM ims_audit_items WHERE tenant_id=?`, 1],
    ["excise", `SELECT COUNT(*) AS n FROM ims_excise_records WHERE tenant_id=?`, 1],
    ["integrations", `SELECT COUNT(*) AS n FROM ims_integrations WHERE tenant_id=?`, 1],
    ["connect", `SELECT COUNT(*) AS n FROM ims_links WHERE tenant_id=?`, 1],
    ["helpdesk", `SELECT COUNT(*) AS n FROM ims_tickets WHERE tenant_id=?`, 1],
    ["settings", `SELECT COUNT(*) AS n FROM ims_settings WHERE tenant_id=?`, 1],
  ];
  console.log("\n--- Module screen data ---");
  for (const [mod, sql, min] of moduleHints) {
    const n = await count(sql, [t]);
    const sev = n < 1 ? "gap" : n < min ? "thin" : "ok";
    note(`module:${mod}`, sev as Gap["severity"], `n=${n}`);
  }

  // Excise module gate + activity + team + PDF vault
  const exciseOn = await count(`SELECT COUNT(*) AS n FROM ims_settings WHERE tenant_id=? AND excise_enabled=1`, [t]);
  note("excise enabled", exciseOn >= 1 ? "ok" : "gap", `excise_enabled=${exciseOn >= 1 ? 1 : 0}`);
  const members = await count(`SELECT COUNT(*) AS n FROM ims_members WHERE tenant_id=? AND active=1`, [t]);
  note("ims members", members >= 3 ? "ok" : members >= 1 ? "thin" : "gap", `n=${members}`);
  const events = await count(`SELECT COUNT(*) AS n FROM ims_events WHERE tenant_id=?`, [t]);
  note("activity events", events >= 50 ? "ok" : events >= 1 ? "thin" : "gap", `n=${events}`);
  const pdfs = await count(`SELECT COUNT(*) AS n FROM ims_bom_pdf_blobs WHERE tenant_id=?`, [t]);
  note("BOM PDF blobs", pdfs >= 1 ? "ok" : "gap", `n=${pdfs}`);
  const docsWithFile = await count(`SELECT COUNT(*) AS n FROM ims_documents WHERE tenant_id=? AND content IS NOT NULL`, [t]);
  note("document file blobs", docsWithFile >= 1 ? "ok" : "thin", `n=${docsWithFile}`);
  const ticketThreads = await count(`SELECT COUNT(*) AS n FROM ims_tickets WHERE tenant_id=? AND JSON_LENGTH(thread)>0`, [t]);
  note("ticket threads", ticketThreads >= 1 ? "ok" : "thin", `n=${ticketThreads}`);
  const expGst = await count(`SELECT COUNT(*) AS n FROM ims_expenses WHERE tenant_id=? AND gst_amount>0`, [t]);
  note("expense GST", expGst >= 1 ? "ok" : "thin", `n=${expGst}`);
  const overstock = await count(`SELECT COUNT(*) AS n FROM ims_items WHERE tenant_id=? AND active=1 AND current_stock>max_stock AND max_stock>0`, [t]);
  note("overstock items", overstock >= 1 ? "ok" : "thin", `n=${overstock}`);

  // Known structural / intentional limits
  note("scanner", "thin", "QR scan is live UX — barcodes exist on items; no persisted scan-session history");
  note("GSTR-2B", "thin", "Upload-only at runtime — not persisted; checklist doc + audit query seeded for QA guidance");
  note("FAQ", "thin", "Static help content in UI — not a seedable table");

  const billPending = await count(`SELECT COUNT(*) AS n FROM ims_bills WHERE tenant_id=? AND status='pending_approval'`, [t]);
  if (billPending < 1) note("Bill pending_approval", "gap", "no pending_approval bills for Approvals/AP queues");
  else note("Bill pending_approval", "ok", `n=${billPending}`);

  const fieldInProgress = await count(`SELECT COUNT(*) AS n FROM ims_field_tasks WHERE tenant_id=? AND status='in_progress'`, [t]);
  if (fieldInProgress < 1) note("Field in_progress", "gap", "no in_progress field tasks");
  else note("Field in_progress", "ok", `n=${fieldInProgress}`);

  // Summary
  const ok = gaps.filter((g) => g.severity === "ok").length;
  const thin = gaps.filter((g) => g.severity === "thin");
  const gap = gaps.filter((g) => g.severity === "gap");
  console.log("\n========== NOOK SUMMARY ==========");
  console.log(`OK: ${ok}  THIN: ${thin.length}  GAP: ${gap.length}`);
  if (gap.length) {
    console.log("\nGAPS (not covered):");
    gap.forEach((g) => console.log(`  ✗ [${g.area}] ${g.detail}`));
  }
  if (thin.length) {
    console.log("\nTHIN (partial):");
    thin.forEach((g) => console.log(`  ~ [${g.area}] ${g.detail}`));
  }
  await pool.end();
  process.exit(gap.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exit(1);
});

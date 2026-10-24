/**
 * Quality audit for JustTestX BOS seed data.
 *   npm run db:audit:justtestx -w server
 */
import "dotenv/config";
import { pool } from "../../src/db.js";
import { computeInvoiceTotals, todayISO } from "../../src/bos/logic.js";
import type { RowDataPacket } from "mysql2/promise";

const TODAY = todayISO(new Date(), "Asia/Kolkata");
const ok: string[] = [];
const warn: string[] = [];
const fail: string[] = [];

const pass = (m: string) => ok.push(m);
const soft = (m: string) => warn.push(m);
const bad = (m: string) => fail.push(m);

async function one<T extends RowDataPacket = RowDataPacket>(sql: string, p: Record<string, unknown> = {}): Promise<T | null> {
  const [rows] = await pool.query<T[]>(sql, p);
  return rows[0] ?? null;
}
async function many<T extends RowDataPacket = RowDataPacket>(sql: string, p: Record<string, unknown> = {}): Promise<T[]> {
  const [rows] = await pool.query<T[]>(sql, p);
  return rows;
}
async function count(sql: string, p: Record<string, unknown> = {}): Promise<number> {
  const r = await one<RowDataPacket & { n?: number; c?: number }>(sql, p);
  return Number(r?.n ?? r?.c ?? 0);
}

async function main() {
  const profile = await one<{ id: number; organization_id: number; business_name: string; gstin: string | null }>(
    `SELECT id, organization_id, business_name, gstin FROM business_profiles WHERE business_name = 'JustTestX' ORDER BY id DESC LIMIT 1`,
  );
  if (!profile) {
    console.error("FAIL: JustTestX profile missing — seed first");
    process.exit(1);
  }
  const t = Number(profile.id);
  const orgId = Number(profile.organization_id);
  pass(`Profile JustTestX id=${t} org=${orgId}`);

  const meta = await one<{ approval_status: string; archived_at: string | null }>(
    `SELECT approval_status, archived_at FROM business_profile_meta WHERE business_profile_id = :id`,
    { id: t },
  );
  if (!meta || meta.approval_status !== "approved" || meta.archived_at) bad(`Profile not approved/active: ${JSON.stringify(meta)}`);
  else pass("Profile approved");

  const bosOn = await one<{ available: number }>(`SELECT available FROM tool_catalog WHERE organization_id = :o AND tool_id = 'bos'`, { o: orgId });
  if (!bosOn || Number(bosOn.available) !== 1) bad("BOS not enabled in tool_catalog");
  else pass("BOS enabled");

  const owner = await one<{ email: string; role: string }>(
    `SELECT u.email, m.role FROM users u
     JOIN org_members m ON m.user_id = u.id
     WHERE m.organization_id = :o AND u.email = 'santhosh.hs@justxsystems.com'`,
    { o: orgId },
  );
  if (!owner || owner.role !== "owner") bad("Owner membership missing");
  else pass(`Owner linked: ${owner.email}`);

  const settings = await one<{ company_name: string; invoice_prefix: string }>(`SELECT company_name, invoice_prefix FROM bos_settings WHERE tenant_id = :t`, { t });
  if (!settings) bad("bos_settings missing");
  else {
    pass(`bos_settings present (${settings.company_name})`);
    if (settings.invoice_prefix !== "JTX") soft(`invoice_prefix expected JTX got ${settings.invoice_prefix}`);
  }

  const coverage: Record<string, number> = {};
  const tables: Array<[string, string]> = [
    ["departments", "bos_departments"],
    ["employees", "bos_employees"],
    ["parties", "bos_parties"],
    ["invoices", "bos_invoices"],
    ["payments", "bos_payments"],
    ["bills", "bos_bills"],
    ["expenses", "bos_expenses"],
    ["attendance", "bos_attendance"],
    ["leaves", "bos_leave_requests"],
    ["projects", "bos_projects"],
    ["tasks", "bos_project_tasks"],
    ["payroll_runs", "bos_payroll_runs"],
    ["payslips", "bos_payslips"],
    ["bank_txns", "bos_bank_txns"],
    ["assets", "bos_assets"],
    ["accounts", "bos_accounts"],
    ["items", "bos_items"],
    ["sales_docs", "bos_sales_docs"],
    ["policies", "bos_policies"],
    ["travel", "bos_travel_requests"],
    ["services", "bos_service_requests"],
    ["candidates", "bos_candidates"],
    ["holidays", "bos_holidays"],
    ["budgets", "bos_budgets"],
    ["compliance", "bos_compliance_items"],
    ["agreements", "bos_agreements"],
    ["kras", "bos_kras"],
    ["training", "bos_training_programs"],
  ];
  for (const [key, table] of tables) {
    coverage[key] = await count(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = :t`, { t });
    if (coverage[key]! <= 0) bad(`Empty module: ${key}`);
    else pass(`${key}=${coverage[key]}`);
  }

  console.log("\n=== COVERAGE ===");
  console.log(coverage);

  console.log("\n=== STATUS DISTRIBUTIONS ===");
  const dists: Array<[string, string]> = [
    ["bos_invoices", "status"],
    ["bos_bills", "status"],
    ["bos_expenses", "status"],
    ["bos_leave_requests", "status"],
    ["bos_projects", "status"],
    ["bos_payroll_runs", "status"],
    ["bos_bank_txns", "status"],
    ["bos_assets", "status"],
    ["bos_travel_requests", "status"],
    ["bos_service_requests", "status"],
    ["bos_candidates", "stage"],
    ["bos_employees", "status"],
    ["bos_sales_docs", "kind"],
    ["bos_parties", "kind"],
  ];
  for (const [table, col] of dists) {
    const d = await many<{ k: string; n: number }>(`SELECT ${col} AS k, COUNT(*) AS n FROM ${table} WHERE tenant_id = :t GROUP BY ${col} ORDER BY n DESC`, { t });
    console.log(`${table}.${col}:`, d.map((x) => `${x.k}=${x.n}`).join(", "));
  }

  // Invoice money integrity
  const invs = await many<RowDataPacket>(`SELECT * FROM bos_invoices WHERE tenant_id = :t`, { t });
  let invBad = 0;
  for (const inv of invs) {
    const linesRaw = typeof inv.line_items === "string" ? JSON.parse(inv.line_items as string) : inv.line_items;
    const lines = (linesRaw as Array<Record<string, unknown>>).map((l) => ({
      description: String(l.description ?? ""),
      hsn: (l.hsn as string) ?? null,
      unit: (l.unit as string) ?? null,
      quantity: Number(l.quantity),
      rate: Number(l.rate),
      discountPct: Number(l.discountPct ?? 0),
      taxRate: Number(l.taxRate),
    }));
    const totals = computeInvoiceTotals(lines, Number(inv.intra_state) === 1);
    const near = (a: unknown, b: number) => Math.abs(Number(a) - b) < 0.02;
    if (!near(inv.grand_total, totals.grandTotal) || !near(inv.tax_total, totals.taxTotal)) {
      invBad++;
      if (invBad <= 5) bad(`Invoice totals mismatch ${inv.invoice_no} stored=${inv.grand_total} recomputed=${totals.grandTotal}`);
    }
    if (Number(inv.amount_paid) - Number(inv.grand_total) > 0.5) bad(`Overpaid invoice ${inv.invoice_no}`);
    if (inv.status === "paid" && Number(inv.amount_paid) + 0.5 < Number(inv.grand_total)) bad(`Paid invoice underpaid ${inv.invoice_no}`);
    if (inv.status === "partial" && !(Number(inv.amount_paid) > 0 && Number(inv.amount_paid) + 0.5 < Number(inv.grand_total))) {
      bad(`Partial invoice bad paid amt ${inv.invoice_no}`);
    }
    if (Number(inv.intra_state) === 1 && Number(inv.igst) > 0.01) bad(`Intra invoice has IGST ${inv.invoice_no}`);
    if (Number(inv.intra_state) === 0 && (Number(inv.cgst) > 0.01 || Number(inv.sgst) > 0.01)) bad(`Inter invoice has CGST/SGST ${inv.invoice_no}`);
  }
  if (invBad === 0) pass(`All ${invs.length} invoice totals recompute OK`);

  // Orphans
  console.log("\n=== ORPHANS ===");
  const orphans: Array<[string, string]> = [
    ["payments→invoices", `SELECT COUNT(*) AS n FROM bos_payments p LEFT JOIN bos_invoices i ON i.id = p.invoice_id WHERE p.tenant_id = :t AND i.id IS NULL`],
    ["payslips→runs", `SELECT COUNT(*) AS n FROM bos_payslips s LEFT JOIN bos_payroll_runs r ON r.id = s.run_id WHERE s.tenant_id = :t AND r.id IS NULL`],
    ["payslips→emps", `SELECT COUNT(*) AS n FROM bos_payslips s LEFT JOIN bos_employees e ON e.id = s.employee_id WHERE s.tenant_id = :t AND e.id IS NULL`],
    ["leave→emps", `SELECT COUNT(*) AS n FROM bos_leave_requests l LEFT JOIN bos_employees e ON e.id = l.employee_id WHERE l.tenant_id = :t AND e.id IS NULL`],
    ["attendance→emps", `SELECT COUNT(*) AS n FROM bos_attendance a LEFT JOIN bos_employees e ON e.id = a.employee_id WHERE a.tenant_id = :t AND e.id IS NULL`],
    ["tasks→emps", `SELECT COUNT(*) AS n FROM bos_project_tasks k LEFT JOIN bos_employees e ON e.id = k.assignee_employee_id WHERE k.tenant_id = :t AND k.assignee_employee_id IS NOT NULL AND e.id IS NULL`],
    ["bank match payments", `SELECT COUNT(*) AS n FROM bos_bank_txns b LEFT JOIN bos_payments p ON p.id = b.match_id WHERE b.tenant_id = :t AND b.status = 'matched' AND b.match_type = 'payment' AND p.id IS NULL`],
    ["candidates→openings", `SELECT COUNT(*) AS n FROM bos_candidates c LEFT JOIN bos_job_openings o ON o.id = c.opening_id WHERE c.tenant_id = :t AND o.id IS NULL`],
    ["journal lines→accts", `SELECT COUNT(*) AS n FROM bos_journal_lines l LEFT JOIN bos_accounts a ON a.id = l.account_id WHERE l.tenant_id = :t AND a.id IS NULL`],
    ["projects→parties", `SELECT COUNT(*) AS n FROM bos_projects p LEFT JOIN bos_parties x ON x.id = p.party_id WHERE p.tenant_id = :t AND p.party_id IS NOT NULL AND x.id IS NULL`],
  ];
  for (const [label, sql] of orphans) {
    const n = await count(sql, { t });
    if (n > 0) bad(`Orphans ${label}: ${n}`);
    else pass(`No orphans: ${label}`);
  }

  // Sequences
  const empSeq = await one<{ seq_value: number }>(`SELECT seq_value FROM bos_sequences WHERE tenant_id = :t AND seq_key = 'employee' AND period = 'all'`, { t });
  const empMax = await one<{ m: number }>(
    `SELECT MAX(CAST(SUBSTRING_INDEX(emp_code, '-', -1) AS UNSIGNED)) AS m FROM bos_employees WHERE tenant_id = :t`,
    { t },
  );
  if (!empSeq || Number(empSeq.seq_value) < Number(empMax?.m ?? 0)) bad("employee sequence behind max code");
  else pass(`employee sequence OK (${empSeq.seq_value})`);

  const invSeqs = await many<{ period: string; seq_value: number }>(`SELECT period, seq_value FROM bos_sequences WHERE tenant_id = :t AND seq_key = 'invoice'`, { t });
  for (const s of invSeqs) {
    const m = await one<{ m: number }>(
      `SELECT MAX(CAST(SUBSTRING_INDEX(invoice_no, '/', -1) AS UNSIGNED)) AS m
       FROM bos_invoices WHERE tenant_id = :t AND invoice_no LIKE :pat`,
      { t, pat: `%/${s.period}/%` },
    );
    if (Number(s.seq_value) < Number(m?.m ?? 0)) bad(`invoice seq ${s.period} behind`);
  }
  pass(`invoice sequences checked (${invSeqs.length} FY)`);

  // Scenario richness
  console.log("\n=== SCENARIO RICHNESS ===");
  const need: Array<[string, string]> = [
    ["invoices paid", `SELECT COUNT(*) AS n FROM bos_invoices WHERE tenant_id = :t AND status = 'paid'`],
    ["invoices partial", `SELECT COUNT(*) AS n FROM bos_invoices WHERE tenant_id = :t AND status = 'partial'`],
    ["invoices draft", `SELECT COUNT(*) AS n FROM bos_invoices WHERE tenant_id = :t AND status = 'draft'`],
    ["invoices void", `SELECT COUNT(*) AS n FROM bos_invoices WHERE tenant_id = :t AND status = 'void'`],
    ["invoices overdue", `SELECT COUNT(*) AS n FROM bos_invoices WHERE tenant_id = :t AND status IN ('sent','partial') AND due_date < :today AND amount_paid < grand_total`],
    ["inter-state IGST", `SELECT COUNT(*) AS n FROM bos_invoices WHERE tenant_id = :t AND intra_state = 0 AND igst > 0`],
    ["POS bills", `SELECT COUNT(*) AS n FROM bos_invoices WHERE tenant_id = :t AND source_tool = 'pos'`],
    ["pending leave", `SELECT COUNT(*) AS n FROM bos_leave_requests WHERE tenant_id = :t AND status = 'pending'`],
    ["pending bill", `SELECT COUNT(*) AS n FROM bos_bills WHERE tenant_id = :t AND status = 'pending'`],
    ["submitted expense", `SELECT COUNT(*) AS n FROM bos_expenses WHERE tenant_id = :t AND status = 'submitted'`],
    ["unmatched bank", `SELECT COUNT(*) AS n FROM bos_bank_txns WHERE tenant_id = :t AND status = 'unmatched'`],
    ["draft payroll", `SELECT COUNT(*) AS n FROM bos_payroll_runs WHERE tenant_id = :t AND status = 'draft'`],
    ["exited employee", `SELECT COUNT(*) AS n FROM bos_employees WHERE tenant_id = :t AND status = 'exited'`],
    ["published policy", `SELECT COUNT(*) AS n FROM bos_policies WHERE tenant_id = :t AND status = 'published'`],
    ["draft policy", `SELECT COUNT(*) AS n FROM bos_policies WHERE tenant_id = :t AND status = 'draft'`],
    ["pending travel", `SELECT COUNT(*) AS n FROM bos_travel_requests WHERE tenant_id = :t AND status = 'pending'`],
    ["project lead", `SELECT COUNT(*) AS n FROM bos_projects WHERE tenant_id = :t AND status = 'lead'`],
    ["project completed", `SELECT COUNT(*) AS n FROM bos_projects WHERE tenant_id = :t AND status = 'completed'`],
    ["unacked policies", `SELECT COUNT(*) AS n FROM bos_employees e WHERE e.tenant_id = :t AND e.status IN ('active','probation') AND NOT EXISTS (
       SELECT 1 FROM bos_policy_acks a JOIN bos_policies p ON p.id = a.policy_id
       WHERE a.employee_id = e.id AND p.tenant_id = :t AND p.status = 'published' AND a.version = p.version)`],
  ];
  for (const [label, sql] of need) {
    const n = await count(sql, { t, today: TODAY });
    if (n < 1) bad(`Missing scenario: ${label}`);
    else pass(`${label}=${n}`);
  }

  // Payslip math sample
  const slips = await many<RowDataPacket>(
    `SELECT gross, total_deductions, net_pay, earnings, deductions FROM bos_payslips WHERE tenant_id = :t ORDER BY RAND() LIMIT 80`,
    { t },
  );
  let slipBad = 0;
  for (const s of slips) {
    const earn = (typeof s.earnings === "string" ? JSON.parse(s.earnings) : s.earnings) as Array<{ amount: number }>;
    const ded = (typeof s.deductions === "string" ? JSON.parse(s.deductions) : s.deductions) as Array<{ amount: number }>;
    const earnSum = earn.reduce((a, x) => a + Number(x.amount), 0);
    const dedSum = ded.reduce((a, x) => a + Number(x.amount), 0);
    if (Math.abs(earnSum - Number(s.gross)) > 1 || Math.abs(dedSum - Number(s.total_deductions)) > 1) slipBad++;
    if (Math.abs(Number(s.gross) - Number(s.total_deductions) - Number(s.net_pay)) > 1) slipBad++;
  }
  if (slipBad) bad(`Payslip math issues in sample: ${slipBad}/${slips.length}`);
  else pass(`Payslip math OK (sampled ${slips.length})`);

  // Owner ↔ employee
  const linked = await one<{ emp_code: string }>(
    `SELECT e.emp_code FROM bos_employees e
     JOIN users u ON u.id = e.user_id
     WHERE e.tenant_id = :t AND u.email = 'santhosh.hs@justxsystems.com'`,
    { t },
  );
  if (!linked) bad("Owner not linked to bos_employees.user_id (Home → My Profile broken)");
  else pass(`Owner linked to employee ${linked.emp_code}`);

  // Journal balance
  const jl = await one<{ d: number; c: number }>(`SELECT SUM(debit) AS d, SUM(credit) AS c FROM bos_journal_lines WHERE tenant_id = :t`, { t });
  if (!jl || Math.abs(Number(jl.d) - Number(jl.c)) > 0.01) bad(`Journals unbalanced d=${jl?.d} c=${jl?.c}`);
  else pass(`Journals balanced (${jl.d})`);

  // System accounts present
  const sys = await count(`SELECT COUNT(*) AS n FROM bos_accounts WHERE tenant_id = :t AND system_key IS NOT NULL`, { t });
  if (sys < 25) soft(`Only ${sys} system accounts (expected ~30)`);
  else pass(`System accounts=${sys}`);

  // POS switch
  const pos = await one<{ enabled: number }>(`SELECT enabled FROM org_feature_switches WHERE organization_id = :o AND switch_key = 'bos.sales.pos'`, { o: orgId });
  if (!pos || Number(pos.enabled) !== 1) soft("POS feature switch off");
  else pass("POS switch on");

  // Duplicate invoice numbers
  const dupInv = await count(
    `SELECT COUNT(*) AS n FROM (
       SELECT invoice_no FROM bos_invoices WHERE tenant_id = :t GROUP BY invoice_no HAVING COUNT(*) > 1
     ) x`,
    { t },
  );
  if (dupInv) bad(`Duplicate invoice numbers: ${dupInv}`);
  else pass("Invoice numbers unique");

  // Duplicate emp codes
  const dupEmp = await count(
    `SELECT COUNT(*) AS n FROM (
       SELECT emp_code FROM bos_employees WHERE tenant_id = :t GROUP BY emp_code HAVING COUNT(*) > 1
     ) x`,
    { t },
  );
  if (dupEmp) bad(`Duplicate emp codes: ${dupEmp}`);
  else pass("Employee codes unique");

  // Payment sum vs amount_paid
  const payMismatch = await many<{ invoice_no: string; amount_paid: number; sum_pay: number }>(
    `SELECT i.invoice_no, i.amount_paid, COALESCE(SUM(p.amount),0) AS sum_pay
     FROM bos_invoices i
     LEFT JOIN bos_payments p ON p.invoice_id = i.id
     WHERE i.tenant_id = :t
     GROUP BY i.id
     HAVING ABS(i.amount_paid - COALESCE(SUM(p.amount),0)) > 0.5`,
    { t },
  );
  if (payMismatch.length) bad(`amount_paid ≠ payments sum: ${payMismatch.map((x) => x.invoice_no).join(", ")}`);
  else pass("Invoice amount_paid matches payment rows");

  // Score
  const total = ok.length + warn.length + fail.length;
  const score = total ? Math.round((ok.length / total) * 100) : 0;

  console.log("\n========== QUALITY SUMMARY ==========");
  console.log(`TODAY=${TODAY}  tenant=${t}`);
  console.log(`PASS: ${ok.length}`);
  console.log(`WARN: ${warn.length}`);
  console.log(`FAIL: ${fail.length}`);
  console.log(`SCORE: ${score}/100`);
  if (warn.length) {
    console.log("\nWarnings:");
    for (const w of warn) console.log(`  - ${w}`);
  }
  if (fail.length) {
    console.log("\nFailures:");
    for (const f of fail) console.log(`  - ${f}`);
  }

  await pool.end();
  process.exit(fail.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});

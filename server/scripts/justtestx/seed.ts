/**
 * Seed Business Profile "JustTestX" + one year of BOS scenario data.
 *
 * Safety:
 *   JUSTTESTX_CONFIRM=YES  — required
 *   --reset                — wipe existing JustTestX BOS rows then re-seed
 *   --set-password         — update password for the owner email (off by default if user exists)
 *   --dry-run              — print plan only
 *
 * Env overrides: JUSTTESTX_EMAIL, JUSTTESTX_PASSWORD, DB_* via server/.env
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import type { PoolConnection } from "mysql2/promise";
import { pool } from "../../src/db.js";
import {
  COMPANY,
  GSTIN,
  ORG_NAME,
  exec,
  findJustTestXProfile,
  fiscalYearLabel,
  parseArgs,
  q,
  requireConfirm,
  tid,
  wipeBosTenant,
  withTx,
} from "./lib.js";
import {
  BOS_SETTINGS,
  CATALOG,
  DEPARTMENTS,
  EMPLOYEES,
  HOLIDAYS,
  OWNER_EMAIL,
  OWNER_NAME,
  OWNER_PASSWORD,
  PARTIES,
  PAYROLL_CONFIG,
  PROFILE,
  TODAY,
  WINDOW_START,
  buildAccounting,
  buildAgreements,
  buildAssets,
  buildAttendance,
  buildBanking,
  buildBills,
  buildBudgets,
  buildCompliance,
  buildExpenses,
  buildInvoices,
  buildLeaves,
  buildPayroll,
  buildPerformance,
  buildPolicies,
  buildProjects,
  buildRecruitment,
  buildSalesDocs,
  buildServices,
  buildTasks,
  buildTravel,
  deptId,
  empId,
  invoiceMoney,
  itemId,
  partyId,
} from "./scenario.js";

type Counts = Record<string, number>;

async function ensureTenant(conn: PoolConnection, setPassword: boolean): Promise<{ profileId: number; orgId: number; userId: number; created: boolean }> {
  let found = await findJustTestXProfile();
  let created = false;
  let orgId: number;
  let profileId: number;

  if (found) {
    orgId = found.orgId;
    profileId = found.profileId;
    console.log(`Reusing existing profile ${COMPANY} id=${profileId} org=${orgId}`);
    await exec(
      conn,
      `UPDATE business_profiles SET
         gstin = COALESCE(gstin, :gstin), pan = COALESCE(pan, :pan),
         address_line1 = :a1, address_line2 = :a2, state = :state, state_code = :stateCode,
         phone = :phone, email = :email,
         bank_name = :bankName, bank_branch = :bankBranch, bank_account = :bankAccount,
         bank_ifsc = :bankIfsc, bank_upi = :bankUpi, terms = :terms,
         home_tool_ids = :homeToolIds
       WHERE id = :id`,
      {
        id: profileId,
        gstin: PROFILE.gstin,
        pan: PROFILE.pan,
        a1: PROFILE.addressLine1,
        a2: PROFILE.addressLine2,
        state: PROFILE.state,
        stateCode: PROFILE.stateCode,
        phone: PROFILE.phone,
        email: PROFILE.email,
        bankName: PROFILE.bankName,
        bankBranch: PROFILE.bankBranch,
        bankAccount: PROFILE.bankAccount,
        bankIfsc: PROFILE.bankIfsc,
        bankUpi: PROFILE.bankUpi,
        terms: PROFILE.terms,
        homeToolIds: JSON.stringify(PROFILE.homeToolIds),
      },
    );
    await exec(
      conn,
      `INSERT INTO business_profile_meta (business_profile_id, approval_status)
       VALUES (:id, 'approved')
       ON DUPLICATE KEY UPDATE approval_status = 'approved', archived_at = NULL`,
      { id: profileId },
    );
  } else {
    created = true;
    const orgRes = await exec(conn, `INSERT INTO organizations (name, plan_id, status) VALUES (:name, 'free', 'active')`, { name: ORG_NAME });
    orgId = orgRes.insertId;
    const gstinTaken = await q(conn, `SELECT id FROM business_profiles WHERE gstin = :g LIMIT 1`, { g: GSTIN });
    const gstin = gstinTaken[0] ? null : GSTIN;
    if (!gstin) console.warn(`GSTIN ${GSTIN} already used — creating profile without GSTIN on business_profiles`);
    const pRes = await exec(
      conn,
      `INSERT INTO business_profiles
        (organization_id, business_name, gstin, pan, address_line1, address_line2, state, state_code, phone, email,
         bank_name, bank_branch, bank_account, bank_ifsc, bank_upi, terms, home_tool_ids, is_default)
       VALUES (:orgId, :name, :gstin, :pan, :a1, :a2, :state, :stateCode, :phone, :email,
               :bankName, :bankBranch, :bankAccount, :bankIfsc, :bankUpi, :terms, :homeToolIds, 1)`,
      {
        orgId,
        name: COMPANY,
        gstin,
        pan: PROFILE.pan,
        a1: PROFILE.addressLine1,
        a2: PROFILE.addressLine2,
        state: PROFILE.state,
        stateCode: PROFILE.stateCode,
        phone: PROFILE.phone,
        email: PROFILE.email,
        bankName: PROFILE.bankName,
        bankBranch: PROFILE.bankBranch,
        bankAccount: PROFILE.bankAccount,
        bankIfsc: PROFILE.bankIfsc,
        bankUpi: PROFILE.bankUpi,
        terms: PROFILE.terms,
        homeToolIds: JSON.stringify(PROFILE.homeToolIds),
      },
    );
    profileId = pRes.insertId;
    await exec(
      conn,
      `INSERT INTO business_profile_meta (business_profile_id, approval_status)
       VALUES (:id, 'approved')
       ON DUPLICATE KEY UPDATE approval_status = 'approved', archived_at = NULL`,
      { id: profileId },
    );
    await exec(
      conn,
      `INSERT INTO subscriptions (business_profile_id, plan_id, status)
       VALUES (:id, 'free', 'active')
       ON DUPLICATE KEY UPDATE status = 'active'`,
      { id: profileId },
    );
    await exec(
      conn,
      `INSERT INTO org_subscriptions (organization_id, plan_id, status)
       SELECT :orgId, 'free', 'active' FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM org_subscriptions WHERE organization_id = :orgId)`,
      { orgId },
    );
    console.log(`Created org=${orgId} profile=${profileId}`);
  }

  // Owner user
  const hash = await bcrypt.hash(OWNER_PASSWORD, 10);
  const existing = await q(conn, `SELECT id, password_hash FROM users WHERE email = :email`, { email: OWNER_EMAIL });
  let userId: number;
  if (existing[0]) {
    userId = Number(existing[0].id);
    if (setPassword) {
      await exec(conn, `UPDATE users SET password_hash = :hash, name = :name, status = 'active' WHERE id = :id`, {
        hash,
        name: OWNER_NAME,
        id: userId,
      });
      console.log(`Updated password for existing user ${OWNER_EMAIL}`);
    } else {
      await exec(conn, `UPDATE users SET name = COALESCE(name, :name), status = 'active' WHERE id = :id`, { name: OWNER_NAME, id: userId });
      console.log(`Linked existing user ${OWNER_EMAIL} (password unchanged — pass --set-password to reset)`);
    }
  } else {
    const u = await exec(
      conn,
      `INSERT INTO users (email, password_hash, name, status) VALUES (:email, :hash, :name, 'active')`,
      { email: OWNER_EMAIL, hash, name: OWNER_NAME },
    );
    userId = u.insertId;
    console.log(`Created user ${OWNER_EMAIL}`);
  }

  await exec(
    conn,
    `INSERT INTO org_members (organization_id, user_id, role)
     VALUES (:orgId, :userId, 'owner')
     ON DUPLICATE KEY UPDATE role = 'owner'`,
    { orgId, userId },
  );
  await exec(conn, `UPDATE organizations SET owner_user_id = :userId, name = :name WHERE id = :orgId`, {
    userId,
    name: ORG_NAME,
    orgId,
  });
  await exec(
    conn,
    `INSERT IGNORE INTO branch_access (user_id, business_profile_id) VALUES (:userId, :profileId)`,
    { userId, profileId },
  );

  // Enable BOS + useful switches
  await exec(
    conn,
    `INSERT INTO tool_catalog (organization_id, tool_id, group_name, sort_order, available)
     VALUES (:orgId, 'bos', 'Utilities', 10, 1)
     ON DUPLICATE KEY UPDATE available = 1, group_name = 'Utilities'`,
    { orgId },
  );
  for (const key of ["bos.sales.pos", "bos.handoff.quotationv1", "bos.handoff.sitesurveyv1"]) {
    await exec(
      conn,
      `INSERT INTO org_feature_switches (organization_id, switch_key, enabled, updated_by)
       VALUES (:orgId, :key, 1, :userId)
       ON DUPLICATE KEY UPDATE enabled = 1, updated_by = :userId`,
      { orgId, key, userId },
    );
  }

  return { profileId, orgId, userId, created };
}

async function seedBos(conn: PoolConnection, tenantId: number, userId: number): Promise<Counts> {
  const counts: Counts = {};
  const t = tenantId;
  const bump = (k: string, n = 1) => {
    counts[k] = (counts[k] ?? 0) + n;
  };

  // Settings
  await exec(
    conn,
    `INSERT INTO bos_settings
      (tenant_id, company_name, gstin, state, state_code, address, email, phone, invoice_prefix, employee_prefix,
       fiscal_year_start, default_tax_rate, payment_terms_days, invoice_notes, weekend_days, leave_policy, auto_sync)
     VALUES
      (:t, :companyName, :gstin, :state, :stateCode, :address, :email, :phone, :invoicePrefix, :employeePrefix,
       :fiscalYearStart, :defaultTaxRate, :paymentTermsDays, :invoiceNotes, :weekendDays, :leavePolicy, :autoSync)
     ON DUPLICATE KEY UPDATE
       company_name = VALUES(company_name), gstin = VALUES(gstin), state = VALUES(state), state_code = VALUES(state_code),
       address = VALUES(address), email = VALUES(email), phone = VALUES(phone), invoice_prefix = VALUES(invoice_prefix),
       employee_prefix = VALUES(employee_prefix), leave_policy = VALUES(leave_policy), invoice_notes = VALUES(invoice_notes)`,
    { t, ...BOS_SETTINGS, leavePolicy: JSON.stringify(BOS_SETTINGS.leavePolicy) },
  );
  bump("settings");

  // Departments
  for (const d of DEPARTMENTS) {
    await exec(
      conn,
      `INSERT INTO bos_departments (id, tenant_id, name, code) VALUES (:id, :t, :name, :code)`,
      { id: deptId(d.key), t, name: d.name, code: d.code },
    );
    bump("departments");
  }

  // Employees (two passes for manager_id)
  for (const e of EMPLOYEES) {
    await exec(
      conn,
      `INSERT INTO bos_employees
        (id, tenant_id, emp_code, first_name, last_name, work_email, phone, designation, department_id,
         employment_type, status, join_date, exit_date, location, dob, ctc_annual, personal, bank, user_id)
       VALUES
        (:id, :t, :code, :first, :last, :email, :phone, :designation, :deptId,
         :type, :status, :joinDate, :exitDate, :location, :dob, :ctc, :personal, :bank, :userId)`,
      {
        id: empId(e.key),
        t,
        code: e.code,
        first: e.first,
        last: e.last,
        email: e.email,
        phone: e.phone,
        designation: e.designation,
        deptId: deptId(e.dept),
        type: e.type,
        status: e.status,
        joinDate: e.join,
        exitDate: e.exit ?? null,
        location: e.location,
        dob: e.dob,
        ctc: e.ctc,
        personal: JSON.stringify({ emergency: "Emergency contact on file", bloodGroup: "O+" }),
        bank: JSON.stringify({
          name: "HDFC Bank",
          holder: `${e.first} ${e.last}`,
          account: `XXXXXX${e.code.replace(/\D/g, "").padStart(4, "0")}`,
          ifsc: "HDFC0001234",
          branch: "Bengaluru",
        }),
        userId: e.linkOwner ? userId : null,
      },
    );
    bump("employees");
  }
  for (const e of EMPLOYEES) {
    if (!e.manager) continue;
    await exec(conn, `UPDATE bos_employees SET manager_id = :m WHERE id = :id`, { m: empId(e.manager), id: empId(e.key) });
  }
  // Department heads
  await exec(conn, `UPDATE bos_departments SET head_employee_id = :e WHERE id = :d`, { e: empId("santhosh"), d: deptId("leadership") });
  await exec(conn, `UPDATE bos_departments SET head_employee_id = :e WHERE id = :d`, { e: empId("arjun"), d: deptId("engineering") });
  await exec(conn, `UPDATE bos_departments SET head_employee_id = :e WHERE id = :d`, { e: empId("priya"), d: deptId("delivery") });
  await exec(conn, `UPDATE bos_departments SET head_employee_id = :e WHERE id = :d`, { e: empId("aditya"), d: deptId("sales") });
  await exec(conn, `UPDATE bos_departments SET head_employee_id = :e WHERE id = :d`, { e: empId("lakshmi"), d: deptId("finance") });
  await exec(conn, `UPDATE bos_departments SET head_employee_id = :e WHERE id = :d`, { e: empId("deepak"), d: deptId("people") });

  // Holidays
  for (const h of HOLIDAYS) {
    if (h.date < WINDOW_START || h.date > TODAY) continue;
    await exec(
      conn,
      `INSERT INTO bos_holidays (id, tenant_id, holiday_date, name, kind) VALUES (:id, :t, :d, :n, 'public')`,
      { id: tid(`hol:${h.date}:${h.name}`), t, d: h.date, n: h.name },
    );
    bump("holidays");
  }

  // Parties
  for (const p of PARTIES) {
    await exec(
      conn,
      `INSERT INTO bos_parties (id, tenant_id, kind, name, company, gstin, email, phone, address, city, state, notes, created_by)
       VALUES (:id, :t, :kind, :name, :company, :gstin, :email, :phone, :address, :city, :state, :notes, :userId)`,
      { id: partyId(p.key), t, ...p, notes: p.notes ?? null, userId },
    );
    bump("parties");
  }

  // Catalog
  for (const it of CATALOG) {
    await exec(
      conn,
      `INSERT INTO bos_items (id, tenant_id, name, sku, kind, hsn, unit, rate, tax_rate, active, created_by)
       VALUES (:id, :t, :name, :sku, :kind, :hsn, :unit, :rate, :tax, 1, :userId)`,
      { id: itemId(it.key), t, name: it.name, sku: it.sku, kind: it.kind, hsn: it.hsn, unit: it.unit, rate: it.rate, tax: it.tax, userId },
    );
    bump("items");
  }

  // Invoices + payments
  const invoices = buildInvoices();
  const seqMax = new Map<string, number>();
  for (const inv of invoices) {
    const { party, totals, paid, intra } = invoiceMoney(inv);
    const fy = fiscalYearLabel(inv.issue);
    const seq = Number(inv.no.split("/").pop());
    seqMax.set(fy, Math.max(seqMax.get(fy) ?? 0, seq));
    await exec(
      conn,
      `INSERT INTO bos_invoices
        (id, tenant_id, invoice_no, party_id, party_name, party_gstin, party_address, issue_date, due_date,
         status, place_of_supply, intra_state, subtotal, discount_total, tax_total, cgst, sgst, igst, grand_total,
         amount_paid, line_items, notes, source_tool, created_by, sent_at, voided_at)
       VALUES
        (:id, :t, :no, :partyId, :partyName, :gstin, :address, :issue, :due,
         :status, :place, :intra, :subtotal, :discountTotal, :taxTotal, :cgst, :sgst, :igst, :grandTotal,
         :paid, :lines, :notes, :sourceTool, :userId,
         ${inv.status === "draft" ? "NULL" : "CURRENT_TIMESTAMP"},
         ${inv.status === "void" ? "CURRENT_TIMESTAMP" : "NULL"})`,
      {
        id: inv.id,
        t,
        no: inv.no,
        partyId: partyId(inv.partyKey),
        partyName: party.name,
        gstin: party.gstin,
        address: party.address,
        issue: inv.issue,
        due: inv.due,
        status: inv.status,
        place: inv.place,
        intra: intra ? 1 : 0,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        grandTotal: totals.grandTotal,
        paid,
        lines: JSON.stringify(totals.lines),
        notes: inv.notes ?? null,
        sourceTool: inv.sourceTool ?? null,
        userId,
      },
    );
    bump("invoices");
    if (paid > 0 && inv.paidOn) {
      await exec(
        conn,
        `INSERT INTO bos_payments (id, tenant_id, invoice_id, amount, paid_on, method, reference, created_by)
         VALUES (:id, :t, :invoiceId, :amount, :paidOn, :method, :ref, :userId)`,
        {
          id: tid(`pay:${inv.key}`),
          t,
          invoiceId: inv.id,
          amount: paid,
          paidOn: inv.paidOn,
          method: inv.method ?? "bank",
          ref: `PAY-${inv.no}`,
          userId,
        },
      );
      bump("payments");
    }
  }
  for (const [fy, seq] of seqMax) {
    await exec(
      conn,
      `INSERT INTO bos_sequences (tenant_id, seq_key, period, seq_value) VALUES (:t, 'invoice', :fy, :seq)
       ON DUPLICATE KEY UPDATE seq_value = GREATEST(seq_value, :seq)`,
      { t, fy, seq },
    );
  }
  await exec(
    conn,
    `INSERT INTO bos_sequences (tenant_id, seq_key, period, seq_value) VALUES (:t, 'employee', 'all', :seq)
     ON DUPLICATE KEY UPDATE seq_value = GREATEST(seq_value, :seq)`,
    { t, seq: EMPLOYEES.length },
  );

  // Bills
  for (const b of buildBills()) {
    await exec(
      conn,
      `INSERT INTO bos_bills
        (id, tenant_id, bill_no, party_id, party_name, bill_date, due_date, category, amount, tax_amount, total, status, notes, paid_on, created_by, decided_at)
       VALUES
        (:id, :t, :billNo, :partyId, :partyName, :billDate, :dueDate, :category, :amount, :tax, :total, :status, :notes, :paidOn, :userId,
         ${b.status === "pending" ? "NULL" : "CURRENT_TIMESTAMP"})`,
      {
        id: b.id,
        t,
        billNo: b.billNo,
        partyId: partyId(b.partyKey),
        partyName: PARTIES.find((p) => p.key === b.partyKey)!.name,
        billDate: b.billDate,
        dueDate: b.dueDate,
        category: b.category,
        amount: b.amount,
        tax: b.tax,
        total: b.amount + b.tax,
        status: b.status,
        notes: b.notes ?? null,
        paidOn: b.paidOn ?? null,
        userId,
      },
    );
    bump("bills");
  }

  // Expenses
  for (const e of buildExpenses()) {
    const emp = EMPLOYEES.find((x) => x.key === e.empKey)!;
    await exec(
      conn,
      `INSERT INTO bos_expenses
        (id, tenant_id, employee_id, claimant_name, category, description, amount, spent_on, status, created_by, decided_at)
       VALUES (:id, :t, :empId, :name, :category, :description, :amount, :spentOn, :status, :userId,
         ${e.status === "submitted" ? "NULL" : "CURRENT_TIMESTAMP"})`,
      {
        id: e.id,
        t,
        empId: empId(e.empKey),
        name: `${emp.first} ${emp.last}`,
        category: e.category,
        description: e.description,
        amount: e.amount,
        spentOn: e.spentOn,
        status: e.status,
        userId,
      },
    );
    bump("expenses");
  }

  // Leave
  for (const l of buildLeaves()) {
    await exec(
      conn,
      `INSERT INTO bos_leave_requests
        (id, tenant_id, employee_id, leave_type, from_date, to_date, half_day, days, reason, status, created_by, decided_at)
       VALUES (:id, :t, :empId, :type, :from, :to, :half, :days, :reason, :status, :userId,
         ${l.status === "pending" ? "NULL" : "CURRENT_TIMESTAMP"})`,
      { id: l.id, t, empId: empId(l.empKey), type: l.type, from: l.from, to: l.to, half: l.half, days: l.days, reason: l.reason, status: l.status, userId },
    );
    bump("leaves");
  }

  // Attendance (batched)
  const attendance = buildAttendance();
  const chunk = 200;
  for (let i = 0; i < attendance.length; i += chunk) {
    const slice = attendance.slice(i, i + chunk);
    const values = slice
      .map(
        (r, idx) =>
          `(:t${i}_${idx}, :e${i}_${idx}, :d${i}_${idx}, :s${i}_${idx}, :ci${i}_${idx}, :co${i}_${idx}, 'seed')`,
      )
      .join(",");
    const params: Record<string, unknown> = {};
    slice.forEach((r, idx) => {
      params[`t${i}_${idx}`] = t;
      params[`e${i}_${idx}`] = empId(r.empKey);
      params[`d${i}_${idx}`] = r.date;
      params[`s${i}_${idx}`] = r.status;
      params[`ci${i}_${idx}`] = r.checkIn;
      params[`co${i}_${idx}`] = r.checkOut;
    });
    await exec(
      conn,
      `INSERT INTO bos_attendance (tenant_id, employee_id, work_date, status, check_in, check_out, source)
       VALUES ${values}
       ON DUPLICATE KEY UPDATE status = VALUES(status), check_in = VALUES(check_in), check_out = VALUES(check_out)`,
      params,
    );
  }
  bump("attendance", attendance.length);

  // Projects / tasks
  const projects = buildProjects();
  for (const p of projects) {
    await exec(
      conn,
      `INSERT INTO bos_projects
        (id, tenant_id, name, party_id, party_name, status, site_address, value_estimate, start_date, due_date, notes, created_by)
       VALUES (:id, :t, :name, :partyId, :partyName, :status, :site, :value, :start, :due, :notes, :userId)`,
      {
        id: p.id,
        t,
        name: p.name,
        partyId: p.partyKey ? partyId(p.partyKey) : null,
        partyName: p.partyKey ? PARTIES.find((x) => x.key === p.partyKey)!.name : null,
        status: p.status,
        site: p.site,
        value: p.value,
        start: p.start,
        due: p.due,
        notes: p.notes ?? null,
        userId,
      },
    );
    bump("projects");
  }
  const { milestones, tasks } = buildTasks(projects);
  for (const m of milestones) {
    await exec(
      conn,
      `INSERT INTO bos_project_milestones (id, tenant_id, project_id, name, due_on, status, created_by)
       VALUES (:id, :t, :projectId, :name, :due, :status, :userId)`,
      { id: m.id, t, projectId: m.projectId, name: m.name, due: m.due, status: m.status, userId },
    );
    bump("milestones");
  }
  let taskSeq = 0;
  for (const tk of tasks) {
    taskSeq += 1;
    await exec(
      conn,
      `INSERT INTO bos_project_tasks
        (id, tenant_id, task_no, project_id, title, assignee_employee_id, status, priority, start_on, due_on, created_by, created_by_name, done_at, done_by_name)
       VALUES (:id, :t, :taskNo, :projectId, :title, :assignee, :status, :priority, :start, :due, :userId, :byName,
         ${tk.status === "done" ? "CURRENT_TIMESTAMP" : "NULL"}, ${tk.status === "done" ? ":byName" : "NULL"})`,
      {
        id: tk.id,
        t,
        taskNo: tk.taskNo,
        projectId: tk.projectId,
        title: tk.title,
        assignee: empId(tk.assignee),
        status: tk.status,
        priority: tk.priority,
        start: tk.start,
        due: tk.due,
        userId,
        byName: OWNER_NAME,
      },
    );
    bump("tasks");
  }
  await exec(
    conn,
    `INSERT INTO bos_sequences (tenant_id, seq_key, period, seq_value) VALUES (:t, 'task', 'all', :seq)
     ON DUPLICATE KEY UPDATE seq_value = GREATEST(seq_value, :seq)`,
    { t, seq: taskSeq },
  );

  // Payroll
  await exec(
    conn,
    `INSERT INTO bos_payroll_settings (tenant_id, config, updated_by) VALUES (:t, :config, :userId)
     ON DUPLICATE KEY UPDATE config = VALUES(config)`,
    { t, config: JSON.stringify(PAYROLL_CONFIG), userId },
  );
  const payroll = buildPayroll();
  for (const s of payroll.structures) {
    await exec(
      conn,
      `INSERT INTO bos_salary_structures
        (tenant_id, employee_id, basic, hra, special, pf_applicable, pt_applicable, tds_monthly, pan, uan, updated_by)
       VALUES (:t, :empId, :basic, :hra, :special, :pf, :pt, :tds, :pan, :uan, :userId)
       ON DUPLICATE KEY UPDATE basic = VALUES(basic), hra = VALUES(hra), special = VALUES(special)`,
      {
        t,
        empId: empId(s.empKey),
        basic: s.basic,
        hra: s.hra,
        special: s.special,
        pf: s.pf ? 1 : 0,
        pt: s.pt ? 1 : 0,
        tds: s.tdsMonthly,
        pan: s.pan,
        uan: s.uan,
        userId,
      },
    );
    bump("salary_structures");
  }
  for (const run of payroll.runs) {
    await exec(
      conn,
      `INSERT INTO bos_payroll_runs
        (id, tenant_id, period, status, employee_count, gross_total, deduction_total, net_total, employer_total, paid_on, calculated_at, created_by, finalized_at)
       VALUES (:id, :t, :period, :status, :n, :gross, :ded, :net, :employer, :paidOn, CURRENT_TIMESTAMP, :userId,
         ${run.status === "draft" ? "NULL" : "CURRENT_TIMESTAMP"})`,
      {
        id: run.id,
        t,
        period: run.period,
        status: run.status,
        n: run.totals.employees,
        gross: run.totals.gross,
        ded: run.totals.ded,
        net: run.totals.net,
        employer: run.totals.employer,
        paidOn: run.paidOn,
        userId,
      },
    );
    bump("payroll_runs");
    for (const slip of run.slips) {
      await exec(
        conn,
        `INSERT INTO bos_payslips
          (id, tenant_id, run_id, employee_id, emp_code, employee_name, designation, department_name,
           days_in_month, paid_days, lop_days, attendance, earnings, deductions, employer, adjustments, statutory,
           gross, total_deductions, net_pay, employer_cost)
         VALUES
          (:id, :t, :runId, :empId, :empCode, :name, :designation, :dept,
           :days, :paidDays, :lop, :attendance, :earnings, :deductions, :employer, :adj, :statutory,
           :gross, :dedTotal, :net, :employerCost)`,
        {
          id: slip.id,
          t,
          runId: run.id,
          empId: empId(String(slip.empKey)),
          empCode: slip.empCode,
          name: slip.name,
          designation: slip.designation,
          dept: slip.departmentName,
          days: slip.daysInMonth,
          paidDays: slip.paidDays,
          lop: slip.lopDays,
          attendance: JSON.stringify(slip.attendance),
          earnings: JSON.stringify(slip.earnings),
          deductions: JSON.stringify(slip.deductions),
          employer: JSON.stringify(slip.employer),
          adj: JSON.stringify(slip.adjustments),
          statutory: JSON.stringify(slip.statutory),
          gross: slip.gross,
          dedTotal: slip.totalDeductions,
          net: slip.netPay,
          employerCost: slip.employerCost,
        },
      );
      bump("payslips");
    }
  }

  // Banking
  const banking = buildBanking(invoices);
  for (const a of banking.accounts) {
    await exec(
      conn,
      `INSERT INTO bos_bank_accounts
        (id, tenant_id, name, kind, bank_name, account_last4, ifsc, opening_balance, opening_date, created_by)
       VALUES (:id, :t, :name, :kind, :bankName, :last4, :ifsc, :ob, :od, :userId)`,
      {
        id: a.id,
        t,
        name: a.name,
        kind: a.kind,
        bankName: a.bankName,
        last4: a.accountLast4,
        ifsc: a.ifsc,
        ob: a.openingBalance,
        od: a.openingDate,
        userId,
      },
    );
    bump("bank_accounts");
  }
  for (const tx of banking.txns) {
    await exec(
      conn,
      `INSERT INTO bos_bank_txns
        (id, tenant_id, account_id, txn_date, description, reference, amount, statement_balance, source, status,
         match_type, match_id, category, fingerprint, created_by, reconciled_at)
       VALUES
        (:id, :t, :accountId, :date, :description, :reference, :amount, :sb, :source, :status,
         :matchType, :matchId, :category, :fp, :userId,
         ${tx.status === "unmatched" ? "NULL" : "CURRENT_TIMESTAMP"})`,
      {
        id: tx.id,
        t,
        accountId: tx.accountId,
        date: tx.date,
        description: tx.description,
        reference: tx.reference,
        amount: tx.amount,
        sb: tx.statementBalance,
        source: tx.source,
        status: tx.status,
        matchType: tx.matchType,
        matchId: tx.matchId,
        category: tx.category,
        fp: tx.fingerprint,
        userId,
      },
    );
    bump("bank_txns");
  }

  // Budgets
  const budget = buildBudgets();
  await exec(
    conn,
    `INSERT INTO bos_budgets (id, tenant_id, fy_start, name, basis, notes, created_by)
     VALUES (:id, :t, :fy, :name, :basis, :notes, :userId)`,
    { id: budget.id, t, fy: budget.fyStart, name: budget.name, basis: budget.basis, notes: budget.notes, userId },
  );
  bump("budgets");
  for (const line of budget.lines) {
    const annual = line.months.reduce((s: number, n: number) => s + n, 0);
    await exec(
      conn,
      `INSERT INTO bos_budget_lines (id, tenant_id, budget_id, kind, head_key, label, months, annual)
       VALUES (:id, :t, :budgetId, :kind, :key, :label, :months, :annual)`,
      {
        id: tid(`bline:${line.key}`),
        t,
        budgetId: budget.id,
        kind: line.kind,
        key: line.key,
        label: line.label,
        months: JSON.stringify(line.months),
        annual,
      },
    );
    bump("budget_lines");
  }

  // Assets
  for (const a of buildAssets()) {
    await exec(
      conn,
      `INSERT INTO bos_assets
        (id, tenant_id, tag, name, category, serial_no, location, department_id, employee_id, vendor_name,
         purchase_date, cost, salvage_value, method, rate, status, warranty_until, disposed_on, disposal_amount, created_by)
       VALUES
        (:id, :t, :tag, :name, :category, :serial, 'Head office', NULL, :empId, 'Compuworld',
         :purchase, :cost, 0, :method, :rate, :status, NULL, :disposedOn, :disposalAmount, :userId)`,
      {
        id: a.id,
        t,
        tag: a.tag,
        name: a.name,
        category: a.category,
        serial: a.serial,
        empId: a.emp ? empId(a.emp) : null,
        purchase: a.purchase,
        cost: a.cost,
        method: a.method,
        rate: a.rate,
        status: a.status,
        disposedOn: a.disposedOn ?? null,
        disposalAmount: a.disposalAmount ?? null,
        userId,
      },
    );
    bump("assets");
    if (a.emp && a.status === "in_use") {
      await exec(
        conn,
        `INSERT INTO bos_asset_events (id, tenant_id, asset_id, kind, event_date, employee_id, employee_name, note, created_by)
         VALUES (:id, :t, :assetId, 'assign', :date, :empId, :name, 'Seed assignment', :userId)`,
        {
          id: tid(`aev:${a.key}:assign`),
          t,
          assetId: a.id,
          date: a.purchase,
          empId: empId(a.emp),
          name: (() => {
            const e = EMPLOYEES.find((x) => x.key === a.emp)!;
            return `${e.first} ${e.last}`;
          })(),
          userId,
        },
      );
      bump("asset_events");
    }
  }
  await exec(
    conn,
    `INSERT INTO bos_sequences (tenant_id, seq_key, period, seq_value) VALUES (:t, 'asset', 'all', 7)
     ON DUPLICATE KEY UPDATE seq_value = GREATEST(seq_value, 7)`,
    { t },
  );

  // Accounting
  const acct = buildAccounting();
  await exec(
    conn,
    `INSERT INTO bos_accounting_settings (tenant_id, books_start) VALUES (:t, :bs)
     ON DUPLICATE KEY UPDATE books_start = VALUES(books_start)`,
    { t, bs: acct.settings.booksStart },
  );
  for (const a of acct.accounts) {
    await exec(
      conn,
      `INSERT INTO bos_accounts (id, tenant_id, code, name, type, system_key, created_by)
       VALUES (:id, :t, :code, :name, :type, :systemKey, :userId)`,
      { id: a.id, t, code: a.code, name: a.name, type: a.type, systemKey: a.systemKey || null, userId },
    );
    bump("accounts");
  }
  for (const j of acct.journals) {
    await exec(
      conn,
      `INSERT INTO bos_journals (id, tenant_id, journal_no, entry_date, narration, total, status, created_by)
       VALUES (:id, :t, :no, :date, :narration, :total, :status, :userId)`,
      {
        id: j.id,
        t,
        no: j.journalNo,
        date: j.date,
        narration: j.narration,
        total: j.lines.reduce((s, l) => s + l.debit, 0),
        status: j.status,
        userId,
      },
    );
    bump("journals");
    let lineNo = 0;
    for (const line of j.lines) {
      lineNo += 1;
      await exec(
        conn,
        `INSERT INTO bos_journal_lines (id, tenant_id, journal_id, line_no, account_id, debit, credit)
         VALUES (:id, :t, :jid, :lineNo, :accountId, :debit, :credit)`,
        { id: tid(`jl:${j.id}:${lineNo}`), t, jid: j.id, lineNo, accountId: line.accountId, debit: line.debit, credit: line.credit },
      );
      bump("journal_lines");
    }
  }
  await exec(
    conn,
    `INSERT INTO bos_sequences (tenant_id, seq_key, period, seq_value) VALUES (:t, 'journal', '25-26', 1)
     ON DUPLICATE KEY UPDATE seq_value = GREATEST(seq_value, 1)`,
    { t },
  );

  // Recruitment
  const rec = buildRecruitment();
  for (const o of rec.openings) {
    await exec(
      conn,
      `INSERT INTO bos_job_openings
        (id, tenant_id, title, department_id, openings, priority, status, salary_min, salary_max, target_date, opened_on, created_by)
       VALUES (:id, :t, :title, :deptId, :openings, :priority, :status, :smin, :smax, :needed, CURRENT_DATE, :userId)`,
      {
        id: o.id,
        t,
        title: o.title,
        deptId: deptId(o.dept),
        openings: o.openings,
        priority: o.priority,
        status: o.status,
        smin: o.salaryMin,
        smax: o.salaryMax,
        needed: o.neededBy,
        userId,
      },
    );
    bump("job_openings");
  }
  for (const c of rec.candidates) {
    await exec(
      conn,
      `INSERT INTO bos_candidates
        (id, tenant_id, opening_id, name, email, stage, applied_on, stage_on, offer_status, offer_ctc, created_by)
       VALUES (:id, :t, :openingId, :name, :email, :stage, :applied, :applied, :offer, :ctc, :userId)`,
      {
        id: c.id,
        t,
        openingId: c.openingId,
        name: c.name,
        email: c.email,
        stage: c.stage,
        applied: c.applied,
        offer: c.offer ?? null,
        ctc: c.offerCtc ?? null,
        userId,
      },
    );
    bump("candidates");
    await exec(
      conn,
      `INSERT INTO bos_candidate_events (id, tenant_id, candidate_id, kind, event_date, note, created_by)
       VALUES (:id, :t, :cid, 'applied', :d, 'Seed application', :userId)`,
      { id: tid(`ce:${c.key}`), t, cid: c.id, d: c.applied, userId },
    );
  }

  // Performance
  const perf = buildPerformance();
  for (const p of perf.programs) {
    await exec(
      conn,
      `INSERT INTO bos_training_programs
        (id, tenant_id, title, team, duration_days, certificate, validity_months, mandatory, created_by)
       VALUES (:id, :t, :title, :team, :days, :cert, :val, :mand, :userId)`,
      { id: p.id, t, title: p.title, team: p.team, days: p.days, cert: p.certificate, val: p.validity, mand: p.mandatory, userId },
    );
    bump("training_programs");
  }
  for (const e of perf.enrollments) {
    await exec(
      conn,
      `INSERT INTO bos_training_enrollments
        (id, tenant_id, program_id, employee_id, enrolled_on, session_date, status, completed_on, created_by)
       VALUES (:id, :t, :pid, :eid, :enrolled, :session, :status, :completed, :userId)`,
      {
        id: e.id,
        t,
        pid: tid(`train:${e.program}`),
        eid: empId(e.emp),
        enrolled: e.enrolled,
        session: e.session,
        status: e.status,
        completed: e.completed,
        userId,
      },
    );
    bump("training_enrollments");
  }
  for (const c of perf.certifications) {
    await exec(
      conn,
      `INSERT INTO bos_certifications
        (id, tenant_id, employee_id, name, issued_on, expires_on, cert_no, issuer, created_by)
       VALUES (:id, :t, :eid, :name, :issued, :expires, :no, 'JustTestX / external', :userId)`,
      { id: c.id, t, eid: empId(c.emp), name: c.name, issued: c.issued, expires: c.expires, no: c.no, userId },
    );
    bump("certifications");
  }
  for (const k of perf.kras) {
    await exec(
      conn,
      `INSERT INTO bos_kras (id, tenant_id, employee_id, title, period_start, period_end, progress, status, created_by)
       VALUES (:id, :t, :eid, :title, :start, :end, :progress, :status, :userId)`,
      { id: k.id, t, eid: empId(k.emp), title: k.title, start: k.start, end: k.end, progress: k.progress, status: k.status, userId },
    );
    bump("kras");
  }
  for (const p of perf.promotions) {
    await exec(
      conn,
      `INSERT INTO bos_promotions
        (id, tenant_id, employee_id, current_designation, current_ctc, proposed_designation, proposed_ctc, effective_date, status, created_by)
       VALUES (:id, :t, :eid, :curD, :curC, :propD, :propC, :eff, :status, :userId)`,
      {
        id: p.id,
        t,
        eid: empId(p.emp),
        curD: p.currentDesig,
        curC: p.currentCtc,
        propD: p.proposed,
        propC: p.proposedCtc,
        eff: p.effective,
        status: p.status,
        userId,
      },
    );
    bump("promotions");
  }
  for (const p of perf.pips) {
    await exec(
      conn,
      `INSERT INTO bos_pips (id, tenant_id, employee_id, reason, started_on, review_on, status, created_by)
       VALUES (:id, :t, :eid, :reason, :started, :review, :status, :userId)`,
      { id: p.id, t, eid: empId(p.emp), reason: p.reason, started: p.started, review: p.review, status: p.status, userId },
    );
    bump("pips");
  }
  for (const r of perf.recognitions) {
    await exec(
      conn,
      `INSERT INTO bos_recognitions (id, tenant_id, employee_id, category, awarded_on, note, created_by)
       VALUES (:id, :t, :eid, :category, :awarded, :note, :userId)`,
      { id: r.id, t, eid: empId(r.emp), category: r.category, awarded: r.awarded, note: r.note, userId },
    );
    bump("recognitions");
  }

  // Travel
  let trvSeq = 0;
  for (const tr of buildTravel()) {
    trvSeq += 1;
    const projectId = tr.project ? projects.find((p) => p.key === tr.project)?.id ?? null : null;
    await exec(
      conn,
      `INSERT INTO bos_travel_requests
        (id, tenant_id, request_no, employee_id, purpose, from_place, to_place, depart_on, return_on, mode,
         estimated_cost, advance, project_id, status, created_by, decided_at)
       VALUES
        (:id, :t, :no, :eid, :purpose, :from, :to, :depart, :ret, :mode,
         :cost, :advance, :projectId, :status, :userId,
         ${tr.status === "pending" ? "NULL" : "CURRENT_TIMESTAMP"})`,
      {
        id: tr.id,
        t,
        no: tr.requestNo,
        eid: empId(tr.emp),
        purpose: tr.purpose,
        from: tr.from,
        to: tr.to,
        depart: tr.depart,
        ret: tr.ret,
        mode: tr.mode,
        cost: tr.cost,
        advance: tr.advance,
        projectId,
        status: tr.status,
        userId,
      },
    );
    bump("travel");
  }
  await exec(
    conn,
    `INSERT INTO bos_sequences (tenant_id, seq_key, period, seq_value) VALUES (:t, 'travel', 'all', :seq)
     ON DUPLICATE KEY UPDATE seq_value = GREATEST(seq_value, :seq)`,
    { t, seq: trvSeq },
  );

  // Services
  let srvSeq = 0;
  let ltrSeq = 0;
  for (const s of buildServices()) {
    srvSeq += 1;
    if (s.letter) ltrSeq += 1;
    await exec(
      conn,
      `INSERT INTO bos_service_requests
        (id, tenant_id, request_no, employee_id, type, certificate_kind, subject, details, priority, status,
         letter_no, letter_on, resolved_at, created_by)
       VALUES
        (:id, :t, :no, :eid, :type, :cert, :subject, :details, :priority, :status,
         :letter, ${s.letter ? "CURRENT_DATE" : "NULL"}, ${s.status === "resolved" ? "CURRENT_TIMESTAMP" : "NULL"}, :userId)`,
      {
        id: s.id,
        t,
        no: s.requestNo,
        eid: empId(s.emp),
        type: s.type,
        cert: s.cert,
        subject: s.subject,
        details: s.details,
        priority: s.priority,
        status: s.status,
        letter: s.letter,
        userId,
      },
    );
    bump("services");
    await exec(
      conn,
      `INSERT INTO bos_service_comments (id, tenant_id, request_id, author_user_id, author_name, body, internal)
       VALUES (:id, :t, :rid, :uid, :name, :body, 0)`,
      {
        id: tid(`sc:${s.key}`),
        t,
        rid: s.id,
        uid: userId,
        name: OWNER_NAME,
        body: s.status === "open" ? "Logged via JustTestX seed — awaiting HR." : "Seed comment / resolution note.",
      },
    );
    bump("service_comments");
  }
  await exec(
    conn,
    `INSERT INTO bos_sequences (tenant_id, seq_key, period, seq_value) VALUES (:t, 'service', 'all', :seq)
     ON DUPLICATE KEY UPDATE seq_value = GREATEST(seq_value, :seq)`,
    { t, seq: srvSeq },
  );
  if (ltrSeq) {
    await exec(
      conn,
      `INSERT INTO bos_sequences (tenant_id, seq_key, period, seq_value) VALUES (:t, 'letter', 'all', :seq)
       ON DUPLICATE KEY UPDATE seq_value = GREATEST(seq_value, :seq)`,
      { t, seq: ltrSeq },
    );
  }

  // Policies + acks
  const policies = buildPolicies();
  for (const p of policies) {
    await exec(
      conn,
      `INSERT INTO bos_policies
        (id, tenant_id, title, category, summary, body, mandatory, status, version, effective_on, published_at, published_by_name, created_by)
       VALUES
        (:id, :t, :title, :category, :summary, :body, :mandatory, :status, :version, :eff,
         ${p.status === "published" ? "CURRENT_TIMESTAMP" : "NULL"}, :pub, :userId)`,
      {
        id: p.id,
        t,
        title: p.title,
        category: p.category,
        summary: p.summary,
        body: p.body,
        mandatory: p.mandatory,
        status: p.status,
        version: p.version,
        eff: p.effectiveOn,
        pub: OWNER_NAME,
        userId,
      },
    );
    bump("policies");
    if (p.status === "published") {
      for (const e of EMPLOYEES.filter((x) => x.status === "active" || x.status === "probation")) {
        // Leave a few unacked for testing
        if (e.key === "tara" || e.key === "imran") continue;
        await exec(
          conn,
          `INSERT INTO bos_policy_acks (id, tenant_id, policy_id, version, employee_id, method, user_id)
           VALUES (:id, :t, :pid, :v, :eid, 'self', :userId)`,
          { id: tid(`ack:${p.key}:${e.key}`), t, pid: p.id, v: p.version, eid: empId(e.key), userId },
        );
        bump("policy_acks");
      }
    }
  }

  for (const c of buildCompliance()) {
    await exec(
      conn,
      `INSERT INTO bos_compliance_items
        (id, tenant_id, title, area, due_on, recurrence, responsible, status, done_on, reference, created_by)
       VALUES (:id, :t, :title, :area, :due, :rec, :resp, :status, :doneOn, :ref, :userId)`,
      {
        id: c.id,
        t,
        title: c.title,
        area: c.area,
        due: c.due,
        rec: c.recurrence,
        resp: c.responsible,
        status: c.status,
        doneOn: c.doneOn ?? null,
        ref: c.reference ?? null,
        userId,
      },
    );
    bump("compliance");
  }

  let agrSeq = 0;
  for (const a of buildAgreements()) {
    agrSeq += 1;
    await exec(
      conn,
      `INSERT INTO bos_agreements
        (id, tenant_id, agreement_no, type, title, employee_id, counterparty, signed_on, starts_on, expires_on, status, created_by)
       VALUES (:id, :t, :no, :type, :title, :eid, :cp, :signed, :starts, :expires, :status, :userId)`,
      {
        id: a.id,
        t,
        no: a.agreementNo,
        type: a.type,
        title: a.title,
        eid: a.emp ? empId(a.emp) : null,
        cp: a.counterparty,
        signed: a.signed,
        starts: a.starts,
        expires: a.expires,
        status: a.status,
        userId,
      },
    );
    bump("agreements");
  }
  await exec(
    conn,
    `INSERT INTO bos_sequences (tenant_id, seq_key, period, seq_value) VALUES (:t, 'agreement', 'all', :seq)
     ON DUPLICATE KEY UPDATE seq_value = GREATEST(seq_value, :seq)`,
    { t, seq: agrSeq },
  );

  // Sales docs
  const sales = buildSalesDocs(invoices);
  const salesSeq: Record<string, number> = {};
  for (const d of sales) {
    const kindKey = d.kind === "quotation" ? "sales_quotation" : d.kind === "order" ? "sales_order" : "sales_challan";
    const fy = fiscalYearLabel(d.docDate);
    salesSeq[`${kindKey}:${fy}`] = (salesSeq[`${kindKey}:${fy}`] ?? 0) + 1;
    await exec(
      conn,
      `INSERT INTO bos_sales_docs
        (id, tenant_id, kind, doc_no, status, party_id, party_name, party_gstin, party_address, place_of_supply,
         intra_state, doc_date, valid_until, delivery_on, customer_ref, subtotal, discount_total, tax_total,
         cgst, sgst, igst, grand_total, line_items, challan_reason, dispatched_on, delivered_on, invoice_id, created_by, created_by_name)
       VALUES
        (:id, :t, :kind, :docNo, :status, :partyId, :partyName, :gstin, :address, :place,
         :intra, :docDate, :valid, :delivery, :cref, :subtotal, :discount, :tax,
         :cgst, :sgst, :igst, :grand, :lines, :reason, :disp, :deliv, :invoiceId, :userId, :byName)`,
      {
        id: d.id,
        t,
        kind: d.kind,
        docNo: d.docNo,
        status: d.status,
        partyId: partyId(d.partyKey),
        partyName: d.party.name,
        gstin: d.party.gstin,
        address: d.party.address,
        place: d.party.state,
        intra: d.intra ? 1 : 0,
        docDate: d.docDate,
        valid: d.validUntil ?? null,
        delivery: d.deliveryOn ?? null,
        cref: d.customerRef ?? null,
        subtotal: d.totals.subtotal,
        discount: d.totals.discountTotal,
        tax: d.totals.taxTotal,
        cgst: d.totals.cgst,
        sgst: d.totals.sgst,
        igst: d.totals.igst,
        grand: d.totals.grandTotal,
        lines: JSON.stringify(d.totals.lines),
        reason: d.challanReason ?? null,
        disp: d.dispatchedOn ?? null,
        deliv: d.deliveredOn ?? null,
        invoiceId: d.invoiceId ?? null,
        userId,
        byName: OWNER_NAME,
      },
    );
    bump("sales_docs");
  }
  for (const [k, seq] of Object.entries(salesSeq)) {
    const [seqKey, period] = k.split(":");
    await exec(
      conn,
      `INSERT INTO bos_sequences (tenant_id, seq_key, period, seq_value) VALUES (:t, :seqKey, :period, :seq)
       ON DUPLICATE KEY UPDATE seq_value = GREATEST(seq_value, :seq)`,
      { t, seqKey, period, seq },
    );
  }

  // Profile change pending
  await exec(
    conn,
    `INSERT INTO bos_profile_changes (id, tenant_id, employee_id, changes, status, requested_by)
     VALUES (:id, :t, :eid, :changes, 'pending', :userId)`,
    {
      id: tid("pchg:1"),
      t,
      eid: empId("vikram"),
      changes: JSON.stringify({ phone: "+91 98765 01999", location: "Mysuru" }),
      userId,
    },
  );
  bump("profile_changes");

  // Activity feed samples
  const events = [
    { type: "seed.complete", summary: "JustTestX scenario data loaded (1-year IT company pack)" },
    { type: "invoice.issued", summary: "Issued AMS invoice to Cascade Fintech" },
    { type: "payroll.finalized", summary: "Payroll finalized for previous month" },
    { type: "leave.requested", summary: "Leave request pending approval" },
  ];
  for (const ev of events) {
    await exec(
      conn,
      `INSERT INTO bos_events (tenant_id, actor_user_id, actor_name, event_type, entity_type, entity_id, summary, payload)
       VALUES (:t, :uid, :name, :type, 'seed', 'justtestx', :summary, :payload)`,
      { t, uid: userId, name: OWNER_NAME, type: ev.type, summary: ev.summary, payload: JSON.stringify({ marker: "justtestx:v1", today: TODAY }) },
    );
    bump("events");
  }

  return counts;
}

async function main() {
  const args = parseArgs();
  const dryRun = Boolean(args["dry-run"]);
  const reset = Boolean(args.reset);
  const setPassword = Boolean(args["set-password"]);

  if (dryRun) {
    console.log("Dry run — JustTestX seed plan");
    console.log({ COMPANY, OWNER_EMAIL, TODAY, WINDOW_START, employees: EMPLOYEES.length, parties: PARTIES.length, invoices: buildInvoices().length });
    await pool.end();
    return;
  }

  requireConfirm("seed JustTestX into the configured database");

  const result = await withTx(async (conn) => {
    const tenant = await ensureTenant(conn, setPassword);
    if (reset) {
      const wiped = await wipeBosTenant(conn, tenant.profileId);
      console.log(`--reset: wiped ${wiped} existing BOS row(s)`);
    } else {
      const existing = await q(conn, `SELECT tenant_id FROM bos_settings WHERE tenant_id = :t LIMIT 1`, { t: tenant.profileId });
      if (existing[0]) {
        throw new Error(
          `JustTestX already has BOS settings (tenant_id=${tenant.profileId}). Re-run with --reset to wipe & reseed, or use db:wipe:justtestx first.`,
        );
      }
    }
    const counts = await seedBos(conn, tenant.profileId, tenant.userId);
    return { ...tenant, counts };
  });

  console.log("\nJustTestX seed complete.");
  console.log(`  Profile: ${COMPANY}  id=${result.profileId}  org=${result.orgId}`);
  console.log(`  Login:   ${OWNER_EMAIL}${setPassword || result.created ? ` / ${OWNER_PASSWORD}` : " (existing password)"}`);
  console.log(`  Window:  ${WINDOW_START} → ${TODAY}`);
  console.log("  Counts:");
  for (const [k, v] of Object.entries(result.counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`    ${k.padEnd(22)} ${v}`);
  }
  console.log("\nOpen BOS: https://justxsystems.com/jbt/tools/bos  (switch to JustTestX branch)");
  console.log("Wipe later: JUSTTESTX_CONFIRM=YES npm run db:wipe:justtestx -w server -- --hard");

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});

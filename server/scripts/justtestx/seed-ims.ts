/**
 * Seed JustTestX IMS — Dealer with ≥2 years of distributor scenario data.
 *
 * Requires an existing JustTestX business profile (run BOS seed first, or create the profile).
 *
 *   JUSTTESTX_CONFIRM=YES npm run db:seed:justtestx:ims -w server -- --reset
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import type { PoolConnection } from "mysql2/promise";
import { pool } from "../../src/db.js";
import {
  COMPANY,
  enableImsDealer,
  exec,
  findJustTestXProfile,
  parseArgs,
  q,
  requireConfirm,
  wipeImsTenant,
  withTx,
} from "./lib.js";
import {
  IMS_CUSTOMERS,
  IMS_SETTINGS,
  IMS_SUPPLIERS,
  IMS_TODAY,
  IMS_WINDOW_START,
  OWNER_NAME,
  buildImsWorld,
  itemId,
  partyId,
  type FieldStaff,
} from "./ims-scenario.js";
import { OWNER_PASSWORD } from "./scenario.js";

type Counts = Record<string, number>;

const FIELD_STAFF_DEFS = [
  { email: "field.arjun@justtestx.example", name: "Arjun Field", role: "field", phone: "+91 98765 22001" },
  { email: "field.meera@justtestx.example", name: "Meera Onsite", role: "field", phone: "+91 98765 22002" },
  { email: "field.vikram@justtestx.example", name: "Vikram Route", role: "field", phone: "+91 98765 22003" },
  { email: "accounts.priya@justtestx.example", name: "Priya Accounts", role: "accountant", phone: "+91 98765 22004" },
] as const;

async function ensureFieldStaff(
  conn: PoolConnection,
  orgId: number,
  profileId: number,
  owner: FieldStaff,
): Promise<FieldStaff[]> {
  await exec(
    conn,
    `INSERT INTO ims_members (tenant_id, user_id, display_name, ims_role, is_account_manager, active)
     VALUES (:t, :userId, :name, 'owner', 1, 1)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), ims_role = 'owner', active = 1`,
    { t: profileId, userId: owner.userId, name: owner.name },
  );
  const hash = await bcrypt.hash(OWNER_PASSWORD, 10);
  const staff: FieldStaff[] = [owner];
  for (const def of FIELD_STAFF_DEFS) {
    const existing = await q(conn, `SELECT id FROM users WHERE email = :email LIMIT 1`, { email: def.email });
    let uid: number;
    if (existing[0]) {
      uid = Number(existing[0].id);
      await exec(conn, `UPDATE users SET name = :name, status = 'active' WHERE id = :id`, { name: def.name, id: uid });
    } else {
      const ins = await exec(
        conn,
        `INSERT INTO users (email, password_hash, name, status) VALUES (:email, :hash, :name, 'active')`,
        { email: def.email, hash, name: def.name },
      );
      uid = ins.insertId;
    }
    await exec(
      conn,
      `INSERT INTO org_members (organization_id, user_id, role)
       VALUES (:orgId, :userId, 'staff')
       ON DUPLICATE KEY UPDATE role = VALUES(role)`,
      { orgId, userId: uid },
    );
    await exec(conn, `INSERT IGNORE INTO branch_access (user_id, business_profile_id) VALUES (:userId, :profileId)`, {
      userId: uid,
      profileId,
    });
    await exec(
      conn,
      `INSERT INTO ims_members (tenant_id, user_id, display_name, ims_role, phone, is_account_manager, active)
       VALUES (:t, :userId, :name, :role, :phone, :am, 1)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), ims_role = VALUES(ims_role), phone = VALUES(phone), active = 1`,
      {
        t: profileId,
        userId: uid,
        name: def.name,
        role: def.role,
        phone: def.phone,
        am: def.role === "accountant" ? 1 : 0,
      },
    );
    if (def.role === "field") staff.push({ userId: uid, name: def.name });
  }
  return staff;
}

async function seedIms(
  conn: PoolConnection,
  tenantId: number,
  userId: number,
  orgId: number,
): Promise<Counts> {
  const counts: Counts = {};
  const bump = (k: string, n = 1) => {
    counts[k] = (counts[k] ?? 0) + n;
  };
  const t = tenantId;
  const byName = OWNER_NAME;

  const fieldStaff = await ensureFieldStaff(conn, orgId, tenantId, { userId, name: OWNER_NAME });
  bump("field_staff", fieldStaff.length);

  await exec(
    conn,
    `INSERT INTO ims_settings
      (tenant_id, business_name, business_type, gstin, state, state_code, address, phone, email,
       fiscal_year_start, po_prefix, invoice_prefix, bill_prefix, return_prefix, check_prefix, ticket_prefix, bom_paper_template,
       po_approval_limit, draft_po_purge_days, payment_terms_days, default_gst_rate, allow_negative_stock, excise_enabled,
       permissions, taxonomy, reminders, terms, updated_by)
     VALUES
      (:t, :businessName, :businessType, :gstin, :state, :stateCode, :address, :phone, :email,
       :fiscalYearStart, :poPrefix, :invoicePrefix, :billPrefix, :returnPrefix, :checkPrefix, :ticketPrefix, :bomPaperTemplate,
       :poApprovalLimit, :draftPoPurgeDays, :paymentTermsDays, :defaultGstRate, :allowNegativeStock, :exciseEnabled,
       :permissions, :taxonomy, :reminders, :terms, :userId)
     ON DUPLICATE KEY UPDATE
       business_name = VALUES(business_name), business_type = VALUES(business_type), taxonomy = VALUES(taxonomy),
       reminders = VALUES(reminders), permissions = VALUES(permissions), terms = VALUES(terms),
       bom_paper_template = VALUES(bom_paper_template), excise_enabled = VALUES(excise_enabled),
       allow_negative_stock = VALUES(allow_negative_stock)`,
    {
      t,
      ...IMS_SETTINGS,
      permissions: JSON.stringify(IMS_SETTINGS.permissions),
      taxonomy: JSON.stringify(IMS_SETTINGS.taxonomy),
      reminders: JSON.stringify(IMS_SETTINGS.reminders),
      userId,
    },
  );
  bump("settings");

  for (const p of [...IMS_SUPPLIERS, ...IMS_CUSTOMERS]) {
    await exec(
      conn,
      `INSERT INTO ims_parties
        (id, tenant_id, kind, name, contact_person, mobile, email, gstin, address, city, state, state_code,
         payment_terms_days, credit_limit, opening_balance, tags, notes, active, created_by)
       VALUES
        (:id, :t, :kind, :name, :contact, :mobile, :email, :gstin, :address, :city, :state, :stateCode,
         :terms, :creditLimit, 0, :tags, 'JustTestX IMS seed', 1, :userId)`,
      {
        id: partyId(p.key),
        t,
        kind: p.kind,
        name: p.name,
        contact: p.contact,
        mobile: p.mobile,
        email: p.email,
        gstin: p.gstin,
        address: `${p.city}, ${p.state}`,
        city: p.city,
        state: p.state,
        stateCode: p.stateCode,
        terms: p.terms,
        creditLimit: p.creditLimit,
        tags: p.tags,
        userId,
      },
    );
    bump("parties");
  }

  const world = buildImsWorld(userId, fieldStaff);

  const lastMoveAt = new Map<string, string>();
  const damagedQty = new Map<string, number>();
  for (const m of world.movements) {
    const iid = String(m.itemId);
    const d = String(m.date);
    if (!lastMoveAt.has(iid) || d >= (lastMoveAt.get(iid) ?? "")) lastMoveAt.set(iid, d);
    if (m.type === "DAMAGE") damagedQty.set(iid, (damagedQty.get(iid) ?? 0) + Number(m.qty));
  }

  for (const it of world.items) {
    const stock = world.finalStock.get(it.key) ?? 0;
    const iid = itemId(it.key);
    const lastAt = lastMoveAt.get(iid);
    await exec(
      conn,
      `INSERT INTO ims_items
        (id, tenant_id, name, sku, barcode, category, brand, unit, hsn, gst_rate, supplier_id,
         purchase_price, selling_price, mrp, current_stock, damaged_stock, min_stock, max_stock, reorder_qty,
         location, notes, active, last_movement_at, created_by)
       VALUES
        (:id, :t, :name, :sku, :barcode, :category, :brand, :unit, :hsn, :gst, :supplierId,
         :purchase, :sell, :mrp, :stock, :damaged, :min, :max, :reorder,
         :location, :notes, :active, :lastMove, :userId)`,
      {
        id: iid,
        t,
        name: it.name,
        sku: it.sku,
        barcode: it.barcode,
        category: it.category,
        brand: it.brand,
        unit: it.unit,
        hsn: it.hsn,
        gst: it.gst,
        supplierId: partyId(it.supplierKey),
        purchase: it.purchase,
        sell: it.sell,
        mrp: it.mrp,
        stock,
        damaged: damagedQty.get(iid) ?? 0,
        min: it.min,
        max: it.max,
        reorder: it.reorder,
        location: it.location,
        notes: it.key === "inactive" ? "Discontinued — do not reorder" : null,
        active: it.key === "inactive" ? 0 : 1,
        lastMove: lastAt ? `${lastAt} 18:00:00` : null,
        userId,
      },
    );
    bump("items");
  }

  for (const m of world.movements) {
    await exec(
      conn,
      `INSERT INTO ims_movements
        (id, tenant_id, item_id, item_name, type, qty, delta, before_qty, after_qty, unit_cost, unit_price, value,
         ref_type, ref_id, ref_no, party_id, party_name, reason, movement_date, actor_user_id, actor_name, created_at)
       VALUES
        (:id, :t, :itemId, :itemName, :type, :qty, :delta, :beforeQty, :afterQty, :unitCost, :unitPrice, :value,
         :refType, :refId, :refNo, :partyId, :partyName, :reason, :date, :userId, :byName, :createdAt)`,
      { ...m, t, userId, byName },
    );
    bump("movements");
  }
  // Re-assert stock from the scenario ledger (authoritative after all movements).
  for (const it of world.items) {
    await exec(conn, `UPDATE ims_items SET current_stock = :stock WHERE id = :id AND tenant_id = :t`, {
      stock: world.finalStock.get(it.key) ?? 0,
      id: itemId(it.key),
      t,
    });
  }

  for (const po of world.pos) {
    await exec(
      conn,
      `INSERT INTO ims_purchase_orders
        (id, tenant_id, po_no, status, supplier_id, supplier_name, supplier_snapshot, business_snapshot,
         order_date, expected_date, \`lines\`, subtotal, tax_total, grand_total, notes, bom_doc_id,
         decided_by, decided_by_name, decided_at, sent_at, received_at, created_by, created_by_name)
       VALUES
        (:id, :t, :poNo, :status, :supplierId, :supplierName, :supplierSnapshot, :businessSnapshot,
         :orderDate, :expectedDate, :lines, :subtotal, :taxTotal, :grandTotal, :notes, :bomDocId,
         :decidedBy, :byName, :decidedAt, :sentAt, :receivedAt, :userId, :byName)`,
      {
        ...po,
        t,
        bomDocId: po.bomDocId ?? null,
        supplierSnapshot: JSON.stringify(po.supplierSnapshot),
        businessSnapshot: JSON.stringify(po.businessSnapshot),
        lines: JSON.stringify(po.lines),
        decidedBy: po.decidedAt ? userId : null,
        userId,
        byName,
      },
    );
    bump("purchase_orders");
  }

  for (const b of world.bills) {
    await exec(
      conn,
      `INSERT INTO ims_bills
        (id, tenant_id, bill_no, supplier_bill_no, status, supplier_id, supplier_name, po_id, po_no,
         bill_date, due_date, \`lines\`, subtotal, tax_total, grand_total, amount_paid, hold_reason, category,
         scheduled_on, run_id, decided_by, decided_by_name, decided_at, created_by, created_by_name)
       VALUES
        (:id, :t, :billNo, :supplierBillNo, :status, :supplierId, :supplierName, :poId, :poNo,
         :billDate, :dueDate, :lines, :subtotal, :taxTotal, :grandTotal, :amountPaid, :holdReason, :category,
         :scheduledOn, :runId, :decidedBy, :byName, :decidedAt, :userId, :byName)`,
      {
        ...b,
        t,
        lines: JSON.stringify(b.lines),
        scheduledOn: b.scheduledOn ?? null,
        runId: b.runId ?? null,
        decidedBy: b.decidedAt ? userId : null,
        userId,
        byName,
      },
    );
    bump("bills");
  }

  for (const inv of world.invoices) {
    await exec(
      conn,
      `INSERT INTO ims_invoices
        (id, tenant_id, invoice_no, status, customer_id, customer_name, customer_gstin, customer_address, customer_mobile,
         place_of_supply, intra_state, invoice_date, due_date, \`lines\`, subtotal, discount_total, tax_total,
         cgst, sgst, igst, round_off, grand_total, amount_paid, pay_mode, stock_posted, disputed, dispute_reason,
         promise_date, promise_amount, source_tool, account_manager_name, notes, issued_at, cancelled_at, cancel_reason, created_by, created_by_name)
       VALUES
        (:id, :t, :invoiceNo, :status, :customerId, :customerName, :customerGstin, :customerAddress, :customerMobile,
         :placeOfSupply, :intraState, :invoiceDate, :dueDate, :lines, :subtotal, :discountTotal, :taxTotal,
         :cgst, :sgst, :igst, :roundOff, :grandTotal, :amountPaid, :payMode, :stockPosted, :disputed, :disputeReason,
         :promiseDate, :promiseAmount, :sourceTool, :accountManagerName, :notes, :issuedAt, :cancelledAt, :cancelReason, :userId, :byName)`,
      {
        ...inv,
        t,
        accountManagerName: inv.accountManagerName ?? byName,
        lines: JSON.stringify(inv.lines),
        userId,
        byName,
      },
    );
    bump("invoices");
  }

  for (const p of world.payments) {
    await exec(
      conn,
      `INSERT INTO ims_payments
        (id, tenant_id, direction, party_id, party_name, doc_type, doc_id, doc_no, amount, method, reference, paid_on, created_by, created_by_name)
       VALUES
        (:id, :t, :direction, :partyId, :partyName, :docType, :docId, :docNo, :amount, :method, :reference, :paidOn, :userId, :byName)`,
      { ...p, t, userId, byName },
    );
    bump("payments");
  }

  for (const r of world.returns) {
    await exec(
      conn,
      `INSERT INTO ims_returns
        (id, tenant_id, return_no, kind, status, party_id, party_name, return_date, \`lines\`, total, reason,
         disposition, refund_status, refund_amount, created_by, created_by_name)
       VALUES
        (:id, :t, :returnNo, :kind, :status, :partyId, :partyName, :returnDate, :lines, :total, :reason,
         :disposition, :refundStatus, :refundAmount, :userId, :byName)`,
      { ...r, t, lines: JSON.stringify(r.lines), userId, byName },
    );
    bump("returns");
  }

  for (const c of world.checks) {
    await exec(
      conn,
      `INSERT INTO ims_stock_checks
        (id, tenant_id, check_no, title, status, \`lines\`, variance_qty, variance_value, counted_by, counted_by_name, decided_by, decided_by_name, decided_at)
       VALUES
        (:id, :t, :checkNo, :title, :status, :lines, :varianceQty, :varianceValue, :userId, :countedByName, :decidedBy, :byName, :decidedAt)`,
      {
        ...c,
        t,
        lines: JSON.stringify(c.lines),
        userId,
        decidedBy: c.decidedAt ? userId : null,
        byName,
      },
    );
    bump("stock_checks");
  }

  for (const e of world.expenses) {
    await exec(
      conn,
      `INSERT INTO ims_expenses
        (id, tenant_id, expense_date, category, description, amount, gst_amount, pay_method, vendor, created_by, created_by_name)
       VALUES (:id, :t, :expenseDate, :category, :description, :amount, :gstAmount, :payMethod, :vendor, :userId, :byName)`,
      { ...e, gstAmount: e.gstAmount ?? 0, t, userId, byName },
    );
    bump("expenses");
  }

  for (const c of world.closings) {
    await exec(
      conn,
      `INSERT INTO ims_daily_closings
        (id, tenant_id, closing_date, status, opening_cash, expected_cash, counted_cash, variance, summary, closed_by, closed_by_name, closed_at)
       VALUES
        (:id, :t, :closingDate, :status, :openingCash, :expectedCash, :countedCash, :variance, :summary, :closedBy, :closedByName, :closedAt)`,
      {
        ...c,
        t,
        summary: JSON.stringify(c.summary),
        closedBy: c.closedAt ? userId : null,
      },
    );
    bump("closings");
  }

  for (const a of world.arActivity) {
    await exec(
      conn,
      `INSERT INTO ims_ar_activity
        (id, tenant_id, party_id, party_name, invoice_id, kind, channel, message, promise_date, promise_amount, status, created_by, created_by_name, created_at)
       VALUES
        (:id, :t, :partyId, :partyName, :invoiceId, :kind, :channel, :message, :promiseDate, :promiseAmount, :status, :userId, :byName, :createdAt)`,
      {
        id: a.id,
        t,
        partyId: a.partyId,
        partyName: a.partyName,
        invoiceId: a.invoiceId,
        kind: a.kind,
        channel: a.channel,
        message: a.message,
        promiseDate: a.promiseDate ?? null,
        promiseAmount: a.promiseAmount ?? null,
        status: a.status,
        userId,
        byName,
        createdAt: a.createdAt,
      },
    );
    bump("ar_activity");
  }

  for (const l of world.ledger) {
    await exec(
      conn,
      `INSERT INTO ims_ledger_entries
        (id, tenant_id, party_id, party_name, entry_type, category, amount, entry_date, ref_no, phone, due_date, settled_on, settle_method, settled_by_name, created_by, created_by_name)
       VALUES
        (:id, :t, :partyId, :partyName, :entryType, :category, :amount, :entryDate, :refNo, :phone, :dueDate, :settledOn, :settleMethod, :settledBy, :userId, :byName)`,
      {
        ...l,
        t,
        settleMethod: l.settleMethod ?? null,
        settledBy: l.settledOn ? byName : null,
        userId,
        byName,
      },
    );
    bump("ledger");
  }

  for (const r of world.payRuns) {
    await exec(
      conn,
      `INSERT INTO ims_payment_runs
        (id, tenant_id, run_no, status, run_date, method, bill_ids, bill_count, total, notes, paid_at, created_by, created_by_name)
       VALUES
        (:id, :t, :runNo, :status, :runDate, :method, :billIds, :billCount, :total, :notes, :paidAt, :userId, :byName)`,
      {
        ...r,
        t,
        billIds: JSON.stringify(r.billIds),
        paidAt: r.paidAt ?? null,
        userId,
        byName,
      },
    );
    bump("payment_runs");
  }

  for (const f of world.fieldTasks) {
    await exec(
      conn,
      `INSERT INTO ims_field_tasks
        (id, tenant_id, title, task_type, status, priority, assignee_user_id, assignee_name, party_id, party_name,
         site_address, lat, lng, due_on, amount, completed_at, created_by, created_by_name)
       VALUES
        (:id, :t, :title, :taskType, :status, :priority, :assigneeUserId, :assigneeName, :partyId, :partyName,
         :siteAddress, :lat, :lng, :dueOn, :amount, :completedAt, :userId, :byName)`,
      { ...f, t, userId, byName },
    );
    bump("field_tasks");
  }

  for (const f of world.fieldCheckins) {
    await exec(
      conn,
      `INSERT INTO ims_field_checkins
        (id, tenant_id, user_id, user_name, kind, field_status, lat, lng, accuracy_m, site_name, task_id, note, ping_date, created_at)
       VALUES
        (:id, :t, :userId, :userName, :kind, :fieldStatus, :lat, :lng, :accuracyM, :siteName, :taskId, :note, :pingDate, :createdAt)`,
      { ...f, t, createdAt: f.createdAt ?? `${f.pingDate} 12:00:00` },
    );
    bump("field_checkins");
  }

  for (const f of world.fieldVisits) {
    await exec(
      conn,
      `INSERT INTO ims_field_visits
        (id, tenant_id, user_id, user_name, visit_date, site_name, party_id, party_name, purpose, task_id, address,
         in_lat, in_lng, checked_in_at, checked_out_at, out_lat, out_lng, summary, outcome, next_visit_on)
       VALUES
        (:id, :t, :userId, :userName, :visitDate, :siteName, :partyId, :partyName, :purpose, :taskId, :address,
         :inLat, :inLng, :checkedInAt, :checkedOutAt, :outLat, :outLng, :summary, :outcome, :nextVisitOn)`,
      {
        ...f,
        t,
        checkedInAt: f.checkedInAt ?? `${f.visitDate} 09:15:00`,
      },
    );
    bump("field_visits");
  }

  for (const b of world.bankTxns) {
    await exec(
      conn,
      `INSERT INTO ims_bank_txns
        (id, tenant_id, txn_date, description, amount, direction, reference, status, matched_type, matched_id, matched_label, created_by)
       VALUES
        (:id, :t, :txnDate, :description, :amount, :direction, :reference, :status, :matchedType, :matchedId, :matchedLabel, :userId)`,
      {
        ...b,
        t,
        matchedLabel: b.matchedId ? "Seed matched payment" : null,
        userId,
      },
    );
    bump("bank_txns");
  }

  for (const a of world.audit) {
    await exec(
      conn,
      `INSERT INTO ims_audit_items
        (id, tenant_id, kind, area, title, detail, entity_type, entity_id, entity_label, severity, status, thread,
         assignee_user_id, assignee_name, amount, due_date, raised_by, raised_by_name, resolved_at)
       VALUES
        (:id, :t, :kind, :area, :title, :detail, :entityType, :entityId, :entityLabel, :severity, :status, :thread,
         :assigneeUserId, :assigneeName, :amount, :dueDate, :userId, :byName, :resolvedAt)`,
      {
        ...a,
        t,
        detail: `${a.title} — JustTestX seed`,
        entityLabel: a.entityLabel ?? null,
        thread: JSON.stringify(a.thread ?? []),
        assigneeUserId: a.assigneeUserId ?? null,
        assigneeName: a.assigneeName ?? null,
        amount: a.amount ?? null,
        dueDate: a.dueDate ?? null,
        resolvedAt: a.status === "resolved" || a.status === "dismissed" ? `${IMS_TODAY} 12:00:00` : null,
        userId,
        byName,
      },
    );
    bump("audit");
  }

  for (const tk of world.tickets) {
    await exec(
      conn,
      `INSERT INTO ims_tickets
        (id, tenant_id, ticket_no, subject, category, priority, status, description, thread,
         raised_by, raised_by_name, assigned_to, assigned_to_name, resolved_at)
       VALUES
        (:id, :t, :ticketNo, :subject, :category, :priority, :status, :description, :thread,
         :userId, :raisedByName, :assignedTo, :assignedToName, :resolvedAt)`,
      {
        ...tk,
        t,
        category: tk.category ?? "general",
        thread: JSON.stringify(tk.thread ?? []),
        assignedTo: tk.assignedTo ?? null,
        assignedToName: tk.assignedToName ?? null,
        userId,
        resolvedAt: ["resolved", "closed"].includes(String(tk.status)) ? `${IMS_TODAY} 12:00:00` : null,
      },
    );
    bump("tickets");
  }

  for (const r of world.reports) {
    await exec(
      conn,
      `INSERT INTO ims_reports
        (id, tenant_id, name, report_type, params, format, schedule, status, approval_status, approved_by, approved_by_name, approved_at, created_by, created_by_name)
       VALUES
        (:id, :t, :name, :reportType, :params, :format, :schedule, :status, :approvalStatus, :approvedBy, :byName, :approvedAt, :userId, :byName)`,
      {
        ...r,
        t,
        params: JSON.stringify({
          period: r.period ?? "custom",
          from: r.from ?? IMS_WINDOW_START,
          to: r.to ?? IMS_TODAY,
          filters: r.filters ?? {},
        }),
        approvedBy: ["approved", "sent"].includes(String(r.approvalStatus)) ? userId : null,
        approvedAt: ["approved", "sent"].includes(String(r.approvalStatus)) ? `${IMS_TODAY} 10:00:00` : null,
        userId,
        byName,
      },
    );
    bump("reports");
  }

  for (const d of world.documents) {
    await exec(
      conn,
      `INSERT INTO ims_documents
        (id, tenant_id, title, category, period, entity_type, entity_id, entity_label, notes,
         file_name, mime, size_bytes, content, uploaded_by, uploaded_by_name)
       VALUES
        (:id, :t, :title, :category, :period, :entityType, :entityId, :entityLabel, 'JustTestX vault seed',
         :fileName, :mime, :sizeBytes, :content, :userId, :byName)`,
      {
        ...d,
        t,
        period: d.period ?? null,
        entityLabel: d.entityLabel ?? null,
        fileName: d.fileName ?? null,
        mime: d.mime ?? null,
        sizeBytes: d.sizeBytes ?? null,
        content: d.content ?? null,
        userId,
        byName,
      },
    );
    bump("documents");
  }

  await exec(
    conn,
    `INSERT INTO ims_integrations (tenant_id, provider, enabled, config, sync, last_status, updated_by)
     VALUES (:t, 'tally', 1, :config, :sync, 'ok', :userId)
     ON DUPLICATE KEY UPDATE config = VALUES(config), enabled = 1, last_status = 'ok'`,
    { t, config: JSON.stringify({ host: "127.0.0.1", port: 9000, company: COMPANY }), sync: JSON.stringify({ invoices: true, parties: true, bills: true }), userId },
  );
  await exec(
    conn,
    `INSERT INTO ims_integrations (tenant_id, provider, enabled, config, sync, last_status, updated_by)
     VALUES (:t, 'pos', 1, :config, :sync, 'error', :userId)
     ON DUPLICATE KEY UPDATE config = VALUES(config), enabled = 1`,
    { t, config: JSON.stringify({ provider: "generic" }), sync: JSON.stringify({ sales: true }), userId },
  );
  bump("integrations", 2);

  for (const s of world.syncLog) {
    await exec(
      conn,
      `INSERT INTO ims_sync_log (tenant_id, provider, direction, entity, status, records, message, actor_name)
       VALUES (:t, :provider, :direction, :entity, :status, :records, :message, :actorName)`,
      { ...s, t },
    );
    bump("sync_log");
  }

  // ——— BOM submodule ———
  for (const p of world.bom.packages) {
    await exec(
      conn,
      `INSERT INTO ims_bom_packages
        (id, tenant_id, code, name, capacity_label, description, default_margin_pct, default_tax_pct, active,
         revision, effective_from, effective_to, variables_json, options_json, created_by, created_by_name)
       VALUES
        (:id, :t, :code, :name, :capacityLabel, :description, :defaultMarginPct, :defaultTaxPct, :active,
         :revision, :effectiveFrom, :effectiveTo, :variablesJson, :optionsJson, :userId, :byName)`,
      { ...p, t, userId, byName },
    );
    bump("bom_packages");
  }
  for (const l of world.bom.packageLines) {
    await exec(
      conn,
      `INSERT INTO ims_bom_package_lines
        (id, tenant_id, package_id, section, sort_no, line_kind, item_id, description, make_text, qty, unit,
         scale_by_capacity, default_rate, cost_rate, remarks, active, optional_flag, option_key, service_spare, scrap_pct)
       VALUES
        (:id, :t, :packageId, :section, :sortNo, :lineKind, :itemId, :description, :makeText, :qty, :unit,
         :scaleByCapacity, :defaultRate, :costRate, :remarks, :active, :optionalFlag, :optionKey, :serviceSpare, :scrapPct)`,
      { ...l, t },
    );
    bump("bom_package_lines");
  }
  for (const r of world.bom.rateCards) {
    await exec(
      conn,
      `INSERT INTO ims_bom_rate_cards
        (id, tenant_id, code, name, currency, valid_from, valid_to, active, notes, created_by, created_by_name)
       VALUES (:id, :t, :code, :name, :currency, :validFrom, :validTo, :active, :notes, :userId, :byName)`,
      { ...r, t, userId, byName },
    );
    bump("bom_rate_cards");
  }
  for (const l of world.bom.rateCardLines) {
    await exec(
      conn,
      `INSERT INTO ims_bom_rate_card_lines
        (id, tenant_id, rate_card_id, item_id, sku, description, unit, rate, cost_rate, sort_no, active)
       VALUES (:id, :t, :rateCardId, :itemId, :sku, :description, :unit, :rate, :costRate, :sortNo, :active)`,
      { ...l, t },
    );
    bump("bom_rate_card_lines");
  }
  for (const d of world.bom.docs) {
    await exec(
      conn,
      `INSERT INTO ims_bom_docs
        (id, tenant_id, package_id, package_name, doc_no, status, doc_date, capacity_label, title, customer_name, location,
         project_ref, quotation_ref, party_id, margin_pct, tax_pct, materials_total, margin_amount, tax_amount, grand_total,
         materials_cost, notes, prepared_by, valid_until, payment_terms, delivery_terms, warranty_terms, scope_of_supply, exclusions,
         invoice_id, invoice_convert_mode, revision, parent_doc_id, variables_json, options_json,
         proposal_token, proposal_status, proposal_sent_at, proposal_responded_at, proposal_response_note, rate_card_id,
         stock_issued_at, stock_issue_count, as_built_at, as_built_json,
         pdf_artifact_id, pdf_sha256, pdf_generated_at, created_by, created_by_name)
       VALUES
        (:id, :t, :packageId, :packageName, :docNo, :status, :docDate, :capacityLabel, :title, :customerName, :location,
         :projectRef, :quotationRef, :partyId, :marginPct, :taxPct, :materialsTotal, :marginAmount, :taxAmount, :grandTotal,
         :materialsCost, :notes, :preparedBy, :validUntil, :paymentTerms, :deliveryTerms, :warrantyTerms, :scopeOfSupply, :exclusions,
         :invoiceId, :invoiceConvertMode, :revision, :parentDocId, :variablesJson, :optionsJson,
         :proposalToken, :proposalStatus, :proposalSentAt, :proposalRespondedAt, :proposalResponseNote, :rateCardId,
         :stockIssuedAt, :stockIssueCount, :asBuiltAt, :asBuiltJson,
         :pdfArtifactId, :pdfSha256, :pdfGeneratedAt, :userId, :byName)`,
      {
        ...d,
        t,
        pdfArtifactId: d.pdfArtifactId ?? null,
        pdfSha256: d.pdfSha256 ?? null,
        pdfGeneratedAt: d.pdfGeneratedAt ?? null,
        userId,
        byName,
      },
    );
    bump("bom_docs");
  }
  for (const l of world.bom.docLines) {
    await exec(
      conn,
      `INSERT INTO ims_bom_doc_lines
        (id, tenant_id, doc_id, section, sort_no, line_kind, item_id, description, make_text, qty, unit,
         scale_by_capacity, rate, amount, cost_rate, issued_qty, remarks, optional_flag, service_spare, scrap_pct)
       VALUES
        (:id, :t, :docId, :section, :sortNo, :lineKind, :itemId, :description, :makeText, :qty, :unit,
         :scaleByCapacity, :rate, :amount, :costRate, :issuedQty, :remarks, :optionalFlag, :serviceSpare, :scrapPct)`,
      { ...l, t },
    );
    bump("bom_doc_lines");
  }
  for (const r of world.bom.revisions) {
    await exec(
      conn,
      `INSERT INTO ims_bom_revisions
        (id, tenant_id, entity_type, entity_id, revision, snapshot_json, created_by, created_by_name)
       VALUES (:id, :t, :entityType, :entityId, :revision, :snapshotJson, :userId, :byName)`,
      { ...r, t, userId, byName },
    );
    bump("bom_revisions");
  }
  for (const d of world.bom.dcs) {
    await exec(
      conn,
      `INSERT INTO ims_bom_dcs
        (id, tenant_id, bom_doc_id, doc_no, status, doc_date, ship_to, transporter, vehicle_no, notes,
         verified_by, verified_by_name, verified_at, approved_by, approved_by_name, approved_at, stock_posted,
         created_by, created_by_name)
       VALUES
        (:id, :t, :bomDocId, :docNo, :status, :docDate, :shipTo, :transporter, :vehicleNo, :notes,
         :verifiedBy, :verifiedByName, :verifiedAt, :approvedBy, :approvedByName, :approvedAt, :stockPosted,
         :userId, :byName)`,
      { ...d, t, userId, byName },
    );
    bump("bom_dcs");
  }
  for (const l of world.bom.dcLines) {
    await exec(
      conn,
      `INSERT INTO ims_bom_dc_lines
        (id, tenant_id, dc_id, bom_line_id, item_id, section, sort_no, description, make_text, qty, returned_qty, unit, remarks)
       VALUES
        (:id, :t, :dcId, :bomLineId, :itemId, :section, :sortNo, :description, :makeText, :qty, :returnedQty, :unit, :remarks)`,
      { ...l, t },
    );
    bump("bom_dc_lines");
  }
  for (const r of world.bom.dcReturns) {
    await exec(
      conn,
      `INSERT INTO ims_bom_dc_returns
        (id, tenant_id, dc_id, bom_doc_id, return_no, return_date, notes, created_by, created_by_name)
       VALUES (:id, :t, :dcId, :bomDocId, :returnNo, :returnDate, :notes, :userId, :byName)`,
      { ...r, t, userId, byName },
    );
    bump("bom_dc_returns");
  }
  for (const l of world.bom.dcReturnLines) {
    await exec(
      conn,
      `INSERT INTO ims_bom_dc_return_lines
        (id, tenant_id, return_id, dc_id, dc_line_id, bom_line_id, item_id, description, qty, unit, remarks)
       VALUES
        (:id, :t, :returnId, :dcId, :dcLineId, :bomLineId, :itemId, :description, :qty, :unit, :remarks)`,
      { ...l, t },
    );
    bump("bom_dc_return_lines");
  }
  for (const link of world.bom.invoiceDcLinks) {
    await exec(
      conn,
      `INSERT IGNORE INTO ims_invoice_dc_links (tenant_id, invoice_id, dc_id) VALUES (:t, :invoiceId, :dcId)`,
      { t, ...link },
    );
    bump("invoice_dc_links");
  }

  for (const blob of world.pdfBlobs) {
    await exec(
      conn,
      `INSERT INTO ims_bom_pdf_blobs (id, tenant_id, doc_id, sha256, pdf_base64)
       VALUES (:id, :t, :docId, :sha256, :pdfBase64)`,
      { ...blob, t },
    );
    bump("bom_pdf_blobs");
  }

  for (const e of world.excise) {
    await exec(
      conn,
      `INSERT INTO ims_excise_records
        (id, tenant_id, record_date, item_id, item_name, brand, volume_ml, opening_qty, received_qty, issued_qty, closing_qty,
         duty_rate, duty_amount, permit_no, transport_permit_no, batch_no, vendor_id, vendor_name, cases, bottles_per_case,
         permit_date, excise_category, status, notes, movement_id, created_by, created_by_name)
       VALUES
        (:id, :t, :recordDate, :itemId, :itemName, :brand, :volumeMl, :openingQty, :receivedQty, :issuedQty, :closingQty,
         :dutyRate, :dutyAmount, :permitNo, :transportPermitNo, :batchNo, :vendorId, :vendorName, :cases, :bottlesPerCase,
         :permitDate, :exciseCategory, :status, :notes, :movementId, :userId, :byName)`,
      { ...e, t, userId, byName },
    );
    bump("excise");
  }

  for (const s of world.sequences) {
    await exec(
      conn,
      `INSERT INTO ims_sequences (tenant_id, seq_key, period, seq_value) VALUES (:t, :key, :period, :value)
       ON DUPLICATE KEY UPDATE seq_value = GREATEST(seq_value, :value)`,
      { t, ...s },
    );
    bump("sequences");
  }

  // Connect / BOS cross-links (parties, items, invoices when BOS data exists)
  try {
    const bosParties = await q(
      conn,
      `SELECT id, name FROM bos_parties WHERE tenant_id = :t ORDER BY id LIMIT 12`,
      { t },
    );
    const imsPartyKeys = ["cascade", "meridian", "harbor", "bright", "spark", "netzone", "havells", "polycab", "legrand"];
    for (let i = 0; i < bosParties.length; i++) {
      const bp = bosParties[i]!;
      const key = imsPartyKeys[i % imsPartyKeys.length]!;
      await exec(
        conn,
        `INSERT IGNORE INTO ims_links (tenant_id, source_tool, source_ref, target_type, target_id)
         VALUES (:t, 'bos', :ref, 'party', :target)`,
        { t, ref: String(bp.id), target: partyId(key) },
      );
      bump("links");
    }
    const bosItems = await q(conn, `SELECT id FROM bos_items WHERE tenant_id = :t ORDER BY id LIMIT 8`, { t });
    const imsItemKeys = ["bulb9", "sw1", "cab15", "led12", "mcb16", "router", "ups1", "lan"];
    for (let i = 0; i < bosItems.length; i++) {
      await exec(
        conn,
        `INSERT IGNORE INTO ims_links (tenant_id, source_tool, source_ref, target_type, target_id)
         VALUES (:t, 'bos', :ref, 'item', :target)`,
        { t, ref: String(bosItems[i]!.id), target: itemId(imsItemKeys[i % imsItemKeys.length]!) },
      );
      bump("links");
    }
    const bosInvs = await q(conn, `SELECT id FROM bos_invoices WHERE tenant_id = :t ORDER BY id DESC LIMIT 5`, { t });
    const imsInvs = world.invoices.filter((x) => x.status === "issued").slice(-5);
    for (let i = 0; i < Math.min(bosInvs.length, imsInvs.length); i++) {
      await exec(
        conn,
        `INSERT IGNORE INTO ims_links (tenant_id, source_tool, source_ref, target_type, target_id)
         VALUES (:t, 'bos', :ref, 'invoice', :target)`,
        { t, ref: String(bosInvs[i]!.id), target: String(imsInvs[i]!.id) },
      );
      bump("links");
    }
  } catch {
    /* bos tables may be empty */
  }

  for (const ev of world.events) {
    await exec(
      conn,
      `INSERT INTO ims_events
        (tenant_id, actor_user_id, actor_name, event_type, entity_type, entity_id, summary, payload, created_at)
       VALUES
        (:t, :actorUserId, :actorName, :eventType, :entityType, :entityId, :summary, :payload, :createdAt)`,
      { ...ev, t },
    );
    bump("events");
  }

  return counts;
}

async function main() {
  const args = parseArgs();
  const dryRun = Boolean(args["dry-run"]);
  const reset = Boolean(args.reset);

  if (dryRun) {
    const world = buildImsWorld(1, [
      { userId: 1, name: OWNER_NAME },
      { userId: 2, name: "Arjun Field" },
      { userId: 3, name: "Meera Onsite" },
    ]);
    console.log("Dry run — JustTestX IMS seed plan", {
      COMPANY,
      IMS_TODAY,
      IMS_WINDOW_START,
      items: world.items.length,
      invoices: world.invoices.length,
      pos: world.pos.length,
      movements: world.movements.length,
      bills: world.bills.length,
      bomDocs: world.bom.docs.length,
      bomDcs: world.bom.dcs.length,
      bomPackages: world.bom.packages.length,
      excise: world.excise.length,
      events: world.events.length,
      pdfBlobs: world.pdfBlobs.length,
      fieldVisits: world.fieldVisits.length,
      documents: world.documents.length,
    });
    await pool.end();
    return;
  }

  requireConfirm("seed JustTestX IMS into the configured database");

  const found = await findJustTestXProfile();
  if (!found) {
    console.error(`Business profile "${COMPANY}" not found. Run: JUSTTESTX_CONFIRM=YES npm run db:seed:justtestx -w server -- --reset`);
    await pool.end();
    process.exit(1);
  }

  const owner = await q(
    pool,
    `SELECT u.id FROM users u
     JOIN org_members m ON m.user_id = u.id
     WHERE m.organization_id = :orgId AND m.role = 'owner'
     ORDER BY u.id LIMIT 1`,
    { orgId: found.orgId },
  );
  const userId = Number(owner[0]?.id ?? 0);
  if (!userId) {
    console.error("No owner user on JustTestX org");
    await pool.end();
    process.exit(1);
  }

  const result = await withTx(async (conn) => {
    if (reset) {
      const wiped = await wipeImsTenant(conn, found.profileId);
      console.log(`--reset: wiped ${wiped} existing IMS row(s)`);
    } else {
      const existing = await q(conn, `SELECT tenant_id FROM ims_settings WHERE tenant_id = :t LIMIT 1`, { t: found.profileId });
      if (existing[0]) {
        throw new Error(`JustTestX already has IMS settings. Re-run with --reset.`);
      }
    }
    await enableImsDealer(conn, found.orgId, found.profileId, userId, OWNER_NAME);
    const counts = await seedIms(conn, found.profileId, userId, found.orgId);
    return counts;
  });

  console.log("\nJustTestX IMS seed complete.");
  console.log(`  Profile: ${COMPANY}  id=${found.profileId}`);
  console.log(`  Window:  ${IMS_WINDOW_START} → ${IMS_TODAY} (≥2 years)`);
  console.log("  Counts:");
  for (const [k, v] of Object.entries(result).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`    ${k.padEnd(22)} ${v}`);
  }
  console.log("\nOpen IMS: https://justxsystems.com/jbt/tools/imsdealer");
  console.log("  → Switch active branch to JustTestX first (IMS is Live only on that org).");
  console.log("Wipe later: JUSTTESTX_CONFIRM=YES npm run db:wipe:justtestx:ims -w server");
  console.log("Enable only: JUSTTESTX_CONFIRM=YES npm run db:enable:justtestx:ims -w server");

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});

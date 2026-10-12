import type { Request, Response, Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auditAsk } from "./assistant.js";
import { loadBooks } from "./books.js";
import { Gstr2bRowSchema, loadBookBills, reconcileGstr2b } from "./gstr2b.js";
import { loadTrace, TRACE_TYPES, type TraceType } from "./trace.js";
import { accessOf, actorName, actorOf, can, isoDate, optText, parse, qint, qstr, recordEvent, requireAnyPerm, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, json, likeOf, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { ImsError, badRequest, conflict, forbidden, notFound, type ImsActor } from "./host.js";
import {
  AUDIT_AREAS,
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_AREA,
  AUDIT_ITEM_STATUSES,
  AUDIT_RULES,
  AUDIT_SEVERITIES,
  BANK_MATCH_DEFAULTS,
  IMS_ROLE_LABELS,
  addDaysISO,
  agingBucket,
  appendThread,
  auditHealth,
  autoMatchBank,
  computeTotals,
  daysBetween,
  editsAfterApproval,
  findDuplicateGroups,
  invoiceGstIssues,
  isISODate,
  isIntraState,
  normalizeBankRows,
  periodRange,
  round2,
  round3,
  scoreBankMatch,
  stockLedgerGap,
  suggestBankMatches,
  todayISO,
  type AuditCategory,
  type AuditIssue,
  type AuditSeverity,
  type BankCandidate,
  type BankTxnInput,
  type ImsLineInput,
  type ThreadEntry,
} from "./logic.js";
import { getSettings, type ImsSettings } from "./settings.js";

type Range = { from: string; to: string };

const fmtInr = (n: number) => `₹${round2(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PER_CATEGORY_LIMIT = 300;

const requireAuditView = (res: Response) => requireAnyPerm(res, ["audit", "reports"], "The auditor workspace needs the Auditor workspace or Reports permission.");
const requireAuditWrite = (res: Response) => requirePerm(res, "audit", "Only auditors (Auditor workspace permission) can change audit flags, verdicts and reconciliation.");

async function rangeOf(deps: ImsDeps, req: Request, tenantId: number, fallback = "fytd"): Promise<{ range: Range; settings: ImsSettings; today: string }> {
  const settings = await getSettings(deps, tenantId);
  const today = todayISO();
  const range = periodRange(qstr(req.query.period) || fallback, today, settings.fiscalYearStart, { from: qstr(req.query.from, 10), to: qstr(req.query.to, 10) });
  return { range, settings, today };
}

/* ---------- Rule engine: reads the books and applies the pure rules in logic.ts ---------- */

type Verdict = { id: string; status: string; kind: string; title: string };

async function verdicts(db: Queryable, tenantId: number): Promise<Map<string, Verdict>> {
  const list = await rows<{ id: string; rule_key: string; status: string; kind: string; title: string }>(
    db,
    `SELECT id, rule_key, status, kind, title FROM ims_audit_items WHERE tenant_id = :tenantId AND rule_key IS NOT NULL ORDER BY updated_at ASC`,
    { tenantId },
  );
  return new Map(list.map((v) => [v.rule_key, { id: v.id, status: v.status, kind: v.kind, title: v.title }]));
}

const severityByAmount = (amount: number): AuditSeverity => (amount >= 500_000 ? "critical" : amount >= 100_000 ? "high" : "medium");

async function detectIssues(db: Queryable, tenantId: number, range: Range, today: string, settings: ImsSettings): Promise<AuditIssue[]> {
  const out: AuditIssue[] = [];
  const push = (list: AuditIssue[]) => out.push(...list.slice(0, PER_CATEGORY_LIMIT));

  /* GST */
  const invoices = await rows<{
    id: string;
    invoice_no: string;
    invoice_date: string;
    customer_id: string | null;
    customer_name: string;
    customer_gstin: string | null;
    party_gstin: string | null;
    intra_state: number;
    lines: unknown;
    tax_total: string;
    cgst: string;
    sgst: string;
    igst: string;
    grand_total: string;
  }>(
    db,
    `SELECT i.id, i.invoice_no, i.invoice_date, i.customer_id, i.customer_name, i.customer_gstin, p.gstin AS party_gstin, i.intra_state, i.lines,
            i.tax_total, i.cgst, i.sgst, i.igst, i.grand_total
     FROM ims_invoices i LEFT JOIN ims_parties p ON p.tenant_id = i.tenant_id AND p.id = i.customer_id
     WHERE i.tenant_id = :tenantId AND i.status = 'issued' AND i.invoice_date BETWEEN :from AND :to
     ORDER BY i.invoice_date DESC LIMIT 5000`,
    { tenantId, ...range },
  );
  const gst: AuditIssue[] = [];
  for (const inv of invoices) {
    gst.push(
      ...invoiceGstIssues({
        id: inv.id,
        invoiceNo: inv.invoice_no,
        date: isoOf(inv.invoice_date),
        customerName: inv.customer_name,
        customerGstin: inv.customer_gstin,
        partyGstin: inv.party_gstin,
        intraState: Boolean(inv.intra_state),
        lines: json<ImsLineInput[]>(inv.lines, []),
        taxTotal: money(inv.tax_total),
        cgst: money(inv.cgst),
        sgst: money(inv.sgst),
        igst: money(inv.igst),
        grandTotal: money(inv.grand_total),
      }),
    );
  }
  gst.sort((a, b) => AUDIT_SEVERITIES.indexOf(b.severity) - AUDIT_SEVERITIES.indexOf(a.severity));
  push(gst);

  /* Receivables > 90 days past due */
  const arCutoff = addDaysISO(today, -AUDIT_RULES.overdueReceivableDays);
  const ar = await rows<{ id: string; invoice_no: string; customer_name: string; due_date: string; balance: string }>(
    db,
    `SELECT id, invoice_no, customer_name, due_date, grand_total - amount_paid AS balance FROM ims_invoices
     WHERE tenant_id = :tenantId AND status = 'issued' AND grand_total - amount_paid > 0.005 AND due_date < :cutoff ORDER BY due_date ASC LIMIT ${PER_CATEGORY_LIMIT}`,
    { tenantId, cutoff: arCutoff },
  );
  push(
    ar.map((r) => {
      const days = daysBetween(isoOf(r.due_date), today);
      const bal = money(r.balance);
      return {
        key: `ar:${r.id}`,
        category: "ar" as const,
        severity: severityByAmount(bal),
        title: `${r.invoice_no} unpaid ${days} days past due`,
        detail: `${r.customer_name} owes ${fmtInr(bal)} since ${isoOf(r.due_date)}. Above ${AUDIT_RULES.overdueReceivableDays} days, consider a provision for doubtful debts.`,
        entityType: "invoice",
        entityId: r.id,
        entityLabel: r.invoice_no,
        amount: round2(bal),
        date: isoOf(r.due_date),
      };
    }),
  );

  /* Payables > 30 days past due */
  const apCutoff = addDaysISO(today, -AUDIT_RULES.overduePayableDays);
  const ap = await rows<{ id: string; bill_no: string; supplier_name: string; due_date: string; balance: string; status: string }>(
    db,
    `SELECT id, bill_no, supplier_name, due_date, grand_total - amount_paid AS balance, status FROM ims_bills
     WHERE tenant_id = :tenantId AND status <> 'cancelled' AND grand_total - amount_paid > 0.005 AND due_date < :cutoff ORDER BY due_date ASC LIMIT ${PER_CATEGORY_LIMIT}`,
    { tenantId, cutoff: apCutoff },
  );
  push(
    ap.map((r) => {
      const days = daysBetween(isoOf(r.due_date), today);
      const bal = money(r.balance);
      return {
        key: `ap:${r.id}`,
        category: "ap" as const,
        severity: bal >= 100_000 ? "high" : "medium",
        title: `Bill ${r.bill_no} overdue ${days} days`,
        detail: `${fmtInr(bal)} to ${r.supplier_name} was due ${isoOf(r.due_date)}${r.status === "on_hold" ? " and is on hold" : ""}. Late payment can attract interest and MSME (43B(h)) disallowance.`,
        entityType: "bill",
        entityId: r.id,
        entityLabel: r.bill_no,
        amount: round2(bal),
        date: isoOf(r.due_date),
      };
    }),
  );

  /* Duplicates */
  const dups: AuditIssue[] = [];
  const invGroups = findDuplicateGroups(invoices.map((i) => ({ id: i.id, partyKey: i.customer_id ?? i.customer_name, amount: money(i.grand_total), date: isoOf(i.invoice_date), label: i.invoice_no, party: i.customer_name })));
  for (const g of invGroups) {
    dups.push({
      key: `dup-inv:${g.map((x) => x.id).sort().join(",").slice(0, 70)}`,
      category: "duplicates",
      severity: "high",
      title: `Possible duplicate invoices for ${g[0].party}`,
      detail: `${g.map((x) => x.label).join(", ")} have the same customer, date (${g[0].date}) and amount (${fmtInr(g[0].amount)}).`,
      entityType: "invoice",
      entityId: g[0].id,
      entityLabel: g[0].label,
      amount: round2(g[0].amount),
      date: g[0].date,
    });
  }
  const bills = await rows<{ id: string; bill_no: string; supplier_bill_no: string | null; supplier_id: string | null; supplier_name: string; bill_date: string; grand_total: string; status: string; docs: number }>(
    db,
    `SELECT b.id, b.bill_no, b.supplier_bill_no, b.supplier_id, b.supplier_name, b.bill_date, b.grand_total, b.status,
            (SELECT COUNT(*) FROM ims_documents d WHERE d.tenant_id = b.tenant_id AND d.entity_type = 'bill' AND d.entity_id = b.id) AS docs
     FROM ims_bills b WHERE b.tenant_id = :tenantId AND b.status <> 'cancelled' AND b.bill_date BETWEEN :from AND :to ORDER BY b.bill_date DESC LIMIT 5000`,
    { tenantId, ...range },
  );
  const byVendorInv = new Map<string, typeof bills>();
  for (const b of bills) {
    if (!b.supplier_bill_no?.trim()) continue;
    const k = `${(b.supplier_id ?? b.supplier_name).toLowerCase()}|${b.supplier_bill_no.trim().toLowerCase()}`;
    byVendorInv.set(k, [...(byVendorInv.get(k) ?? []), b]);
  }
  for (const g of byVendorInv.values()) {
    if (g.length < 2) continue;
    dups.push({
      key: `dup-billno:${g.map((x) => x.id).sort().join(",").slice(0, 70)}`,
      category: "duplicates",
      severity: "high",
      title: `Supplier invoice ${g[0].supplier_bill_no} booked ${g.length} times`,
      detail: `${g[0].supplier_name}'s invoice ${g[0].supplier_bill_no} appears as ${g.map((x) => x.bill_no).join(", ")} — paying both would double-pay the supplier.`,
      entityType: "bill",
      entityId: g[0].id,
      entityLabel: g[0].bill_no,
      amount: round2(money(g[0].grand_total)),
      date: isoOf(g[0].bill_date),
    });
  }
  for (const g of findDuplicateGroups(bills.map((b) => ({ id: b.id, partyKey: b.supplier_id ?? b.supplier_name, amount: money(b.grand_total), date: isoOf(b.bill_date), label: b.bill_no, party: b.supplier_name })))) {
    dups.push({
      key: `dup-bill:${g.map((x) => x.id).sort().join(",").slice(0, 70)}`,
      category: "duplicates",
      severity: "medium",
      title: `Possible duplicate bills from ${g[0].party}`,
      detail: `${g.map((x) => x.label).join(", ")} share supplier, date (${g[0].date}) and amount (${fmtInr(g[0].amount)}).`,
      entityType: "bill",
      entityId: g[0].id,
      entityLabel: g[0].label,
      amount: round2(g[0].amount),
      date: g[0].date,
    });
  }
  const payments = await rows<{ id: string; direction: string; party_id: string | null; party_name: string; amount: string; paid_on: string; method: string; doc_no: string | null }>(
    db,
    `SELECT id, direction, party_id, party_name, amount, paid_on, method, doc_no FROM ims_payments WHERE tenant_id = :tenantId AND paid_on BETWEEN :from AND :to LIMIT 10000`,
    { tenantId, ...range },
  );
  for (const g of findDuplicateGroups(payments.map((p) => ({ id: p.id, partyKey: `${p.direction}|${p.party_id ?? p.party_name}`, amount: money(p.amount), date: isoOf(p.paid_on), party: p.party_name, dir: p.direction, label: p.doc_no ?? p.method })))) {
    dups.push({
      key: `dup-pay:${g.map((x) => x.id).sort().join(",").slice(0, 70)}`,
      category: "duplicates",
      severity: "medium",
      title: `Possible duplicate ${g[0].dir === "in" ? "receipts from" : "payments to"} ${g[0].party}`,
      detail: `${g.length} entries of ${fmtInr(g[0].amount)} on ${g[0].date} (${g.map((x) => x.label).join(", ")}).`,
      entityType: "payment",
      entityId: g[0].id,
      entityLabel: g[0].party,
      amount: round2(g[0].amount),
      date: g[0].date,
    });
  }
  const expenses = await rows<{ id: string; expense_date: string; category: string; vendor: string | null; description: string | null; amount: string; pay_method: string; docs: number }>(
    db,
    `SELECT e.id, e.expense_date, e.category, e.vendor, e.description, e.amount, e.pay_method,
            (SELECT COUNT(*) FROM ims_documents d WHERE d.tenant_id = e.tenant_id AND d.entity_type = 'expense' AND d.entity_id = e.id) AS docs
     FROM ims_expenses e WHERE e.tenant_id = :tenantId AND e.expense_date BETWEEN :from AND :to LIMIT 10000`,
    { tenantId, ...range },
  ).catch(() => []);
  for (const g of findDuplicateGroups(expenses.map((e) => ({ id: e.id, partyKey: `${e.vendor ?? ""}|${e.category}`, amount: money(e.amount), date: isoOf(e.expense_date), label: e.description ?? e.category })))) {
    dups.push({
      key: `dup-exp:${g.map((x) => x.id).sort().join(",").slice(0, 70)}`,
      category: "duplicates",
      severity: "low",
      title: `Possible duplicate expense: ${g[0].label}`,
      detail: `${g.length} expenses of ${fmtInr(g[0].amount)} on ${g[0].date} in the same category / vendor.`,
      entityType: "expense",
      entityId: g[0].id,
      entityLabel: g[0].label,
      amount: round2(g[0].amount),
      date: g[0].date,
    });
  }
  push(dups);

  /* Missing documents */
  const docs: AuditIssue[] = [];
  for (const b of bills) {
    if (Number(b.docs) > 0) continue;
    const amount = money(b.grand_total);
    docs.push({
      key: `doc-bill:${b.id}`,
      category: "documents",
      severity: amount >= 50_000 ? "medium" : "low",
      title: `No supplier invoice attached to ${b.bill_no}`,
      detail: `${b.supplier_name} · ${fmtInr(amount)} on ${isoOf(b.bill_date)}. Input tax credit needs the supplier's tax invoice on file.`,
      entityType: "bill",
      entityId: b.id,
      entityLabel: b.bill_no,
      amount: round2(amount),
      date: isoOf(b.bill_date),
    });
  }
  for (const e of expenses) {
    const amount = money(e.amount);
    if (Number(e.docs) > 0 || amount < AUDIT_RULES.largeWriteOffValue) continue;
    docs.push({
      key: `doc-exp:${e.id}`,
      category: "documents",
      severity: "low",
      title: `No voucher for ${e.category} expense`,
      detail: `${e.description ?? e.category}${e.vendor ? ` · ${e.vendor}` : ""} · ${fmtInr(amount)} on ${isoOf(e.expense_date)} has no supporting bill.`,
      entityType: "expense",
      entityId: e.id,
      entityLabel: e.description ?? e.category,
      amount: round2(amount),
      date: isoOf(e.expense_date),
    });
  }
  push(docs);

  /* Stock: negative or the ledger disagrees with the item */
  const stock = await rows<{ id: string; name: string; unit: string; current_stock: string; damaged_stock: string; mov: string | null; n: number }>(
    db,
    `SELECT i.id, i.name, i.unit, i.current_stock, i.damaged_stock, SUM(m.delta) AS mov, COUNT(m.id) AS n
     FROM ims_items i LEFT JOIN ims_movements m ON m.tenant_id = i.tenant_id AND m.item_id = i.id
     WHERE i.tenant_id = :tenantId GROUP BY i.id, i.name, i.unit, i.current_stock, i.damaged_stock
     HAVING i.current_stock < 0 OR i.damaged_stock < 0 OR ABS(i.current_stock - COALESCE(SUM(m.delta), 0)) > 0.0005
     LIMIT ${PER_CATEGORY_LIMIT}`,
    { tenantId },
  );
  push(
    stock.map((s) => {
      const cur = round3(money(s.current_stock));
      const gap = stockLedgerGap(cur, money(s.mov));
      const negative = cur < 0 || money(s.damaged_stock) < 0;
      return {
        key: `stock:${s.id}`,
        category: "stock" as const,
        severity: negative ? ("high" as const) : ("medium" as const),
        title: negative ? `${s.name} is below zero` : `${s.name}: stock doesn't match its ledger`,
        detail: negative
          ? `${cur} ${s.unit} on hand — goods were issued before being received or a count wasn't posted.`
          : `Item shows ${cur} ${s.unit}, but its ${Number(s.n)} movements add up to ${round3(money(s.mov))} (gap ${gap}). Someone changed stock outside the ledger.`,
        entityType: "item",
        entityId: s.id,
        entityLabel: s.name,
        amount: null,
        date: null,
      };
    }),
  );

  /* Unusual entries */
  const unusual: AuditIssue[] = [];
  const moves = await rows<{ id: string; item_id: string; item_name: string; type: string; qty: string; delta: string; value: string; reason: string | null; movement_date: string; created_at: string; actor_name: string | null; ref_type: string }>(
    db,
    `SELECT id, item_id, item_name, type, qty, delta, value, reason, movement_date, created_at, actor_name, ref_type FROM ims_movements
     WHERE tenant_id = :tenantId AND movement_date BETWEEN :from AND :to
       AND ((type = 'ADJUSTMENT' AND (value >= :adj OR reason IS NULL OR reason = '')) OR (type = 'WRITE_OFF' AND value >= :wo) OR movement_date < DATE_SUB(DATE(created_at), INTERVAL 7 DAY))
     ORDER BY value DESC LIMIT ${PER_CATEGORY_LIMIT}`,
    { tenantId, ...range, adj: AUDIT_RULES.largeAdjustmentValue, wo: AUDIT_RULES.largeWriteOffValue },
  );
  for (const m of moves) {
    const value = money(m.value);
    const date = isoOf(m.movement_date);
    const created = isoOf(m.created_at);
    const base = { category: "unusual" as const, entityType: "item", entityId: m.item_id, entityLabel: m.item_name, amount: round2(value), date };
    if (m.type === "ADJUSTMENT" && value >= AUDIT_RULES.largeAdjustmentValue) {
      unusual.push({ ...base, key: `unusual-adj:${m.id}`, severity: "high", title: `Large stock adjustment on ${m.item_name}`, detail: `${round3(money(m.delta))} units (${fmtInr(value)}) adjusted on ${date} by ${m.actor_name ?? "someone"}${m.reason ? ` — “${m.reason}”` : " with no reason"}.` });
    } else if (m.type === "ADJUSTMENT") {
      unusual.push({ ...base, key: `unusual-noreason:${m.id}`, severity: "low", title: `Stock adjustment without a reason`, detail: `${m.item_name}: ${round3(money(m.delta))} units on ${date} by ${m.actor_name ?? "someone"}. Ask for the reason and evidence.` });
    } else if (m.type === "WRITE_OFF") {
      unusual.push({ ...base, key: `unusual-wo:${m.id}`, severity: "medium", title: `Large write-off of ${m.item_name}`, detail: `${round3(money(m.qty))} units (${fmtInr(value)}) written off on ${date}${m.reason ? ` — “${m.reason}”` : ""}.` });
    }
    if (created && date && daysBetween(date, created) > 7) {
      unusual.push({ ...base, key: `unusual-backdated:${m.id}`, severity: "low", title: `Back-dated stock entry`, detail: `${m.item_name}: a ${m.type.toLowerCase().replace("_", " ")} dated ${date} was entered on ${created} (${daysBetween(date, created)} days later).` });
    }
  }
  const cash = await rows<{ party: string; paid_on: string; total: string }>(
    db,
    `SELECT COALESCE(party_id, party_name) AS party_key, MAX(party_name) AS party, paid_on, SUM(amount) AS total FROM ims_payments
     WHERE tenant_id = :tenantId AND direction = 'in' AND method = 'cash' AND paid_on BETWEEN :from AND :to
     GROUP BY party_key, paid_on HAVING SUM(amount) >= 200000 LIMIT 100`,
    { tenantId, ...range },
  );
  for (const c of cash) {
    unusual.push({
      key: `unusual-cash:${c.party}:${isoOf(c.paid_on)}`.slice(0, 80),
      category: "unusual",
      severity: "high",
      title: `Cash receipt of ${fmtInr(money(c.total))} in a day`,
      detail: `${c.party} paid ${fmtInr(money(c.total))} in cash on ${isoOf(c.paid_on)}. Receipts of ₹2 lakh or more in cash from one person in a day breach section 269ST.`,
      entityType: "party",
      entityId: "",
      entityLabel: c.party,
      amount: round2(money(c.total)),
      date: isoOf(c.paid_on),
    });
  }
  push(unusual);

  /* Modified after approval */
  const approved = await rows<{ id: string; no: string; kind: string; party: string; decided_at: string; amount: string }>(
    db,
    `SELECT id, bill_no AS no, 'bill' AS kind, supplier_name AS party, decided_at, grand_total AS amount FROM ims_bills
       WHERE tenant_id = :tenantId AND decided_at IS NOT NULL AND status IN ('approved', 'scheduled') AND decided_at >= :since
     UNION ALL
     SELECT id, po_no AS no, 'po' AS kind, supplier_name AS party, decided_at, grand_total AS amount FROM ims_purchase_orders
       WHERE tenant_id = :tenantId AND decided_at IS NOT NULL AND status IN ('approved', 'sent', 'partially_received', 'received') AND decided_at >= :since
     LIMIT 3000`,
    { tenantId, since: `${addDaysISO(range.from, -30)} 00:00:00` },
  );
  if (approved.length) {
    const ev = await rows<{ entity_id: string; event_type: string; created_at: string; actor_name: string | null; summary: string }>(
      db,
      `SELECT entity_id, event_type, created_at, actor_name, summary FROM ims_events
       WHERE tenant_id = :tenantId AND entity_id IN (:ids) AND entity_type IN ('bill', 'po', 'purchase_order', 'purchase') ORDER BY id`,
      { tenantId, ids: approved.map((a) => a.id) },
    );
    const byEntity = new Map<string, Array<{ type: string; at: string; actor: string | null; summary: string }>>();
    for (const e of ev) byEntity.set(e.entity_id, [...(byEntity.get(e.entity_id) ?? []), { type: e.event_type, at: String(tsOf(e.created_at) ?? ""), actor: e.actor_name, summary: e.summary }]);
    const changed: AuditIssue[] = [];
    for (const a of approved) {
      const edits = editsAfterApproval(tsOf(a.decided_at), byEntity.get(a.id) ?? []);
      if (!edits.length) continue;
      const last = edits[edits.length - 1];
      changed.push({
        key: `changed:${a.id}`,
        category: "changed",
        severity: "high",
        title: `${a.kind === "po" ? "PO" : "Bill"} ${a.no} edited after approval`,
        detail: `Approved ${String(tsOf(a.decided_at)).slice(0, 16).replace("T", " ")}, then changed ${edits.length} time${edits.length === 1 ? "" : "s"} — last by ${last.actor ?? "someone"}: “${last.summary}”.`,
        entityType: a.kind,
        entityId: a.id,
        entityLabel: a.no,
        amount: round2(money(a.amount)),
        date: String(tsOf(a.decided_at)).slice(0, 10),
      });
    }
    push(changed);
  }

  /* Tally */
  const tally = await one<{ enabled: number; last_sync_at: string | null; last_status: string | null }>(db, `SELECT enabled, last_sync_at, last_status FROM ims_integrations WHERE tenant_id = :tenantId AND provider = 'tally'`, { tenantId });
  if (tally?.enabled) {
    const failed = await rows<{ id: number; entity: string; status: string; message: string | null; created_at: string; records: number }>(
      db,
      `SELECT l.id, l.entity, l.status, l.message, l.created_at, l.records FROM ims_sync_log l
       JOIN (SELECT entity, MAX(id) AS id FROM ims_sync_log WHERE tenant_id = :tenantId AND provider = 'tally' AND entity IN ('masters', 'sales', 'purchases') GROUP BY entity) last ON last.id = l.id
       WHERE l.status <> 'success'`,
      { tenantId },
    );
    push(
      failed.map((f) => ({
        key: `tally:${f.entity}:${f.id}`,
        category: "tally" as const,
        severity: f.status === "failed" ? ("high" as const) : ("medium" as const),
        title: `Tally ${f.entity} sync ${f.status === "failed" ? "failed" : "partly rejected"}`,
        detail: `${String(tsOf(f.created_at)).slice(0, 16).replace("T", " ")}: ${f.message ?? "no details"}. Until it's fixed, Tally's books won't match IMS.`,
        entityType: "integration",
        entityId: "tally",
        entityLabel: `Tally ${f.entity}`,
        amount: null,
        date: isoOf(f.created_at),
      })),
    );
    const since = tally.last_sync_at ? String(tally.last_sync_at) : "1970-01-01 00:00:00";
    const unsynced = await one<{ n: number; v: string }>(
      db,
      `SELECT COUNT(*) AS n, COALESCE(SUM(grand_total), 0) AS v FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND updated_at > :since AND invoice_date <= :weekAgo`,
      { tenantId, since, weekAgo: addDaysISO(today, -7) },
    );
    if (Number(unsynced?.n) > 0) {
      out.push({
        key: `tally-unsynced:${String(tally.last_sync_at ?? "never").slice(0, 19)}`,
        category: "tally",
        severity: "medium",
        title: `${Number(unsynced?.n)} invoices older than a week aren't in Tally`,
        detail: `${fmtInr(money(unsynced?.v))} of sales changed since the last Tally sync (${tally.last_sync_at ? String(tally.last_sync_at).slice(0, 16) : "never synced"}). Run Sync now or export the XML.`,
        entityType: "integration",
        entityId: "tally",
        entityLabel: "Tally sales",
        amount: round2(money(unsynced?.v)),
        date: null,
      });
    }
  }

  /* Bank lines still unmatched after a week */
  const bank = await rows<{ id: string; txn_date: string; description: string; amount: string; direction: string }>(
    db,
    `SELECT id, txn_date, description, amount, direction FROM ims_bank_txns WHERE tenant_id = :tenantId AND status = 'unmatched' AND txn_date <= :cutoff ORDER BY amount DESC LIMIT ${PER_CATEGORY_LIMIT}`,
    { tenantId, cutoff: addDaysISO(today, -AUDIT_RULES.unreconciledAfterDays) },
  );
  push(
    bank.map((b) => ({
      key: `bank:${b.id}`,
      category: "bank" as const,
      severity: money(b.amount) >= 50_000 ? ("high" as const) : ("medium" as const),
      title: `Unmatched ${b.direction === "in" ? "credit" : "debit"} of ${fmtInr(money(b.amount))}`,
      detail: `${isoOf(b.txn_date)} · “${b.description}” has no matching receipt, payment or expense in IMS.`,
      entityType: "bank",
      entityId: b.id,
      entityLabel: b.description.slice(0, 120),
      amount: round2(money(b.amount)),
      date: isoOf(b.txn_date),
    })),
  );

  void settings;
  return out;
}

type IssueView = AuditIssue & { verdict: { id: string; status: string; kind: string } | null; open: boolean };

async function issuesWithVerdicts(db: Queryable, tenantId: number, range: Range, today: string, settings: ImsSettings): Promise<IssueView[]> {
  const [issues, v] = await Promise.all([detectIssues(db, tenantId, range, today, settings), verdicts(db, tenantId)]);
  return issues.map((i) => {
    const verdict = v.get(i.key) ?? null;
    return { ...i, verdict: verdict ? { id: verdict.id, status: verdict.status, kind: verdict.kind } : null, open: !verdict || verdict.status === "open" || verdict.status === "responded" };
  });
}

function categorySummary(issues: ReadonlyArray<IssueView>) {
  return AUDIT_CATEGORIES.map((c) => {
    const list = issues.filter((i) => i.category === c.key);
    const open = list.filter((i) => i.open);
    const worst = open.reduce<AuditSeverity | null>((w, i) => (!w || AUDIT_SEVERITIES.indexOf(i.severity) > AUDIT_SEVERITIES.indexOf(w) ? i.severity : w), null);
    return { key: c.key, label: c.label, icon: c.icon, fix: c.fix, open: open.length, total: list.length, amount: round2(open.reduce((s, i) => s + (i.amount ?? 0), 0)), worst };
  });
}

/* ---------- Flags & queries ---------- */

type AuditItemRow = {
  id: string;
  kind: string;
  area: string;
  title: string;
  detail: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  severity: string;
  status: string;
  thread: unknown;
  raised_by: number | null;
  raised_by_name: string | null;
  assignee_user_id: number | null;
  assignee_name: string | null;
  rule_key: string | null;
  amount: string | null;
  due_date: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

const mapItem = (r: AuditItemRow) => {
  const thread = json<ThreadEntry[]>(r.thread, []);
  return {
    id: r.id,
    kind: r.kind,
    area: r.area,
    title: r.title,
    detail: r.detail,
    entityType: r.entity_type,
    entityId: r.entity_id,
    entityLabel: r.entity_label,
    severity: r.severity,
    status: r.status,
    thread,
    replies: thread.filter((t) => t.role !== "system").length,
    raisedBy: r.raised_by === null ? null : Number(r.raised_by),
    raisedByName: r.raised_by_name,
    assigneeUserId: r.assignee_user_id === null ? null : Number(r.assignee_user_id),
    assigneeName: r.assignee_name,
    ruleKey: r.rule_key,
    amount: r.amount === null ? null : round2(money(r.amount)),
    dueDate: r.due_date ? isoOf(r.due_date) : null,
    resolvedAt: tsOf(r.resolved_at),
    createdAt: tsOf(r.created_at),
    updatedAt: tsOf(r.updated_at),
  };
};

async function loadItem(db: Queryable, tenantId: number, id: string): Promise<AuditItemRow> {
  const row = await one<AuditItemRow>(db, `SELECT * FROM ims_audit_items WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id });
  if (!row) throw notFound("Audit item");
  return row;
}

const entry = (actor: ImsActor, res: Response, text: string, system = false): ThreadEntry => ({
  id: randomUUID(),
  authorId: actor.userId,
  author: actorName(actor) ?? "Someone",
  role: system ? "system" : (IMS_ROLE_LABELS[accessOf(res).role] ?? null),
  at: new Date().toISOString(),
  text,
});

const ItemInput = z.object({
  kind: z.enum(["flag", "query"]),
  area: z.enum(AUDIT_AREAS).default("other"),
  title: z.string().trim().min(3, "Add a title").max(255),
  detail: optText(8000),
  severity: z.enum(AUDIT_SEVERITIES).default("medium"),
  entityType: optText(16),
  entityId: optText(36),
  entityLabel: optText(120),
  ruleKey: optText(80),
  amount: z.coerce.number().min(0).max(1e12).nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  assigneeUserId: z.number().int().positive().nullable().optional(),
  assigneeName: optText(120),
});

const ItemPatch = z.object({
  status: z.enum(AUDIT_ITEM_STATUSES).optional(),
  severity: z.enum(AUDIT_SEVERITIES).optional(),
  title: z.string().trim().min(3).max(255).optional(),
  detail: optText(8000),
  dueDate: isoDate.nullable().optional(),
  assigneeUserId: z.number().int().positive().nullable().optional(),
  assigneeName: optText(120),
  note: optText(2000),
});

async function insertItem(db: Queryable, actor: ImsActor, res: Response, input: z.infer<typeof ItemInput> & { status?: string }, firstNote?: string | null): Promise<string> {
  const id = randomUUID();
  const thread = firstNote ? [entry(actor, res, firstNote)] : [];
  await exec(
    db,
    `INSERT INTO ims_audit_items (id, tenant_id, kind, area, title, detail, entity_type, entity_id, entity_label, severity, status, thread, raised_by, raised_by_name,
       assignee_user_id, assignee_name, rule_key, amount, due_date, resolved_at)
     VALUES (:id, :tenantId, :kind, :area, :title, :detail, :entityType, :entityId, :entityLabel, :severity, :status, :thread, :userId, :userName,
       :assigneeUserId, :assigneeName, :ruleKey, :amount, :dueDate, IF(:status IN ('resolved', 'dismissed'), CURRENT_TIMESTAMP, NULL))`,
    {
      id,
      tenantId: actor.tenantId,
      kind: input.kind,
      area: input.area,
      title: input.title,
      detail: input.detail ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId || null,
      entityLabel: input.entityLabel ?? null,
      severity: input.severity,
      status: input.status ?? "open",
      thread: JSON.stringify(thread),
      userId: actor.userId,
      userName: actorName(actor),
      assigneeUserId: input.assigneeUserId ?? null,
      assigneeName: input.assigneeUserId ? (input.assigneeName ?? null) : null,
      ruleKey: input.ruleKey ?? null,
      amount: input.amount ?? null,
      dueDate: input.dueDate ?? null,
    },
  );
  return id;
}

/* ---------- Bank reconciliation ---------- */

type BankRow = {
  id: string;
  txn_date: string;
  description: string;
  amount: string;
  direction: "in" | "out";
  reference: string | null;
  status: string;
  matched_type: string | null;
  matched_id: string | null;
  matched_label: string | null;
  match_score: number | null;
  matched_by: string | null;
  batch_id: string | null;
  created_at: string;
};

const bankInput = (r: BankRow): BankTxnInput & { id: string } => ({ id: r.id, date: isoOf(r.txn_date), description: r.description, amount: money(r.amount), direction: r.direction, reference: r.reference });

/** Receipts / payments / expenses in the window that no other statement line has claimed. */
async function bankCandidates(db: Queryable, tenantId: number, from: string, to: string, excludeTxnId?: string): Promise<BankCandidate[]> {
  const used = await rows<{ matched_type: string; matched_id: string }>(
    db,
    `SELECT matched_type, matched_id FROM ims_bank_txns WHERE tenant_id = :tenantId AND status = 'matched' AND matched_id IS NOT NULL ${excludeTxnId ? "AND id <> :excludeTxnId" : ""}`,
    { tenantId, excludeTxnId: excludeTxnId ?? null },
  );
  const taken = new Set(used.map((u) => `${u.matched_type}:${u.matched_id}`));
  const pays = await rows<{ id: string; direction: "in" | "out"; party_name: string; doc_no: string | null; amount: string; method: string; reference: string | null; paid_on: string }>(
    db,
    `SELECT id, direction, party_name, doc_no, amount, method, reference, paid_on FROM ims_payments WHERE tenant_id = :tenantId AND paid_on BETWEEN :from AND :to AND method <> 'cash' LIMIT 20000`,
    { tenantId, from, to },
  );
  const exps = await rows<{ id: string; category: string; vendor: string | null; description: string | null; amount: string; reference: string | null; expense_date: string }>(
    db,
    `SELECT id, category, vendor, description, amount, reference, expense_date FROM ims_expenses WHERE tenant_id = :tenantId AND expense_date BETWEEN :from AND :to AND pay_method <> 'cash' LIMIT 20000`,
    { tenantId, from, to },
  ).catch(() => []);
  const out: BankCandidate[] = [];
  for (const p of pays) {
    if (taken.has(`payment:${p.id}`)) continue;
    out.push({
      id: p.id,
      type: "payment",
      direction: p.direction,
      amount: money(p.amount),
      date: isoOf(p.paid_on),
      label: `${p.direction === "in" ? "Receipt from" : "Payment to"} ${p.party_name}${p.doc_no ? ` · ${p.doc_no}` : ""} (${p.method})`,
      reference: p.reference,
      partyName: p.party_name,
    });
  }
  for (const e of exps) {
    if (taken.has(`expense:${e.id}`)) continue;
    out.push({ id: e.id, type: "expense", direction: "out", amount: money(e.amount), date: isoOf(e.expense_date), label: `Expense · ${e.category}${e.vendor ? ` · ${e.vendor}` : ""}${e.description ? ` — ${e.description}` : ""}`, reference: e.reference, partyName: e.vendor });
  }
  return out;
}

async function applyMatch(db: Queryable, tenantId: number, txnId: string, c: { type: string; id: string; label: string }, score: number | null, by: string | null) {
  await exec(
    db,
    `UPDATE ims_bank_txns SET status = 'matched', matched_type = :type, matched_id = :mid, matched_label = :label, match_score = :score, matched_by = :by
     WHERE tenant_id = :tenantId AND id = :id`,
    { tenantId, id: txnId, type: c.type, mid: c.id, label: c.label.slice(0, 200), score, by },
  );
}

async function runAutoMatch(db: Queryable, tenantId: number, by: string | null): Promise<number> {
  const open = await rows<BankRow>(db, `SELECT * FROM ims_bank_txns WHERE tenant_id = :tenantId AND status = 'unmatched' ORDER BY txn_date LIMIT 5000`, { tenantId });
  if (!open.length) return 0;
  const dates = open.map((o) => isoOf(o.txn_date)).sort();
  const pad = BANK_MATCH_DEFAULTS.windowDays + 1;
  const candidates = await bankCandidates(db, tenantId, addDaysISO(dates[0], -pad), addDaysISO(dates[dates.length - 1], pad));
  const byKey = new Map(candidates.map((c) => [`${c.type}:${c.id}`, c]));
  const matches = autoMatchBank(open.map(bankInput), candidates);
  for (const m of matches) {
    const c = byKey.get(`${m.type}:${m.candidateId}`);
    if (c) await applyMatch(db, tenantId, m.txnId, c, m.score, by ? `Auto-match (${by})` : "Auto-match");
  }
  return matches.length;
}

/* ---------- Documents ---------- */

const DOC_CATEGORIES = ["invoice", "bill", "bank_statement", "gst_return", "tds", "agreement", "ledger", "payroll", "other"] as const;
const DOC_ENTITY_TYPES = ["invoice", "bill", "payment", "expense", "party", "item", "bank", "audit", "po"] as const;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const DocInput = z
  .object({
    title: z.string().trim().min(2, "Add a title").max(200),
    category: z.enum(DOC_CATEGORIES).default("other"),
    period: optText(20),
    url: z.string().trim().url("Enter a full link (https://…)").max(1000).refine((u) => /^https?:\/\//i.test(u), "Links must start with http:// or https://").nullable().optional(),
    content: z.string().max(3_000_000).nullable().optional(),
    fileName: optText(200),
    notes: optText(500),
    entityType: z.enum(DOC_ENTITY_TYPES).nullable().optional(),
    entityId: optText(36),
    entityLabel: optText(120),
  })
  .refine((d) => Boolean(d.url) !== Boolean(d.content), "Attach a file or paste a link (one of the two)");

type DocRow = {
  id: string;
  title: string;
  category: string;
  period: string | null;
  url: string | null;
  notes: string | null;
  file_name: string | null;
  mime: string | null;
  size_bytes: number | null;
  has_file: number;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  created_at: string;
};

const DOC_SELECT = `SELECT id, title, category, period, url, notes, file_name, mime, size_bytes, content IS NOT NULL AS has_file, entity_type, entity_id, entity_label, uploaded_by, uploaded_by_name, created_at FROM ims_documents`;

const mapDoc = (d: DocRow) => ({
  id: d.id,
  title: d.title,
  category: d.category,
  period: d.period,
  url: d.url,
  notes: d.notes,
  fileName: d.file_name,
  mime: d.mime,
  sizeBytes: d.size_bytes === null ? null : Number(d.size_bytes),
  hasFile: Boolean(Number(d.has_file)),
  entityType: d.entity_type,
  entityId: d.entity_id,
  entityLabel: d.entity_label,
  uploadedBy: d.uploaded_by === null ? null : Number(d.uploaded_by),
  uploadedByName: d.uploaded_by_name,
  createdAt: tsOf(d.created_at),
});

/* ---------- Routes ---------- */

export function registerAudit(router: Router, deps: ImsDeps): void {
  router.get("/audit/overview", async (req, res) => {
    const actor = actorOf(res);
    requireAuditView(res);
    const t = actor.tenantId;
    const { range, settings, today } = await rangeOf(deps, req, t);
    const span = Math.max(1, daysBetween(range.from, range.to) + 1);
    const prev = { from: addDaysISO(range.from, -span), to: addDaysISO(range.from, -1) };
    const [issues, sales, prevSales, purchases, ar, apRow, expenses, prevExpenses, stock, bank, items, docs, integrations, topCustomer, cashFlow] = await Promise.all([
      issuesWithVerdicts(deps.db, t, range, today, settings),
      one<{ n: number; taxable: string; tax: string; total: string }>(deps.db, `SELECT COUNT(*) AS n, COALESCE(SUM(subtotal - discount_total), 0) AS taxable, COALESCE(SUM(tax_total), 0) AS tax, COALESCE(SUM(grand_total), 0) AS total FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND invoice_date BETWEEN :from AND :to`, { tenantId: t, ...range }),
      one<{ total: string }>(deps.db, `SELECT COALESCE(SUM(grand_total), 0) AS total FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND invoice_date BETWEEN :from AND :to`, { tenantId: t, ...prev }),
      one<{ n: number; tax: string; total: string }>(deps.db, `SELECT COUNT(*) AS n, COALESCE(SUM(tax_total), 0) AS tax, COALESCE(SUM(grand_total), 0) AS total FROM ims_bills WHERE tenant_id = :tenantId AND status <> 'cancelled' AND bill_date BETWEEN :from AND :to`, { tenantId: t, ...range }),
      one<{ total: string; overdue: string; old: string }>(
        deps.db,
        `SELECT COALESCE(SUM(grand_total - amount_paid), 0) AS total, COALESCE(SUM(CASE WHEN due_date < :today THEN grand_total - amount_paid END), 0) AS overdue,
                COALESCE(SUM(CASE WHEN due_date < :old THEN grand_total - amount_paid END), 0) AS old
         FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND grand_total - amount_paid > 0.005`,
        { tenantId: t, today, old: addDaysISO(today, -AUDIT_RULES.overdueReceivableDays) },
      ),
      one<{ total: string; overdue: string }>(
        deps.db,
        `SELECT COALESCE(SUM(grand_total - amount_paid), 0) AS total, COALESCE(SUM(CASE WHEN due_date < :today THEN grand_total - amount_paid END), 0) AS overdue
         FROM ims_bills WHERE tenant_id = :tenantId AND status <> 'cancelled' AND grand_total - amount_paid > 0.005`,
        { tenantId: t, today },
      ),
      one<{ total: string; gst: string }>(deps.db, `SELECT COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(gst_amount), 0) AS gst FROM ims_expenses WHERE tenant_id = :tenantId AND expense_date BETWEEN :from AND :to`, { tenantId: t, ...range }).catch(() => null),
      one<{ total: string }>(deps.db, `SELECT COALESCE(SUM(amount), 0) AS total FROM ims_expenses WHERE tenant_id = :tenantId AND expense_date BETWEEN :from AND :to`, { tenantId: t, ...prev }).catch(() => null),
      one<{ value: string; items: number }>(deps.db, `SELECT COALESCE(SUM(GREATEST(current_stock, 0) * purchase_price), 0) AS value, COUNT(*) AS items FROM ims_items WHERE tenant_id = :tenantId AND active = 1`, { tenantId: t }),
      one<{ total: number; unmatched: number; matched: number; ignored: number; unmatched_value: string }>(
        deps.db,
        `SELECT COUNT(*) AS total, SUM(status = 'unmatched') AS unmatched, SUM(status = 'matched') AS matched, SUM(status = 'ignored') AS ignored,
                COALESCE(SUM(CASE WHEN status = 'unmatched' THEN amount END), 0) AS unmatched_value
         FROM ims_bank_txns WHERE tenant_id = :tenantId`,
        { tenantId: t },
      ),
      rows<{ kind: string; status: string; n: number }>(deps.db, `SELECT kind, status, COUNT(*) AS n FROM ims_audit_items WHERE tenant_id = :tenantId GROUP BY kind, status`, { tenantId: t }),
      one<{ n: number }>(deps.db, `SELECT COUNT(*) AS n FROM ims_documents WHERE tenant_id = :tenantId`, { tenantId: t }),
      rows<{ provider: string; enabled: number; last_sync_at: string | null; last_status: string | null }>(deps.db, `SELECT provider, enabled, last_sync_at, last_status FROM ims_integrations WHERE tenant_id = :tenantId`, { tenantId: t }),
      one<{ name: string; total: string }>(
        deps.db,
        `SELECT customer_name AS name, SUM(grand_total) AS total FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND invoice_date BETWEEN :from AND :to
         GROUP BY COALESCE(customer_id, customer_name), customer_name ORDER BY total DESC LIMIT 1`,
        { tenantId: t, ...range },
      ),
      one<{ cash_in: string; cash_out: string; bank_in: string; bank_out: string }>(
        deps.db,
        `SELECT COALESCE(SUM(CASE WHEN direction = 'in' AND method = 'cash' THEN amount END), 0) AS cash_in, COALESCE(SUM(CASE WHEN direction = 'out' AND method = 'cash' THEN amount END), 0) AS cash_out,
                COALESCE(SUM(CASE WHEN direction = 'in' AND method <> 'cash' THEN amount END), 0) AS bank_in, COALESCE(SUM(CASE WHEN direction = 'out' AND method <> 'cash' THEN amount END), 0) AS bank_out
         FROM ims_payments WHERE tenant_id = :tenantId AND paid_on BETWEEN :from AND :to`,
        { tenantId: t, ...range },
      ),
    ]);
    const open = issues.filter((i) => i.open);
    const health = auditHealth(open);
    const salesTotal = money(sales?.total);
    const prevTotal = money(prevSales?.total);
    const receivable = money(ar?.total);
    const oldAr = money(ar?.old);
    const insights: Array<{ tone: "coral" | "amber" | "blue" | "emerald"; text: string }> = [];
    if (prevTotal > 0) {
      const change = round2(((salesTotal - prevTotal) / prevTotal) * 100);
      if (Math.abs(change) >= 20) insights.push({ tone: change < 0 ? "amber" : "emerald", text: `Sales are ${change > 0 ? "up" : "down"} ${Math.abs(change)}% against the previous ${span} days (${fmtInr(prevTotal)} → ${fmtInr(salesTotal)}).` });
    }
    if (receivable > 0 && oldAr > 0) insights.push({ tone: "coral", text: `${fmtInr(oldAr)} (${Math.round((oldAr / receivable) * 100)}% of receivables) is over ${AUDIT_RULES.overdueReceivableDays} days past due — review for a doubtful-debt provision.` });
    if (topCustomer && salesTotal > 0 && money(topCustomer.total) / salesTotal >= 0.3) {
      insights.push({ tone: "amber", text: `${topCustomer.name} accounts for ${Math.round((money(topCustomer.total) / salesTotal) * 100)}% of sales this period — a customer-concentration risk worth noting.` });
    }
    const outputTax = money(sales?.tax);
    const inputTax = money(purchases?.tax) + money(expenses?.gst);
    if (outputTax > 0) insights.push({ tone: "blue", text: `Output GST ${fmtInr(outputTax)} vs input credit ${fmtInr(inputTax)} — net ${outputTax >= inputTax ? `${fmtInr(outputTax - inputTax)} payable` : `${fmtInr(inputTax - outputTax)} credit carried forward`} (before GSTR-2B reconciliation).` });
    const prevExp = money(prevExpenses?.total);
    const curExp = money(expenses?.total);
    if (prevExp > 0 && curExp > prevExp * 1.5) insights.push({ tone: "amber", text: `Expenses rose ${Math.round(((curExp - prevExp) / prevExp) * 100)}% versus the previous period (${fmtInr(prevExp)} → ${fmtInr(curExp)}).` });
    const missingDocs = open.filter((i) => i.category === "documents").length;
    if (missingDocs) insights.push({ tone: "amber", text: `${missingDocs} bill${missingDocs === 1 ? "" : "s"} or large expenses have no supporting document — request them before sign-off.` });
    if (!open.length) insights.push({ tone: "emerald", text: "No open audit issues for this period — the books look clean." });
    const count = (kind: string, status: string) => items.filter((i) => i.kind === kind && i.status === status).reduce((s, i) => s + Number(i.n), 0);
    res.json({
      range,
      health,
      categories: categorySummary(issues),
      openIssues: open.length,
      totals: {
        sales: round2(salesTotal),
        salesCount: Number(sales?.n ?? 0),
        salesTaxable: round2(money(sales?.taxable)),
        outputTax: round2(outputTax),
        purchases: round2(money(purchases?.total)),
        purchaseCount: Number(purchases?.n ?? 0),
        inputTax: round2(inputTax),
        receivable: round2(receivable),
        overdueReceivable: round2(money(ar?.overdue)),
        payable: round2(money(apRow?.total)),
        overduePayable: round2(money(apRow?.overdue)),
        expenses: round2(curExp),
        stockValue: round2(money(stock?.value)),
        items: Number(stock?.items ?? 0),
        cashIn: round2(money(cashFlow?.cash_in)),
        cashOut: round2(money(cashFlow?.cash_out)),
        bankIn: round2(money(cashFlow?.bank_in)),
        bankOut: round2(money(cashFlow?.bank_out)),
      },
      bank: { total: Number(bank?.total ?? 0), unmatched: Number(bank?.unmatched ?? 0), matched: Number(bank?.matched ?? 0), ignored: Number(bank?.ignored ?? 0), unmatchedValue: round2(money(bank?.unmatched_value)) },
      workload: {
        openFlags: count("flag", "open"),
        openQueries: count("query", "open"),
        answered: count("query", "responded") + count("flag", "responded"),
        resolved: count("flag", "resolved") + count("query", "resolved"),
      },
      documents: Number(docs?.n ?? 0),
      integrations: integrations.map((i) => ({ provider: i.provider, enabled: Boolean(i.enabled), lastSyncAt: tsOf(i.last_sync_at), lastStatus: i.last_status })),
      insights: insights.slice(0, 6),
      canWrite: can(res, "audit"),
    });
  });

  router.get("/audit/issues", async (req, res) => {
    const actor = actorOf(res);
    requireAuditView(res);
    const { range, settings, today } = await rangeOf(deps, req, actor.tenantId);
    const all = await issuesWithVerdicts(deps.db, actor.tenantId, range, today, settings);
    const category = qstr(req.query.category, 16);
    const show = qstr(req.query.show, 8) || "open";
    const list = all.filter((i) => (!category || i.category === category) && (show === "all" || (show === "open" ? i.open : !i.open)));
    list.sort((a, b) => AUDIT_SEVERITIES.indexOf(b.severity) - AUDIT_SEVERITIES.indexOf(a.severity) || (b.amount ?? 0) - (a.amount ?? 0));
    res.json({ range, issues: list, categories: categorySummary(all), health: auditHealth(all.filter((i) => i.open)), rules: AUDIT_RULES, canWrite: can(res, "audit") });
  });

  /** Record a reviewer's verdict on an auto-detected issue (verified / dismissed / reopened), kept by rule key. */
  router.post("/audit/issues/verdict", async (req, res) => {
    const actor = actorOf(res);
    requireAuditWrite(res);
    const input = parse(
      z.object({
        ruleKey: z.string().trim().min(3).max(80),
        verdict: z.enum(["resolved", "dismissed", "open"]),
        note: optText(2000),
        category: z.enum(AUDIT_CATEGORIES.map((c) => c.key) as [AuditCategory, ...AuditCategory[]]),
        title: z.string().trim().min(1).max(255),
        detail: optText(4000),
        severity: z.enum(AUDIT_SEVERITIES).default("medium"),
        entityType: optText(16),
        entityId: optText(36),
        entityLabel: optText(120),
        amount: z.coerce.number().min(0).max(1e12).nullable().optional(),
      }),
      req.body,
    );
    const existing = await one<AuditItemRow>(deps.db, `SELECT * FROM ims_audit_items WHERE tenant_id = :tenantId AND rule_key = :ruleKey ORDER BY updated_at DESC LIMIT 1`, { tenantId: actor.tenantId, ruleKey: input.ruleKey });
    const label = input.verdict === "resolved" ? "Verified" : input.verdict === "dismissed" ? "Dismissed" : "Reopened";
    let id: string;
    if (existing) {
      id = existing.id;
      const thread = appendThread(json(existing.thread, []), entry(actor, res, `${label}${input.note ? `: ${input.note}` : ""}`, !input.note));
      await exec(
        deps.db,
        `UPDATE ims_audit_items SET status = :status, thread = :thread, resolved_at = IF(:status IN ('resolved', 'dismissed'), CURRENT_TIMESTAMP, NULL) WHERE tenant_id = :tenantId AND id = :id`,
        { tenantId: actor.tenantId, id, status: input.verdict, thread: JSON.stringify(thread) },
      );
    } else {
      id = await insertItem(
        deps.db,
        actor,
        res,
        { kind: "flag", area: AUDIT_CATEGORY_AREA[input.category], title: input.title, detail: input.detail, severity: input.severity, entityType: input.entityType, entityId: input.entityId, entityLabel: input.entityLabel, ruleKey: input.ruleKey, amount: input.amount, status: input.verdict },
        `${label}${input.note ? `: ${input.note}` : ""}`,
      );
    }
    await recordEvent(deps, actor, { type: `audit.${input.verdict === "open" ? "reopened" : input.verdict}`, entityType: "audit", entityId: id, summary: `${label} audit finding: ${input.title}`, ip: req.ip });
    res.json({ item: mapItem(await loadItem(deps.db, actor.tenantId, id)) });
  });

  /* Flags & queries */

  router.get("/audit/items", async (req, res) => {
    const actor = actorOf(res);
    requireAuditView(res);
    const where = ["tenant_id = :tenantId"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId };
    const kind = qstr(req.query.kind, 6);
    if (kind === "flag" || kind === "query") {
      where.push("kind = :kind");
      params.kind = kind;
    }
    const status = qstr(req.query.status, 10);
    if (status === "active") where.push("status IN ('open', 'responded')");
    else if ((AUDIT_ITEM_STATUSES as readonly string[]).includes(status)) {
      where.push("status = :status");
      params.status = status;
    }
    const area = qstr(req.query.area, 12);
    if ((AUDIT_AREAS as readonly string[]).includes(area)) {
      where.push("area = :area");
      params.area = area;
    }
    if (qstr(req.query.manual, 1) === "1") where.push("rule_key IS NULL");
    const q = qstr(req.query.q);
    if (q) {
      where.push("(title LIKE :q OR detail LIKE :q OR entity_label LIKE :q)");
      params.q = likeOf(q);
    }
    const list = await rows<AuditItemRow>(
      deps.db,
      `SELECT * FROM ims_audit_items WHERE ${where.join(" AND ")}
       ORDER BY FIELD(status, 'open', 'responded', 'resolved', 'dismissed'), FIELD(severity, 'critical', 'high', 'medium', 'low'), updated_at DESC LIMIT 1000`,
      params,
    );
    res.json({ items: list.map(mapItem), canWrite: can(res, "audit") });
  });

  router.post("/audit/items", async (req, res) => {
    const actor = actorOf(res);
    requireAuditWrite(res);
    const input = parse(ItemInput, req.body);
    if (input.ruleKey) {
      const dup = await one<{ id: string }>(deps.db, `SELECT id FROM ims_audit_items WHERE tenant_id = :tenantId AND rule_key = :ruleKey LIMIT 1`, { tenantId: actor.tenantId, ruleKey: input.ruleKey });
      if (dup) throw conflict("This finding is already flagged — open it from Flags & queries");
    }
    const id = await insertItem(deps.db, actor, res, input);
    await recordEvent(deps, actor, {
      type: `audit.${input.kind}.created`,
      entityType: "audit",
      entityId: id,
      summary: `${input.kind === "query" ? "Auditor query" : "Audit flag"}: ${input.title}`,
      notice: input.kind === "query" ? { kind: "alert", title: "New query from your auditor", body: input.title, path: `?m=audit&open=${id}` } : undefined,
      ip: req.ip,
    });
    res.status(201).json({ item: mapItem(await loadItem(deps.db, actor.tenantId, id)) });
  });

  router.get("/audit/items/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAuditView(res);
    res.json({ item: mapItem(await loadItem(deps.db, actor.tenantId, req.params.id)) });
  });

  /** Anyone working with the auditor can reply; a business reply marks a query answered, an auditor reply reopens it. */
  router.post("/audit/items/:id/reply", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["audit", "reports", "settings", "payables", "receivables"]);
    const { text } = parse(z.object({ text: z.string().trim().min(1, "Write a reply").max(4000) }), req.body);
    const row = await loadItem(deps.db, actor.tenantId, req.params.id);
    if (row.status === "dismissed") throw new ImsError(409, "This item was dismissed — reopen it to continue the thread");
    const auditor = accessOf(res).role === "auditor" || (can(res, "audit") && accessOf(res).role !== "owner");
    const status = auditor ? (row.status === "responded" ? "open" : row.status) : row.status === "open" ? "responded" : row.status;
    await exec(deps.db, `UPDATE ims_audit_items SET thread = :thread, status = :status WHERE tenant_id = :tenantId AND id = :id`, {
      tenantId: actor.tenantId,
      id: row.id,
      thread: JSON.stringify(appendThread(json(row.thread, []), entry(actor, res, text))),
      status,
    });
    await recordEvent(deps, actor, {
      type: "audit.replied",
      entityType: "audit",
      entityId: row.id,
      summary: `Replied on ${row.kind === "query" ? "query" : "flag"}: ${row.title}`,
      notice: !auditor ? { kind: "activity", title: "The business answered your query", body: row.title, path: `?m=audit&open=${row.id}`, targetUserId: row.raised_by } : undefined,
      ip: req.ip,
    });
    res.json({ item: mapItem(await loadItem(deps.db, actor.tenantId, row.id)) });
  });

  router.patch("/audit/items/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAuditWrite(res);
    const patch = parse(ItemPatch, req.body);
    const row = await loadItem(deps.db, actor.tenantId, req.params.id);
    const sets: string[] = [];
    const params: Record<string, unknown> = { tenantId: actor.tenantId, id: row.id };
    const notes: string[] = [];
    if (patch.status && patch.status !== row.status) {
      sets.push("status = :status", "resolved_at = IF(:status IN ('resolved', 'dismissed'), CURRENT_TIMESTAMP, NULL)");
      params.status = patch.status;
      notes.push(`Status → ${patch.status === "responded" ? "answered" : patch.status}`);
    }
    if (patch.severity && patch.severity !== row.severity) {
      sets.push("severity = :severity");
      params.severity = patch.severity;
      notes.push(`Severity → ${patch.severity}`);
    }
    if (patch.title) {
      sets.push("title = :title");
      params.title = patch.title;
    }
    if (patch.detail !== undefined) {
      sets.push("detail = :detail");
      params.detail = patch.detail;
    }
    if (patch.dueDate !== undefined) {
      sets.push("due_date = :dueDate");
      params.dueDate = patch.dueDate;
    }
    if (patch.assigneeUserId !== undefined) {
      sets.push("assignee_user_id = :assigneeUserId", "assignee_name = :assigneeName");
      params.assigneeUserId = patch.assigneeUserId;
      params.assigneeName = patch.assigneeUserId ? (patch.assigneeName ?? null) : null;
      notes.push(patch.assigneeUserId ? `Assigned to ${patch.assigneeName ?? `user ${patch.assigneeUserId}`}` : "Unassigned");
    }
    if (!sets.length && !patch.note) {
      res.json({ item: mapItem(row) });
      return;
    }
    let thread = json<ThreadEntry[]>(row.thread, []);
    if (notes.length) thread = appendThread(thread, entry(actor, res, notes.join(" · "), true));
    if (patch.note) thread = appendThread(thread, entry(actor, res, patch.note));
    sets.push("thread = :thread");
    params.thread = JSON.stringify(thread);
    await exec(deps.db, `UPDATE ims_audit_items SET ${sets.join(", ")} WHERE tenant_id = :tenantId AND id = :id`, params);
    await recordEvent(deps, actor, {
      type: "audit.updated",
      entityType: "audit",
      entityId: row.id,
      summary: `${row.kind === "query" ? "Query" : "Flag"} “${row.title}”: ${notes.join(", ") || "note added"}`,
      notice: patch.assigneeUserId ? { kind: "activity", title: "An audit item was assigned to you", body: row.title, path: `?m=audit&open=${row.id}`, targetUserId: patch.assigneeUserId } : undefined,
      ip: req.ip,
    });
    res.json({ item: mapItem(await loadItem(deps.db, actor.tenantId, row.id)) });
  });

  router.delete("/audit/items/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAuditWrite(res);
    const row = await loadItem(deps.db, actor.tenantId, req.params.id);
    if (row.raised_by !== null && Number(row.raised_by) !== actor.userId && accessOf(res).role !== "owner") throw forbidden("Only the person who raised it (or an owner) can delete this item");
    await exec(deps.db, `DELETE FROM ims_audit_items WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    await recordEvent(deps, actor, { type: "audit.deleted", entityType: "audit", entityId: row.id, summary: `Deleted ${row.kind}: ${row.title}`, ip: req.ip });
    res.status(204).end();
  });

  /* Read-only ledgers for the auditor */

  router.get("/audit/ledger/:kind", async (req, res) => {
    const actor = actorOf(res);
    requireAuditView(res);
    const t = actor.tenantId;
    const { range, today } = await rangeOf(deps, req, t);
    const q = qstr(req.query.q);
    const like = q ? likeOf(q) : null;
    const kind = req.params.kind;
    if (kind === "sales") {
      const list = await rows<{ id: string; invoice_no: string; invoice_date: string; due_date: string | null; customer_name: string; customer_gstin: string | null; status: string; subtotal: string; discount_total: string; tax_total: string; cgst: string; sgst: string; igst: string; grand_total: string; amount_paid: string; source_tool: string | null }>(
        deps.db,
        `SELECT id, invoice_no, invoice_date, due_date, customer_name, customer_gstin, status, subtotal, discount_total, tax_total, cgst, sgst, igst, grand_total, amount_paid, source_tool
         FROM ims_invoices WHERE tenant_id = :tenantId AND status IN ('issued', 'cancelled') AND invoice_date BETWEEN :from AND :to ${like ? "AND (invoice_no LIKE :q OR customer_name LIKE :q OR customer_gstin LIKE :q)" : ""}
         ORDER BY invoice_date DESC, invoice_no DESC LIMIT 5000`,
        { tenantId: t, ...range, q: like },
      );
      const data = list.map((r) => {
        const live = r.status === "issued";
        return {
          id: r.id,
          date: isoOf(r.invoice_date),
          no: r.invoice_no,
          party: r.customer_name,
          gstin: r.customer_gstin,
          taxable: round2(money(r.subtotal) - money(r.discount_total)),
          cgst: round2(money(r.cgst)),
          sgst: round2(money(r.sgst)),
          igst: round2(money(r.igst)),
          tax: round2(money(r.tax_total)),
          total: round2(money(r.grand_total)),
          paid: round2(money(r.amount_paid)),
          balance: live ? round2(Math.max(0, money(r.grand_total) - money(r.amount_paid))) : 0,
          status: r.status,
          source: r.source_tool,
        };
      });
      const live = data.filter((d) => d.status === "issued");
      res.json({ kind, range, rows: data, totals: { count: live.length, taxable: round2(live.reduce((s, d) => s + d.taxable, 0)), tax: round2(live.reduce((s, d) => s + d.tax, 0)), total: round2(live.reduce((s, d) => s + d.total, 0)), balance: round2(live.reduce((s, d) => s + d.balance, 0)) } });
      return;
    }
    if (kind === "purchases") {
      const list = await rows<{ id: string; bill_no: string; supplier_bill_no: string | null; bill_date: string; due_date: string | null; supplier_name: string; status: string; subtotal: string; tax_total: string; grand_total: string; amount_paid: string; po_no: string | null; docs: number }>(
        deps.db,
        `SELECT b.id, b.bill_no, b.supplier_bill_no, b.bill_date, b.due_date, b.supplier_name, b.status, b.subtotal, b.tax_total, b.grand_total, b.amount_paid, b.po_no,
                (SELECT COUNT(*) FROM ims_documents d WHERE d.tenant_id = b.tenant_id AND d.entity_type = 'bill' AND d.entity_id = b.id) AS docs
         FROM ims_bills b WHERE b.tenant_id = :tenantId AND b.bill_date BETWEEN :from AND :to ${like ? "AND (b.bill_no LIKE :q OR b.supplier_bill_no LIKE :q OR b.supplier_name LIKE :q)" : ""}
         ORDER BY b.bill_date DESC LIMIT 5000`,
        { tenantId: t, ...range, q: like },
      );
      const data = list.map((r) => ({
        id: r.id,
        date: isoOf(r.bill_date),
        no: r.bill_no,
        supplierBillNo: r.supplier_bill_no,
        poNo: r.po_no,
        party: r.supplier_name,
        taxable: round2(money(r.subtotal)),
        tax: round2(money(r.tax_total)),
        total: round2(money(r.grand_total)),
        paid: round2(money(r.amount_paid)),
        balance: r.status === "cancelled" ? 0 : round2(Math.max(0, money(r.grand_total) - money(r.amount_paid))),
        status: r.status,
        documents: Number(r.docs),
      }));
      const live = data.filter((d) => d.status !== "cancelled");
      res.json({ kind, range, rows: data, totals: { count: live.length, taxable: round2(live.reduce((s, d) => s + d.taxable, 0)), tax: round2(live.reduce((s, d) => s + d.tax, 0)), total: round2(live.reduce((s, d) => s + d.total, 0)), balance: round2(live.reduce((s, d) => s + d.balance, 0)) } });
      return;
    }
    if (kind === "inventory") {
      const list = await rows<{ id: string; name: string; sku: string | null; unit: string; category: string | null; purchase_price: string; current_stock: string; after_to: string | null; in_qty: string | null; out_qty: string | null; in_range: string | null }>(
        deps.db,
        `SELECT i.id, i.name, i.sku, i.unit, i.category, i.purchase_price, i.current_stock,
                SUM(CASE WHEN m.movement_date > :to THEN m.delta END) AS after_to,
                SUM(CASE WHEN m.movement_date BETWEEN :from AND :to AND m.delta > 0 THEN m.delta END) AS in_qty,
                SUM(CASE WHEN m.movement_date BETWEEN :from AND :to AND m.delta < 0 THEN -m.delta END) AS out_qty,
                SUM(CASE WHEN m.movement_date BETWEEN :from AND :to THEN m.delta END) AS in_range
         FROM ims_items i LEFT JOIN ims_movements m ON m.tenant_id = i.tenant_id AND m.item_id = i.id
         WHERE i.tenant_id = :tenantId ${like ? "AND (i.name LIKE :q OR i.sku LIKE :q OR i.category LIKE :q)" : ""}
         GROUP BY i.id, i.name, i.sku, i.unit, i.category, i.purchase_price, i.current_stock ORDER BY i.name LIMIT 5000`,
        { tenantId: t, ...range, q: like },
      );
      const data = list.map((r) => {
        const closing = round3(money(r.current_stock) - money(r.after_to));
        const opening = round3(closing - money(r.in_range));
        const cost = round2(money(r.purchase_price));
        return { id: r.id, name: r.name, sku: r.sku, unit: r.unit, category: r.category, opening, inQty: round3(money(r.in_qty)), outQty: round3(money(r.out_qty)), closing, cost, value: round2(Math.max(0, closing) * cost) };
      });
      res.json({ kind, range, rows: data, totals: { count: data.length, openingValue: round2(data.reduce((s, d) => s + Math.max(0, d.opening) * d.cost, 0)), value: round2(data.reduce((s, d) => s + d.value, 0)), negative: data.filter((d) => d.closing < 0).length } });
      return;
    }
    if (kind === "receivables" || kind === "payables") {
      const ar = kind === "receivables";
      const list = await rows<{ id: string; no: string; party: string; doc_date: string; due_date: string | null; total: string; paid: string; status: string }>(
        deps.db,
        ar
          ? `SELECT id, invoice_no AS no, customer_name AS party, invoice_date AS doc_date, due_date, grand_total AS total, amount_paid AS paid, status FROM ims_invoices
             WHERE tenant_id = :tenantId AND status = 'issued' AND grand_total - amount_paid > 0.005 ${like ? "AND (invoice_no LIKE :q OR customer_name LIKE :q)" : ""} ORDER BY due_date ASC LIMIT 5000`
          : `SELECT id, bill_no AS no, supplier_name AS party, bill_date AS doc_date, due_date, grand_total AS total, amount_paid AS paid, status FROM ims_bills
             WHERE tenant_id = :tenantId AND status <> 'cancelled' AND grand_total - amount_paid > 0.005 ${like ? "AND (bill_no LIKE :q OR supplier_name LIKE :q)" : ""} ORDER BY due_date ASC LIMIT 5000`,
        { tenantId: t, q: like },
      );
      const data = list.map((r) => {
        const due = r.due_date ? isoOf(r.due_date) : isoOf(r.doc_date);
        const overdue = Math.max(0, daysBetween(due, today));
        return { id: r.id, no: r.no, party: r.party, date: isoOf(r.doc_date), dueDate: due, total: round2(money(r.total)), paid: round2(money(r.paid)), balance: round2(money(r.total) - money(r.paid)), daysOverdue: overdue, bucket: agingBucket(overdue), status: r.status };
      });
      const buckets = ["0-15", "16-30", "31-60", "61-90", "90+"].map((b) => ({ key: b, value: round2(data.filter((d) => d.bucket === b).reduce((s, d) => s + d.balance, 0)), count: data.filter((d) => d.bucket === b).length }));
      res.json({ kind, range, rows: data, totals: { count: data.length, balance: round2(data.reduce((s, d) => s + d.balance, 0)), overdue: round2(data.filter((d) => d.daysOverdue > 0).reduce((s, d) => s + d.balance, 0)) }, buckets });
      return;
    }
    if (kind === "expenses") {
      const list = await rows<{ id: string; expense_date: string; category: string; description: string | null; amount: string; gst_amount: string; pay_method: string; vendor: string | null; reference: string | null; created_by_name: string | null; docs: number }>(
        deps.db,
        `SELECT e.id, e.expense_date, e.category, e.description, e.amount, e.gst_amount, e.pay_method, e.vendor, e.reference, e.created_by_name,
                (SELECT COUNT(*) FROM ims_documents d WHERE d.tenant_id = e.tenant_id AND d.entity_type = 'expense' AND d.entity_id = e.id) AS docs
         FROM ims_expenses e WHERE e.tenant_id = :tenantId AND e.expense_date BETWEEN :from AND :to ${like ? "AND (e.category LIKE :q OR e.description LIKE :q OR e.vendor LIKE :q)" : ""}
         ORDER BY e.expense_date DESC LIMIT 5000`,
        { tenantId: t, ...range, q: like },
      );
      const data = list.map((r) => ({ id: r.id, date: isoOf(r.expense_date), category: r.category, description: r.description, vendor: r.vendor, amount: round2(money(r.amount)), gst: round2(money(r.gst_amount)), method: r.pay_method, reference: r.reference, by: r.created_by_name, documents: Number(r.docs) }));
      const byCategory = [...data.reduce((m, d) => m.set(d.category, round2((m.get(d.category) ?? 0) + d.amount)), new Map<string, number>())].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
      res.json({ kind, range, rows: data, totals: { count: data.length, amount: round2(data.reduce((s, d) => s + d.amount, 0)), gst: round2(data.reduce((s, d) => s + d.gst, 0)), cash: round2(data.filter((d) => d.method === "cash").reduce((s, d) => s + d.amount, 0)) }, byCategory });
      return;
    }
    throw badRequest("Unknown ledger (use sales, purchases, inventory, receivables, payables or expenses)");
  });

  /** Trial balance, profit & loss, balance sheet and day book, built from IMS records as double-entry vouchers. */
  router.get("/audit/books", async (req, res) => {
    const actor = actorOf(res);
    requireAuditView(res);
    const { range, settings } = await rangeOf(deps, req, actor.tenantId);
    res.json(await loadBooks(deps.db, actor.tenantId, settings, range));
  });

  router.get("/audit/trace/:type/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAuditView(res);
    const type = String(req.params.type);
    if (!(TRACE_TYPES as ReadonlyArray<string>).includes(type)) throw badRequest("This record type can't be traced");
    const id = String(req.params.id).slice(0, 64);
    const { range, settings, today } = await rangeOf(deps, req, actor.tenantId);
    const [trace, issues] = await Promise.all([loadTrace(deps.db, actor.tenantId, type as TraceType, id, today), issuesWithVerdicts(deps.db, actor.tenantId, range, today, settings)]);
    if (!trace) throw notFound("Record not found");
    res.json({ trace, findings: issues.filter((i) => i.entityId === id) });
  });

  router.post("/audit/gstr2b", async (req, res) => {
    const actor = actorOf(res);
    requireAuditView(res);
    const { rows: portal } = parse(z.object({ rows: z.array(Gstr2bRowSchema).min(1, "The file has no B2B invoices").max(20_000) }), req.body);
    const { range } = await rangeOf(deps, req, actor.tenantId, "lastmonth");
    const bills = await loadBookBills(deps.db, actor.tenantId, range);
    res.json({ range, ...reconcileGstr2b(bills, portal) });
  });

  router.get("/audit/ask", async (req, res) => {
    const actor = actorOf(res);
    requireAuditView(res);
    const question = qstr(req.query.q, 500);
    if (!question) throw badRequest("Type a question");
    const { range, settings, today } = await rangeOf(deps, req, actor.tenantId);
    const issues = await issuesWithVerdicts(deps.db, actor.tenantId, range, today, settings);
    res.json({ question, range, ...auditAsk(question, issues, today) });
  });

  router.get("/audit/gst", async (req, res) => {
    const actor = actorOf(res);
    requireAuditView(res);
    const t = actor.tenantId;
    const { range, settings } = await rangeOf(deps, req, t, "mtd");
    const invoices = await rows<{ customer_gstin: string | null; intra_state: number; lines: unknown; subtotal: string; discount_total: string; cgst: string; sgst: string; igst: string; grand_total: string }>(
      deps.db,
      `SELECT customer_gstin, intra_state, \`lines\`, subtotal, discount_total, cgst, sgst, igst, grand_total FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND invoice_date BETWEEN :from AND :to LIMIT 20000`,
      { tenantId: t, ...range },
    );
    const output = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    const b2b = { count: 0, value: 0 };
    const b2c = { count: 0, value: 0 };
    const byRate = new Map<number, { rate: number; taxable: number; tax: number }>();
    let missingHsn = 0;
    for (const inv of invoices) {
      output.taxable += money(inv.subtotal) - money(inv.discount_total);
      output.cgst += money(inv.cgst);
      output.sgst += money(inv.sgst);
      output.igst += money(inv.igst);
      const bucket = inv.customer_gstin ? b2b : b2c;
      bucket.count += 1;
      bucket.value += money(inv.grand_total);
      const totals = computeTotals(json<ImsLineInput[]>(inv.lines, []), Boolean(inv.intra_state));
      for (const l of totals.lines) {
        const row = byRate.get(l.gstRate) ?? { rate: l.gstRate, taxable: 0, tax: 0 };
        row.taxable = round2(row.taxable + l.taxable);
        row.tax = round2(row.tax + l.tax);
        byRate.set(l.gstRate, row);
        if (!l.hsn) missingHsn += 1;
      }
    }
    const bills = await rows<{ tax_total: string; state: string | null }>(
      deps.db,
      `SELECT b.tax_total, p.state FROM ims_bills b LEFT JOIN ims_parties p ON p.tenant_id = b.tenant_id AND p.id = b.supplier_id WHERE b.tenant_id = :tenantId AND b.status <> 'cancelled' AND b.bill_date BETWEEN :from AND :to LIMIT 20000`,
      { tenantId: t, ...range },
    );
    const input = { cgst: 0, sgst: 0, igst: 0 };
    for (const b of bills) {
      const tax = money(b.tax_total);
      if (isIntraState(settings.state, b.state)) {
        input.cgst += tax / 2;
        input.sgst += tax / 2;
      } else input.igst += tax;
    }
    const exp = await one<{ gst: string }>(deps.db, `SELECT COALESCE(SUM(gst_amount), 0) AS gst FROM ims_expenses WHERE tenant_id = :tenantId AND expense_date BETWEEN :from AND :to`, { tenantId: t, ...range }).catch(() => null);
    const expGst = money(exp?.gst);
    input.cgst += expGst / 2;
    input.sgst += expGst / 2;
    const outTotal = output.cgst + output.sgst + output.igst;
    const inTotal = input.cgst + input.sgst + input.igst;
    res.json({
      range,
      output: { taxable: round2(output.taxable), cgst: round2(output.cgst), sgst: round2(output.sgst), igst: round2(output.igst), total: round2(outTotal) },
      input: { cgst: round2(input.cgst), sgst: round2(input.sgst), igst: round2(input.igst), total: round2(inTotal), fromBills: round2(inTotal - expGst), fromExpenses: round2(expGst) },
      net: round2(outTotal - inTotal),
      b2b: { count: b2b.count, value: round2(b2b.value) },
      b2c: { count: b2c.count, value: round2(b2c.value) },
      byRate: [...byRate.values()].sort((a, b) => a.rate - b.rate),
      missingHsnLines: missingHsn,
      invoices: invoices.length,
      bills: bills.length,
    });
  });

  /* Entity lookup for linking documents and flags */
  router.get("/audit/entities", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["audit", "reports", "payables", "settings"]);
    const type = qstr(req.query.type, 16);
    const q = qstr(req.query.q, 80);
    const like = likeOf(q);
    const params = { tenantId: actor.tenantId, q: like };
    type E = { id: string; label: string; sub: string | null };
    let list: E[] = [];
    if (type === "invoice") list = await rows<E>(deps.db, `SELECT id, invoice_no AS label, customer_name AS sub FROM ims_invoices WHERE tenant_id = :tenantId AND (invoice_no LIKE :q OR customer_name LIKE :q) ORDER BY invoice_date DESC LIMIT 20`, params);
    else if (type === "bill") list = await rows<E>(deps.db, `SELECT id, bill_no AS label, CONCAT(supplier_name, IFNULL(CONCAT(' · ', supplier_bill_no), '')) AS sub FROM ims_bills WHERE tenant_id = :tenantId AND (bill_no LIKE :q OR supplier_name LIKE :q OR supplier_bill_no LIKE :q) ORDER BY bill_date DESC LIMIT 20`, params);
    else if (type === "expense") list = await rows<E>(deps.db, `SELECT id, CONCAT(category, IFNULL(CONCAT(' — ', description), '')) AS label, CONCAT(expense_date, ' · ₹', amount) AS sub FROM ims_expenses WHERE tenant_id = :tenantId AND (category LIKE :q OR description LIKE :q OR vendor LIKE :q) ORDER BY expense_date DESC LIMIT 20`, params).catch(() => []);
    else if (type === "party") list = await rows<E>(deps.db, `SELECT id, name AS label, kind AS sub FROM ims_parties WHERE tenant_id = :tenantId AND (name LIKE :q OR gstin LIKE :q) ORDER BY name LIMIT 20`, params);
    else if (type === "item") list = await rows<E>(deps.db, `SELECT id, name AS label, sku AS sub FROM ims_items WHERE tenant_id = :tenantId AND (name LIKE :q OR sku LIKE :q) ORDER BY name LIMIT 20`, params);
    else if (type === "po") list = await rows<E>(deps.db, `SELECT id, po_no AS label, supplier_name AS sub FROM ims_purchase_orders WHERE tenant_id = :tenantId AND (po_no LIKE :q OR supplier_name LIKE :q) ORDER BY order_date DESC LIMIT 20`, params);
    res.json({ entities: list.map((e) => ({ id: e.id, label: String(e.label ?? ""), sub: e.sub ? String(e.sub) : null })) });
  });

  /* Bank reconciliation */

  router.get("/audit/bank", async (req, res) => {
    const actor = actorOf(res);
    requireAuditView(res);
    const t = actor.tenantId;
    const status = qstr(req.query.status, 10) || "all";
    const from = qstr(req.query.from, 10);
    const to = qstr(req.query.to, 10);
    const where = ["tenant_id = :tenantId"];
    const params: Record<string, unknown> = { tenantId: t };
    if (["unmatched", "matched", "ignored"].includes(status)) {
      where.push("status = :status");
      params.status = status;
    }
    if (isISODate(from) && isISODate(to)) {
      where.push("txn_date BETWEEN :from AND :to");
      Object.assign(params, { from, to });
    }
    const list = await rows<BankRow>(deps.db, `SELECT * FROM ims_bank_txns WHERE ${where.join(" AND ")} ORDER BY txn_date DESC, created_at DESC LIMIT 3000`, params);
    const unmatched = list.filter((r) => r.status === "unmatched");
    let suggestions = new Map<string, ReturnType<typeof suggestBankMatches>>();
    if (unmatched.length) {
      const dates = unmatched.map((r) => isoOf(r.txn_date)).sort();
      const candidates = await bankCandidates(deps.db, t, addDaysISO(dates[0], -10), addDaysISO(dates[dates.length - 1], 10));
      suggestions = new Map(unmatched.slice(0, 500).map((r) => [r.id, suggestBankMatches(bankInput(r), candidates, 3, 10)]));
    }
    const summary = await one<{ total: number; unmatched: number; matched: number; ignored: number; inflow: string; outflow: string; unmatched_value: string; last_import: string | null }>(
      deps.db,
      `SELECT COUNT(*) AS total, SUM(status = 'unmatched') AS unmatched, SUM(status = 'matched') AS matched, SUM(status = 'ignored') AS ignored,
              COALESCE(SUM(CASE WHEN direction = 'in' THEN amount END), 0) AS inflow, COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) AS outflow,
              COALESCE(SUM(CASE WHEN status = 'unmatched' THEN amount END), 0) AS unmatched_value, MAX(created_at) AS last_import
       FROM ims_bank_txns WHERE tenant_id = :tenantId`,
      { tenantId: t },
    );
    res.json({
      txns: list.map((r) => ({
        id: r.id,
        date: isoOf(r.txn_date),
        description: r.description,
        amount: round2(money(r.amount)),
        direction: r.direction,
        reference: r.reference,
        status: r.status,
        matchedType: r.matched_type,
        matchedId: r.matched_id,
        matchedLabel: r.matched_label,
        matchScore: r.match_score === null ? null : Number(r.match_score),
        matchedBy: r.matched_by,
        suggestions: (suggestions.get(r.id) ?? []).map((s) => ({ type: s.candidate.type, id: s.candidate.id, label: s.candidate.label, date: s.candidate.date, amount: s.candidate.amount, score: s.score, reasons: s.reasons })),
      })),
      summary: {
        total: Number(summary?.total ?? 0),
        unmatched: Number(summary?.unmatched ?? 0),
        matched: Number(summary?.matched ?? 0),
        ignored: Number(summary?.ignored ?? 0),
        inflow: round2(money(summary?.inflow)),
        outflow: round2(money(summary?.outflow)),
        unmatchedValue: round2(money(summary?.unmatched_value)),
        lastImportAt: tsOf(summary?.last_import ?? null),
      },
      canWrite: can(res, "audit"),
    });
  });

  router.post("/audit/bank/import", async (req, res) => {
    const actor = actorOf(res);
    requireAuditWrite(res);
    const body = parse(z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1, "The statement has no rows").max(10_000), autoMatch: z.boolean().default(true) }), req.body);
    const parsed = normalizeBankRows(body.rows);
    if (!parsed.txns.length) throw badRequest(parsed.errors[0] ?? "No transactions could be read from this file", parsed.errors);
    const batchId = randomUUID();
    const dates = parsed.txns.map((x) => x.date).sort();
    const result = await tx(deps.db, async (conn) => {
      const existing = await rows<{ txn_date: string; amount: string; direction: string; description: string; reference: string | null }>(
        conn,
        `SELECT txn_date, amount, direction, description, reference FROM ims_bank_txns WHERE tenant_id = :tenantId AND txn_date BETWEEN :from AND :to`,
        { tenantId: actor.tenantId, from: dates[0], to: dates[dates.length - 1] },
      );
      const key = (d: string, a: number, dir: string, desc: string, ref: string | null) => `${d}|${round2(a).toFixed(2)}|${dir}|${desc.trim().toLowerCase()}|${(ref ?? "").trim().toLowerCase()}`;
      const seen = new Set(existing.map((e) => key(isoOf(e.txn_date), money(e.amount), e.direction, e.description, e.reference)));
      let imported = 0;
      let duplicates = 0;
      for (const x of parsed.txns) {
        const k = key(x.date, x.amount, x.direction, x.description, x.reference);
        if (seen.has(k)) {
          duplicates += 1;
          continue;
        }
        seen.add(k);
        await exec(
          conn,
          `INSERT INTO ims_bank_txns (id, tenant_id, txn_date, description, amount, direction, reference, status, batch_id, created_by)
           VALUES (:id, :tenantId, :date, :description, :amount, :direction, :reference, 'unmatched', :batchId, :userId)`,
          { id: randomUUID(), tenantId: actor.tenantId, ...x, batchId, userId: actor.userId },
        );
        imported += 1;
      }
      return { imported, duplicates };
    });
    const matched = body.autoMatch && result.imported ? await runAutoMatch(deps.db, actor.tenantId, actorName(actor)) : 0;
    await recordEvent(deps, actor, {
      type: "audit.bank.imported",
      entityType: "bank",
      entityId: batchId,
      summary: `Imported bank statement: ${result.imported} lines (${dates[0]} to ${dates[dates.length - 1]})${matched ? `, ${matched} auto-matched` : ""}${result.duplicates ? `, ${result.duplicates} duplicates skipped` : ""}`,
      ip: req.ip,
    });
    res.json({ ...result, skipped: parsed.skipped, matched, errors: parsed.errors, from: dates[0], to: dates[dates.length - 1] });
  });

  router.post("/audit/bank/auto-match", async (req, res) => {
    const actor = actorOf(res);
    requireAuditWrite(res);
    const matched = await runAutoMatch(deps.db, actor.tenantId, actorName(actor));
    if (matched) await recordEvent(deps, actor, { type: "audit.bank.automatch", entityType: "bank", entityId: "auto", summary: `Auto-matched ${matched} bank line${matched === 1 ? "" : "s"}`, ip: req.ip });
    res.json({ matched });
  });

  router.get("/audit/bank/:id/candidates", async (req, res) => {
    const actor = actorOf(res);
    requireAuditView(res);
    const row = await one<BankRow>(deps.db, `SELECT * FROM ims_bank_txns WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!row) throw notFound("Bank line");
    const txn = bankInput(row);
    const q = qstr(req.query.q).toLowerCase();
    const list = await bankCandidates(deps.db, actor.tenantId, addDaysISO(txn.date, -45), addDaysISO(txn.date, 45), row.id);
    const scored = list
      .filter((c) => c.direction === txn.direction && (!q || `${c.label} ${c.reference ?? ""}`.toLowerCase().includes(q) || String(c.amount).includes(q)))
      .map((c) => ({ c, s: scoreBankMatch(txn, c, 45) }))
      .sort((a, b) => (b.s?.score ?? 0) - (a.s?.score ?? 0) || Math.abs(a.c.amount - txn.amount) - Math.abs(b.c.amount - txn.amount))
      .slice(0, 30);
    res.json({ candidates: scored.map(({ c, s }) => ({ type: c.type, id: c.id, label: c.label, date: c.date, amount: c.amount, score: s?.score ?? 0, reasons: s?.reasons ?? [Math.abs(c.amount - txn.amount) < 0.5 ? "Amount matches" : `Amount differs by ${fmtInr(Math.abs(c.amount - txn.amount))}`] })) });
  });

  router.post("/audit/bank/:id/match", async (req, res) => {
    const actor = actorOf(res);
    requireAuditWrite(res);
    const input = parse(z.object({ type: z.enum(["payment", "expense"]), id: z.string().trim().min(1).max(36) }), req.body);
    const row = await one<BankRow>(deps.db, `SELECT * FROM ims_bank_txns WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!row) throw notFound("Bank line");
    const taken = await one<{ id: string }>(deps.db, `SELECT id FROM ims_bank_txns WHERE tenant_id = :tenantId AND status = 'matched' AND matched_type = :type AND matched_id = :mid AND id <> :id LIMIT 1`, {
      tenantId: actor.tenantId,
      type: input.type,
      mid: input.id,
      id: row.id,
    });
    if (taken) throw conflict("That entry is already matched to another bank line — unmatch it there first");
    const c = (await bankCandidates(deps.db, actor.tenantId, "1970-01-01", "2999-12-31", row.id)).find((x) => x.type === input.type && x.id === input.id);
    if (!c) throw notFound(input.type === "payment" ? "Payment" : "Expense");
    if (c.direction !== row.direction) throw badRequest(`This is a ${row.direction === "in" ? "credit" : "debit"} — match it to a ${row.direction === "in" ? "receipt" : "payment or expense"}`);
    const s = scoreBankMatch(bankInput(row), c, 3650);
    await applyMatch(deps.db, actor.tenantId, row.id, c, s?.score ?? null, actorName(actor));
    await recordEvent(deps, actor, { type: "audit.bank.matched", entityType: "bank", entityId: row.id, summary: `Matched bank line “${row.description.slice(0, 60)}” (${fmtInr(money(row.amount))}) to ${c.label}`, ip: req.ip });
    res.json({ ok: true });
  });

  for (const action of ["unmatch", "ignore", "restore"] as const) {
    router.post(`/audit/bank/:id/${action}`, async (req, res) => {
      const actor = actorOf(res);
      requireAuditWrite(res);
      const row = await one<BankRow>(deps.db, `SELECT * FROM ims_bank_txns WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
      if (!row) throw notFound("Bank line");
      await exec(
        deps.db,
        `UPDATE ims_bank_txns SET status = :status, matched_type = NULL, matched_id = NULL, matched_label = NULL, match_score = NULL, matched_by = :by WHERE tenant_id = :tenantId AND id = :id`,
        { tenantId: actor.tenantId, id: row.id, status: action === "ignore" ? "ignored" : "unmatched", by: action === "ignore" ? actorName(actor) : null },
      );
      const verb = action === "ignore" ? "Ignored" : action === "unmatch" ? "Unmatched" : "Restored";
      await recordEvent(deps, actor, { type: `audit.bank.${action}`, entityType: "bank", entityId: row.id, summary: `${verb} bank line “${row.description.slice(0, 60)}”`, ip: req.ip });
      res.json({ ok: true });
    });
  }

  router.delete("/audit/bank/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAuditWrite(res);
    const row = await one<BankRow>(deps.db, `SELECT * FROM ims_bank_txns WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!row) throw notFound("Bank line");
    await exec(deps.db, `DELETE FROM ims_bank_txns WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    await recordEvent(deps, actor, { type: "audit.bank.deleted", entityType: "bank", entityId: row.id, summary: `Deleted bank line “${row.description.slice(0, 60)}” (${fmtInr(money(row.amount))})`, ip: req.ip });
    res.status(204).end();
  });

  /* Documents */

  router.get("/audit/documents", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["audit", "reports", "payables", "settings"]);
    const where = ["tenant_id = :tenantId"];
    const params: Record<string, unknown> = { tenantId: actor.tenantId };
    const category = qstr(req.query.category, 40);
    if (category) {
      where.push("category = :category");
      params.category = category;
    }
    const entityType = qstr(req.query.entityType, 16);
    const entityId = qstr(req.query.entityId, 36);
    if (entityType) {
      where.push("entity_type = :entityType");
      params.entityType = entityType;
    }
    if (entityId) {
      where.push("entity_id = :entityId");
      params.entityId = entityId;
    }
    const q = qstr(req.query.q);
    if (q) {
      where.push("(title LIKE :q OR file_name LIKE :q OR entity_label LIKE :q OR notes LIKE :q)");
      params.q = likeOf(q);
    }
    const list = await rows<DocRow>(deps.db, `${DOC_SELECT} WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 1000`, params);
    res.json({ documents: list.map(mapDoc), categories: DOC_CATEGORIES, maxBytes: MAX_FILE_BYTES });
  });

  router.post("/audit/documents", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["audit", "reports", "payables", "settings"], "Uploading documents needs the Auditor workspace, Reports, Payables or Settings permission.");
    const input = parse(DocInput, req.body);
    let mime: string | null = null;
    let size: number | null = null;
    if (input.content) {
      const m = input.content.match(/^data:([\w.+-]+\/[\w.+-]+)?(;[\w=-]+)*;base64,([A-Za-z0-9+/=\s]+)$/);
      if (!m) throw badRequest("The file must be sent as a base64 data URL");
      mime = m[1] ?? "application/octet-stream";
      size = Buffer.from(m[3], "base64").length;
      if (size > MAX_FILE_BYTES) throw badRequest("Files up to 2 MB can be stored here — paste a link to larger files instead");
      if (!/^(application\/pdf|image\/(png|jpe?g|webp|gif)|text\/(csv|plain)|application\/(vnd\.openxmlformats-officedocument\.[\w.]+|vnd\.ms-excel|msword|zip|xml)|application\/octet-stream)$/i.test(mime)) {
        throw badRequest("Upload a PDF, image, spreadsheet, Word, CSV, XML or ZIP file");
      }
    }
    const id = randomUUID();
    await exec(
      deps.db,
      `INSERT INTO ims_documents (id, tenant_id, title, category, period, url, notes, file_name, mime, size_bytes, content, entity_type, entity_id, entity_label, uploaded_by, uploaded_by_name)
       VALUES (:id, :tenantId, :title, :category, :period, :url, :notes, :fileName, :mime, :size, :content, :entityType, :entityId, :entityLabel, :userId, :userName)`,
      {
        id,
        tenantId: actor.tenantId,
        title: input.title,
        category: input.category,
        period: input.period ?? null,
        url: input.url ?? null,
        notes: input.notes ?? null,
        fileName: input.fileName ?? null,
        mime,
        size,
        content: input.content ? input.content.replace(/\s/g, "") : null,
        entityType: input.entityType ?? null,
        entityId: input.entityType ? (input.entityId ?? null) : null,
        entityLabel: input.entityType ? (input.entityLabel ?? null) : null,
        userId: actor.userId,
        userName: actorName(actor),
      },
    );
    await recordEvent(deps, actor, {
      type: "audit.document.added",
      entityType: input.entityType ?? "document",
      entityId: input.entityType && input.entityId ? input.entityId : id,
      summary: `Added document “${input.title}”${input.entityLabel ? ` to ${input.entityLabel}` : ""}`,
      ip: req.ip,
    });
    const row = await one<DocRow>(deps.db, `${DOC_SELECT} WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id });
    res.status(201).json({ document: row ? mapDoc(row) : null });
  });

  router.get("/audit/documents/:id/file", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["audit", "reports", "payables", "settings"]);
    const row = await one<{ title: string; file_name: string | null; mime: string | null; content: string | null; url: string | null }>(
      deps.db,
      `SELECT title, file_name, mime, content, url FROM ims_documents WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId: actor.tenantId, id: req.params.id },
    );
    if (!row) throw notFound("Document");
    if (!row.content) {
      if (row.url) {
        res.json({ url: row.url });
        return;
      }
      throw notFound("File");
    }
    const b64 = row.content.slice(row.content.indexOf(",") + 1);
    const name = (row.file_name || row.title).replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "document";
    res.setHeader("Content-Type", row.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(Buffer.from(b64, "base64"));
  });

  router.delete("/audit/documents/:id", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["audit", "settings"]);
    const row = await one<{ id: string; title: string; uploaded_by: number | null }>(deps.db, `SELECT id, title, uploaded_by FROM ims_documents WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: req.params.id });
    if (!row) throw notFound("Document");
    if (row.uploaded_by !== null && Number(row.uploaded_by) !== actor.userId && accessOf(res).role !== "owner" && !can(res, "settings")) throw forbidden("Only the uploader or an owner can delete this document");
    await exec(deps.db, `DELETE FROM ims_documents WHERE tenant_id = :tenantId AND id = :id`, { tenantId: actor.tenantId, id: row.id });
    await recordEvent(deps, actor, { type: "audit.document.deleted", entityType: "document", entityId: row.id, summary: `Deleted document “${row.title}”`, ip: req.ip });
    res.status(204).end();
  });
}

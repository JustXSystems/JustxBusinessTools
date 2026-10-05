import type { Router } from "express";
import { z } from "zod";
import { actorOf, isoDate, parse, type BosDeps } from "./context.js";
import { money, rows } from "./db.js";
import { BosError, forbidden, isManager } from "./host.js";
import {
  attendanceSummary,
  countLeaveDays,
  daysBetween,
  fiscalYearLabel,
  fiscalYearStart,
  LEAVE_TYPES,
  monthEndISO,
  monthsBetween,
  profitAndLoss,
  round2,
  todayISO,
  type LeaveType,
} from "./logic.js";
import { getSettings } from "./workspace.js";

/** Registers list at most this many rows; totals always cover the whole period. */
const REGISTER_LIMIT = 2000;
const MAX_RANGE_DAYS = 366 * 3;

const managerOnly = (actor: Parameters<typeof isManager>[0]) => {
  if (!isManager(actor)) throw forbidden("Reports are available to owners and admins");
};

const sumsByMonth = (list: ReadonlyArray<{ ym: string; total: string | number | null }>) => new Map(list.map((r) => [r.ym, money(r.total)]));

export function registerReports(router: Router, deps: BosDeps): void {
  router.get("/reports/finance", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const { from, to } = parse(z.object({ from: isoDate, to: isoDate }), req.query);
    if (to < from) throw new BosError(400, "The end date can't be before the start date");
    if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new BosError(400, "Pick a period of three years or less");
    const p = { t: actor.tenantId, from, to };

    const [salesByMonth, purchasesByMonth, expensesByMonth, payrollByMonth, sales, purchases, expenses, byCategory] = await Promise.all([
      rows<{ ym: string; total: string | number }>(
        deps.db,
        `SELECT DATE_FORMAT(issue_date, '%Y-%m') AS ym, SUM(subtotal - discount_total) AS total FROM bos_invoices
         WHERE tenant_id = :t AND status NOT IN ('draft','void') AND issue_date BETWEEN :from AND :to GROUP BY ym`,
        p,
      ),
      rows<{ ym: string; total: string | number }>(
        deps.db,
        `SELECT DATE_FORMAT(bill_date, '%Y-%m') AS ym, SUM(amount) AS total FROM bos_bills
         WHERE tenant_id = :t AND status IN ('approved','paid') AND bill_date BETWEEN :from AND :to GROUP BY ym`,
        p,
      ),
      rows<{ ym: string; total: string | number }>(
        deps.db,
        `SELECT DATE_FORMAT(spent_on, '%Y-%m') AS ym, SUM(amount) AS total FROM bos_expenses
         WHERE tenant_id = :t AND status IN ('approved','reimbursed') AND spent_on BETWEEN :from AND :to GROUP BY ym`,
        p,
      ),
      rows<{ ym: string; total: string | number }>(
        deps.db,
        `SELECT period AS ym, SUM(gross_total + employer_total) AS total FROM bos_payroll_runs
         WHERE tenant_id = :t AND status IN ('finalized','paid') AND period BETWEEN :fromMonth AND :toMonth GROUP BY period`,
        { t: actor.tenantId, fromMonth: from.slice(0, 7), toMonth: to.slice(0, 7) },
      ),
      rows<Record<string, string | number | null>>(
        deps.db,
        `SELECT id, invoice_no, issue_date, party_name, party_gstin, place_of_supply, subtotal, discount_total, cgst, sgst, igst, grand_total, amount_paid, status
         FROM bos_invoices WHERE tenant_id = :t AND status NOT IN ('draft','void') AND issue_date BETWEEN :from AND :to
         ORDER BY issue_date, invoice_no LIMIT ${REGISTER_LIMIT + 1}`,
        p,
      ),
      rows<Record<string, string | number | null>>(
        deps.db,
        `SELECT id, bill_no, bill_date, party_name, category, amount, tax_amount, total, status
         FROM bos_bills WHERE tenant_id = :t AND status IN ('approved','paid') AND bill_date BETWEEN :from AND :to
         ORDER BY bill_date, created_at LIMIT ${REGISTER_LIMIT + 1}`,
        p,
      ),
      rows<Record<string, string | number | null>>(
        deps.db,
        `SELECT id, spent_on, claimant_name, category, description, amount, status
         FROM bos_expenses WHERE tenant_id = :t AND status IN ('approved','reimbursed') AND spent_on BETWEEN :from AND :to
         ORDER BY spent_on, created_at LIMIT ${REGISTER_LIMIT + 1}`,
        p,
      ),
      rows<{ category: string; total: string | number }>(
        deps.db,
        `SELECT category, SUM(amount) AS total FROM bos_expenses
         WHERE tenant_id = :t AND status IN ('approved','reimbursed') AND spent_on BETWEEN :from AND :to GROUP BY category ORDER BY total DESC`,
        p,
      ),
    ]);

    const pnl = profitAndLoss(monthsBetween(from, to), {
      sales: sumsByMonth(salesByMonth),
      purchases: sumsByMonth(purchasesByMonth),
      expenses: sumsByMonth(expensesByMonth),
      payroll: sumsByMonth(payrollByMonth),
    });
    const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

    res.json({
      from,
      to,
      pnl,
      expenseByCategory: byCategory.map((c) => ({ category: c.category, total: money(c.total) })),
      sales: {
        truncated: sales.length > REGISTER_LIMIT,
        rows: sales.slice(0, REGISTER_LIMIT).map((r) => ({
          id: String(r.id),
          invoiceNo: String(r.invoice_no),
          date: String(r.issue_date),
          partyName: String(r.party_name),
          partyGstin: s(r.party_gstin),
          placeOfSupply: s(r.place_of_supply),
          taxable: round2(money(r.subtotal) - money(r.discount_total)),
          cgst: money(r.cgst),
          sgst: money(r.sgst),
          igst: money(r.igst),
          total: money(r.grand_total),
          balance: Math.max(0, round2(money(r.grand_total) - money(r.amount_paid))),
          status: String(r.status),
        })),
      },
      purchases: {
        truncated: purchases.length > REGISTER_LIMIT,
        rows: purchases.slice(0, REGISTER_LIMIT).map((r) => ({
          id: String(r.id),
          billNo: s(r.bill_no),
          date: String(r.bill_date),
          partyName: String(r.party_name),
          category: s(r.category),
          amount: money(r.amount),
          tax: money(r.tax_amount),
          total: money(r.total),
          status: String(r.status),
        })),
      },
      expenses: {
        truncated: expenses.length > REGISTER_LIMIT,
        rows: expenses.slice(0, REGISTER_LIMIT).map((r) => ({
          id: String(r.id),
          date: String(r.spent_on),
          claimant: s(r.claimant_name),
          category: String(r.category),
          description: s(r.description),
          amount: money(r.amount),
          status: String(r.status),
        })),
      },
    });
  });

  router.get("/reports/hr", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const today = todayISO();
    const month = typeof req.query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month) ? req.query.month : today.slice(0, 7);
    if (month > today.slice(0, 7)) throw new BosError(400, "Pick this month or an earlier one");
    const start = `${month}-01`;
    const end = monthEndISO(month);
    const upTo = end < today ? end : today;
    const settings = await getSettings(deps, actor.tenantId);
    const fyFrom = fiscalYearStart(end, settings.fiscalYearStart);
    const t = actor.tenantId;

    const [employees, attendance, holidays, leave] = await Promise.all([
      rows<{ id: string; emp_code: string; first_name: string; last_name: string | null; status: string; join_date: string; exit_date: string | null; department_name: string | null }>(
        deps.db,
        `SELECT e.id, e.emp_code, e.first_name, e.last_name, e.status, e.join_date, e.exit_date, d.name AS department_name
         FROM bos_employees e LEFT JOIN bos_departments d ON d.id = e.department_id
         WHERE e.tenant_id = :t AND e.join_date <= :end AND (e.exit_date >= :start OR (e.exit_date IS NULL AND e.status <> 'exited'))
         ORDER BY e.first_name, e.last_name`,
        { t, start, end },
      ),
      rows<{ employee_id: string; status: string; n: number }>(
        deps.db,
        `SELECT employee_id, status, COUNT(*) AS n FROM bos_attendance WHERE tenant_id = :t AND work_date BETWEEN :start AND :upTo GROUP BY employee_id, status`,
        { t, start, upTo },
      ),
      rows<{ holiday_date: string }>(deps.db, `SELECT holiday_date FROM bos_holidays WHERE tenant_id = :t AND holiday_date BETWEEN :start AND :end`, { t, start, end }),
      rows<{ employee_id: string; leave_type: string; days: string | number }>(
        deps.db,
        `SELECT employee_id, leave_type, SUM(days) AS days FROM bos_leave_requests
         WHERE tenant_id = :t AND status = 'approved' AND from_date BETWEEN :fyFrom AND :end GROUP BY employee_id, leave_type`,
        { t, fyFrom, end },
      ),
    ]);

    const holidaySet = new Set(holidays.map((h) => h.holiday_date));
    const workingDays = (from: string, to: string) => (to < from ? 0 : countLeaveDays(from, to, { weekendDays: settings.weekendDays, holidays: holidaySet }));
    const counts = new Map<string, Record<string, number>>();
    for (const a of attendance) counts.set(a.employee_id, { ...(counts.get(a.employee_id) ?? {}), [a.status]: Number(a.n) });
    const used = new Map<string, Partial<Record<LeaveType, number>>>();
    for (const l of leave) used.set(l.employee_id, { ...(used.get(l.employee_id) ?? {}), [l.leave_type]: money(l.days) });

    const list = employees.map((e) => {
      const from = e.join_date > start ? e.join_date : start;
      const lastDay = e.exit_date && e.exit_date < upTo ? e.exit_date : upTo;
      const days = workingDays(from, lastDay);
      const leaveUsed = Object.fromEntries(LEAVE_TYPES.map((k) => [k, used.get(e.id)?.[k] ?? 0])) as Record<LeaveType, number>;
      return {
        employeeId: e.id,
        empCode: e.emp_code,
        name: [e.first_name, e.last_name].filter(Boolean).join(" "),
        departmentName: e.department_name,
        workingDays: days,
        ...attendanceSummary(counts.get(e.id) ?? {}, days),
        leaveUsed,
      };
    });

    const inMonth = (d: string | null) => Boolean(d && d >= start && d <= end);
    const atMonthEnd = (e: (typeof employees)[number]) => !e.exit_date || e.exit_date > end;
    const departments = new Map<string, { name: string; headcount: number; joiners: number; exits: number }>();
    for (const e of employees) {
      const name = e.department_name ?? "Unassigned";
      const d = departments.get(name) ?? { name, headcount: 0, joiners: 0, exits: 0 };
      if (atMonthEnd(e)) d.headcount += 1;
      if (inMonth(e.join_date)) d.joiners += 1;
      if (inMonth(e.exit_date)) d.exits += 1;
      departments.set(name, d);
    }
    const tracked = list.filter((e) => e.workingDays > 0);

    res.json({
      month,
      from: start,
      to: upTo,
      workingDays: workingDays(start, upTo),
      fiscalYear: fiscalYearLabel(end, settings.fiscalYearStart),
      leavePolicy: settings.leavePolicy,
      totals: {
        headcount: employees.filter(atMonthEnd).length,
        joiners: employees.filter((e) => inMonth(e.join_date)).length,
        exits: employees.filter((e) => inMonth(e.exit_date)).length,
        attendancePct: tracked.length ? Math.round(tracked.reduce((s, e) => s + e.attendancePct, 0) / tracked.length) : 0,
      },
      employees: list,
      departments: [...departments.values()].sort((a, b) => b.headcount - a.headcount || a.name.localeCompare(b.name)),
    });
  });
}

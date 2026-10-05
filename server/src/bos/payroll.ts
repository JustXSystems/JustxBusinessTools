import type { Router } from "express";
import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { z } from "zod";
import { actorOf, isoDate, optText, parse, recordEvent, type BosDeps, type BosEventInput } from "./context.js";
import { exec, json, money, one, rows, tx } from "./db.js";
import { BosError, forbidden, isManager, notFound, type BosActor } from "./host.js";
import { employeeForActor } from "./hr.js";
import { addDaysISO, countLeaveDays, daysBetween, eachDate, monthEndISO, round2, todayISO, weekdayOf } from "./logic.js";
import {
  annualTaxNewRegime,
  computePayslip,
  lossOfPayDays,
  normalizePayrollConfig,
  structureFromCtc,
  type PayrollConfig,
  type PayslipLine,
} from "./payroll-logic.js";
import { getSettings } from "./workspace.js";

export const RUN_STATUSES = ["draft", "finalized", "paid"] as const;
type RunStatus = (typeof RUN_STATUSES)[number];
/** Employees see a payslip once its run is no longer a draft. */
const RELEASED = `('finalized','paid')`;

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const fullName = (first: string | null | undefined, last: string | null | undefined) => [first, last].filter(Boolean).join(" ");
const periodLabel = (period: string) => new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

const managerOnly = (actor: BosActor) => {
  if (!isManager(actor)) throw forbidden("Payroll is available to owners and admins");
};

/* ---------- Inputs ---------- */

const ConfigInput = z.object({
  basicPct: z.coerce.number().min(10, "At least 10%").max(100),
  hraPct: z.coerce.number().min(0).max(100),
  pfEnabled: z.boolean(),
  pfCapWage: z.boolean(),
  esiEnabled: z.boolean(),
  ptSlabs: z.array(z.object({ from: z.coerce.number().min(0).max(1e8), amount: z.coerce.number().min(0).max(100000) })).max(12),
  unmarkedPaid: z.boolean(),
});

const blankable = (schema: z.ZodString) => schema.nullable().optional().or(z.literal(""));
const amount = z.coerce.number().min(0).max(1e8);

const StructureInput = z
  .object({
    basic: amount,
    hra: amount,
    special: amount,
    pf: z.boolean().default(true),
    pt: z.boolean().default(true),
    tdsMonthly: amount.nullable().optional(),
    pan: blankable(z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Enter a valid PAN (ABCDE1234F)")),
    uan: blankable(z.string().trim().regex(/^\d{12}$/, "UAN is 12 digits")),
    pfNumber: optText(40),
    esiNumber: optText(20),
  })
  .refine((s) => s.basic + s.hra + s.special > 0, { message: "Enter at least one salary component", path: ["basic"] });

const AdjustInput = z.object({
  bonus: amount.optional(),
  otherDeduction: amount.optional(),
  tdsOverride: amount.nullable().optional(),
  lopDays: z.coerce.number().min(0).max(31).nullable().optional(),
  note: optText(200),
});
type Adjustments = { bonus?: number; otherDeduction?: number; tdsOverride?: number | null; lopDays?: number | null; note?: string | null };

/* ---------- Rows ---------- */

type RunRow = {
  id: string;
  period: string;
  status: RunStatus;
  employee_count: number;
  gross_total: string | number;
  deduction_total: string | number;
  net_total: string | number;
  employer_total: string | number;
  paid_on: string | null;
  calculated_at: string | null;
  finalized_at: string | null;
  created_at: string;
};

const mapRun = (r: RunRow) => ({
  id: r.id,
  period: r.period,
  status: r.status,
  employeeCount: Number(r.employee_count),
  grossTotal: money(r.gross_total),
  deductionTotal: money(r.deduction_total),
  netTotal: money(r.net_total),
  employerTotal: money(r.employer_total),
  paidOn: r.paid_on,
  calculatedAt: r.calculated_at,
  finalizedAt: r.finalized_at,
  createdAt: r.created_at,
});

type PayslipRow = {
  id: string;
  run_id: string;
  employee_id: string;
  emp_code: string;
  employee_name: string;
  designation: string | null;
  department_name: string | null;
  days_in_month: number;
  paid_days: string | number;
  lop_days: string | number;
  attendance: unknown;
  earnings: unknown;
  deductions: unknown;
  employer: unknown;
  adjustments: unknown;
  statutory: unknown;
  gross: string | number;
  total_deductions: string | number;
  net_pay: string | number;
  employer_cost: string | number;
  period?: string;
  status?: RunStatus;
  paid_on?: string | null;
};

type Attendance = { employedDays: number; absent: number; halfDay: number; lopLeave: number; unmarked: number; computedLop: number };
type Statutory = { pan: string | null; uan: string | null; pfNumber: string | null; esiNumber: string | null; pfWage: number; esiWage: number; tdsEstimated: boolean };

const mapPayslip = (r: PayslipRow) => ({
  id: r.id,
  runId: r.run_id,
  employeeId: r.employee_id,
  empCode: r.emp_code,
  name: r.employee_name,
  designation: r.designation,
  departmentName: r.department_name,
  daysInMonth: Number(r.days_in_month),
  paidDays: money(r.paid_days),
  lopDays: money(r.lop_days),
  attendance: json<Attendance | null>(r.attendance, null),
  earnings: json<PayslipLine[]>(r.earnings, []),
  deductions: json<PayslipLine[]>(r.deductions, []),
  employer: json<PayslipLine[]>(r.employer, []),
  adjustments: json<Adjustments>(r.adjustments, {}),
  statutory: json<Statutory | null>(r.statutory, null),
  gross: money(r.gross),
  totalDeductions: money(r.total_deductions),
  netPay: money(r.net_pay),
  employerCost: money(r.employer_cost),
  ...(r.period ? { period: r.period, runStatus: r.status, paidOn: r.paid_on ?? null } : {}),
});

type StructureRow = {
  basic: string | number;
  hra: string | number;
  special: string | number;
  pf_applicable: number;
  pt_applicable: number;
  tds_monthly: string | number | null;
  pan: string | null;
  uan: string | null;
  pf_number: string | null;
  esi_number: string | null;
  updated_at: string;
};

function mapStructure(r: StructureRow) {
  const basic = money(r.basic);
  const hra = money(r.hra);
  const special = money(r.special);
  const gross = round2(basic + hra + special);
  return {
    basic,
    hra,
    special,
    gross,
    pf: Boolean(r.pf_applicable),
    pt: Boolean(r.pt_applicable),
    tdsMonthly: r.tds_monthly === null ? null : money(r.tds_monthly),
    tdsEstimate: Math.round(annualTaxNewRegime(gross * 12) / 12),
    pan: r.pan,
    uan: r.uan,
    pfNumber: r.pf_number,
    esiNumber: r.esi_number,
    updatedAt: r.updated_at,
  };
}

/* ---------- Loaders ---------- */

async function loadConfig(deps: BosDeps, tenantId: number): Promise<{ config: PayrollConfig; saved: boolean; updatedAt: string | null }> {
  const row = await one<{ config: unknown; updated_at: string }>(deps.db, `SELECT config, updated_at FROM bos_payroll_settings WHERE tenant_id = :t`, { t: tenantId });
  return { config: normalizePayrollConfig(json(row?.config, {})), saved: Boolean(row), updatedAt: row?.updated_at ?? null };
}

async function loadRun(db: BosDeps["db"] | PoolConnection, tenantId: number, id: string, lock = false): Promise<RunRow> {
  const row = await one<RunRow>(db, `SELECT * FROM bos_payroll_runs WHERE id = :id AND tenant_id = :t${lock ? " FOR UPDATE" : ""}`, { id, t: tenantId });
  if (!row) throw notFound("Payroll run");
  return row;
}

const monthWindow = (period: string) => {
  const start = `${period}-01`;
  const end = monthEndISO(period);
  return { start, end, daysInMonth: daysBetween(start, end) + 1 };
};

/** Employees on the books at some point in the month (same rule as the HR report), with their structure if set. */
const ELIGIBLE_SQL = `
  SELECT e.id, e.emp_code, e.first_name, e.last_name, e.designation, e.join_date, e.exit_date, d.name AS department_name,
         s.employee_id AS has_structure, s.basic, s.hra, s.special, s.pf_applicable, s.pt_applicable, s.tds_monthly,
         s.pan, s.uan, s.pf_number, s.esi_number
  FROM bos_employees e
  LEFT JOIN bos_departments d ON d.id = e.department_id
  LEFT JOIN bos_salary_structures s ON s.employee_id = e.id AND s.tenant_id = e.tenant_id
  WHERE e.tenant_id = :t AND e.join_date <= :end AND (e.exit_date >= :start OR (e.exit_date IS NULL AND e.status <> 'exited'))
  ORDER BY e.first_name, e.last_name`;

type EligibleRow = StructureRow & {
  id: string;
  emp_code: string;
  first_name: string;
  last_name: string | null;
  designation: string | null;
  join_date: string;
  exit_date: string | null;
  department_name: string | null;
  has_structure: string | null;
};

async function eligible(db: BosDeps["db"] | PoolConnection, tenantId: number, period: string) {
  const { start, end } = monthWindow(period);
  const list = await rows<EligibleRow>(db, ELIGIBLE_SQL, { t: tenantId, start, end });
  return { ready: list.filter((e) => e.has_structure), missing: list.filter((e) => !e.has_structure).map((e) => ({ employeeId: e.id, empCode: e.emp_code, name: fullName(e.first_name, e.last_name) })) };
}

/**
 * (Re)computes every payslip of a draft run from current structures, attendance and LOP leave,
 * keeping each payslip's manual adjustments. Runs inside the caller's transaction.
 */
async function computeRun(deps: BosDeps, conn: PoolConnection, tenantId: number, run: RunRow): Promise<void> {
  const { config, saved } = await loadConfig(deps, tenantId);
  if (!saved) throw new BosError(409, "Review and save the payroll settings before running payroll");
  const settings = await getSettings(deps, tenantId);
  const { start, end, daysInMonth } = monthWindow(run.period);
  const today = todayISO();
  const t = tenantId;

  const [{ ready }, attendance, holidays, lopLeave, existing] = await Promise.all([
    eligible(conn, t, run.period),
    rows<{ employee_id: string; work_date: string; status: string; source: string }>(conn, `SELECT employee_id, work_date, status, source FROM bos_attendance WHERE tenant_id = :t AND work_date BETWEEN :start AND :end`, { t, start, end }),
    rows<{ holiday_date: string }>(conn, `SELECT holiday_date FROM bos_holidays WHERE tenant_id = :t AND holiday_date BETWEEN :start AND :end`, { t, start, end }),
    rows<{ employee_id: string; from_date: string; to_date: string; half_day: number }>(
      conn,
      `SELECT employee_id, from_date, to_date, half_day FROM bos_leave_requests
       WHERE tenant_id = :t AND status = 'approved' AND leave_type = 'lop' AND from_date <= :end AND to_date >= :start`,
      { t, start, end },
    ),
    rows<{ employee_id: string; adjustments: unknown }>(conn, `SELECT employee_id, adjustments FROM bos_payslips WHERE run_id = :id`, { id: run.id }),
  ]);

  const holidaySet = new Set(holidays.map((h) => h.holiday_date));
  const weekend = new Set(settings.weekendDays);
  const isWorkingDay = (d: string) => !weekend.has(weekdayOf(d)) && !holidaySet.has(d);
  const marks = new Map<string, Array<{ date: string; status: string; source: string }>>();
  for (const a of attendance) marks.set(a.employee_id, [...(marks.get(a.employee_id) ?? []), { date: a.work_date, status: a.status, source: a.source }]);
  const adjustmentsOf = new Map(existing.map((p) => [p.employee_id, json<Adjustments>(p.adjustments, {})]));

  let gross = 0;
  let deductions = 0;
  let net = 0;
  let employerExtra = 0;
  const keep: string[] = [];

  for (const e of ready) {
    const from = e.join_date > start ? e.join_date : start;
    const to = e.exit_date && e.exit_date < end ? e.exit_date : end;
    if (to < from) continue;
    const employedDays = daysBetween(from, to) + 1;
    const mine = (marks.get(e.id) ?? []).filter((m) => m.date >= from && m.date <= to);
    const markedDates = new Set(mine.map((m) => m.date));
    const unmarkedUpTo = to < today ? to : today;
    const counts = {
      absent: mine.filter((m) => m.status === "absent").length,
      halfDay: mine.filter((m) => m.status === "half_day" && m.source !== "leave").length,
      lopLeave: lopLeave
        .filter((l) => l.employee_id === e.id)
        .reduce((sum, l) => {
          const a = l.from_date > from ? l.from_date : from;
          const b = l.to_date < to ? l.to_date : to;
          return sum + (b < a ? 0 : countLeaveDays(a, b, { halfDay: Boolean(l.half_day), weekendDays: settings.weekendDays, holidays: holidaySet }));
        }, 0),
      unmarked: unmarkedUpTo < from ? 0 : eachDate(from, unmarkedUpTo).filter((d) => isWorkingDay(d) && !markedDates.has(d)).length,
    };
    const computedLop = Math.min(employedDays, lossOfPayDays(counts, config.unmarkedPaid));
    const adj = adjustmentsOf.get(e.id) ?? {};
    const lop = adj.lopDays !== null && adj.lopDays !== undefined ? Math.min(employedDays, adj.lopDays) : computedLop;
    const paidDays = round2(Math.max(0, employedDays - lop));
    const structure = mapStructure(e);
    const calc = computePayslip({
      structure: { basic: structure.basic, hra: structure.hra, special: structure.special, pf: structure.pf, pt: structure.pt, tdsMonthly: structure.tdsMonthly },
      config,
      daysInMonth,
      paidDays,
      bonus: adj.bonus,
      otherDeduction: adj.otherDeduction,
      tdsOverride: adj.tdsOverride,
    });
    const statutory: Statutory = { pan: e.pan, uan: e.uan, pfNumber: e.pf_number, esiNumber: e.esi_number, pfWage: calc.pfWage, esiWage: calc.esiWage, tdsEstimated: calc.tdsEstimated };
    const snapshot: Attendance = { employedDays, ...counts, computedLop };
    await exec(
      conn,
      `INSERT INTO bos_payslips (id, tenant_id, run_id, employee_id, emp_code, employee_name, designation, department_name, days_in_month, paid_days, lop_days,
         attendance, earnings, deductions, employer, adjustments, statutory, gross, total_deductions, net_pay, employer_cost)
       VALUES (:id, :t, :runId, :employeeId, :empCode, :name, :designation, :department, :daysInMonth, :paidDays, :lopDays,
         :attendance, :earnings, :deductions, :employer, :adjustments, :statutory, :gross, :totalDeductions, :netPay, :employerCost)
       ON DUPLICATE KEY UPDATE emp_code = VALUES(emp_code), employee_name = VALUES(employee_name), designation = VALUES(designation),
         department_name = VALUES(department_name), days_in_month = VALUES(days_in_month), paid_days = VALUES(paid_days), lop_days = VALUES(lop_days),
         attendance = VALUES(attendance), earnings = VALUES(earnings), deductions = VALUES(deductions), employer = VALUES(employer),
         statutory = VALUES(statutory), gross = VALUES(gross), total_deductions = VALUES(total_deductions), net_pay = VALUES(net_pay),
         employer_cost = VALUES(employer_cost)`,
      {
        id: randomUUID(),
        t,
        runId: run.id,
        employeeId: e.id,
        empCode: e.emp_code,
        name: fullName(e.first_name, e.last_name),
        designation: e.designation,
        department: e.department_name,
        daysInMonth,
        paidDays,
        lopDays: round2(employedDays - paidDays),
        attendance: JSON.stringify(snapshot),
        earnings: JSON.stringify(calc.earnings),
        deductions: JSON.stringify(calc.deductions),
        employer: JSON.stringify(calc.employer),
        adjustments: JSON.stringify(adj),
        statutory: JSON.stringify(statutory),
        gross: calc.gross,
        totalDeductions: calc.totalDeductions,
        netPay: calc.netPay,
        employerCost: calc.employerCost,
      },
    );
    keep.push(e.id);
    gross += calc.gross;
    deductions += calc.totalDeductions;
    net += calc.netPay;
    employerExtra += calc.employerCost - calc.gross;
  }

  if (keep.length) await exec(conn, `DELETE FROM bos_payslips WHERE run_id = :id AND employee_id NOT IN (:keep)`, { id: run.id, keep });
  else await exec(conn, `DELETE FROM bos_payslips WHERE run_id = :id`, { id: run.id });
  await exec(
    conn,
    `UPDATE bos_payroll_runs SET employee_count = :n, gross_total = :gross, deduction_total = :deductions, net_total = :net, employer_total = :employer,
       calculated_at = CURRENT_TIMESTAMP WHERE id = :id`,
    { n: keep.length, gross: round2(gross), deductions: round2(deductions), net: round2(net), employer: round2(employerExtra), id: run.id },
  );
}

/** Totals of each statutory line across a run's payslips. */
function statutoryTotals(slips: ReadonlyArray<ReturnType<typeof mapPayslip>>) {
  const sum = (pick: (p: ReturnType<typeof mapPayslip>) => PayslipLine[], key: string) => slips.reduce((s, p) => s + (pick(p).find((l) => l.key === key)?.amount ?? 0), 0);
  return {
    pfEmployee: sum((p) => p.deductions, "pf"),
    pfEmployer: sum((p) => p.employer, "pf"),
    esiEmployee: sum((p) => p.deductions, "esi"),
    esiEmployer: sum((p) => p.employer, "esi"),
    pt: sum((p) => p.deductions, "pt"),
    tds: sum((p) => p.deductions, "tds"),
  };
}

/** PF and ESI are due by the 15th, TDS by the 7th of the next month (30 April for March). */
function dueDates(period: string) {
  const next = addDaysISO(monthEndISO(period), 1).slice(0, 7);
  return { pfEsi: `${next}-15`, tds: period.endsWith("-03") ? `${period.slice(0, 4)}-04-30` : `${next}-07` };
}

const transition = async (conn: PoolConnection, id: string, from: RunStatus, to: RunStatus, extra = "", params: Record<string, unknown> = {}) => {
  const r = await exec(conn, `UPDATE bos_payroll_runs SET status = :to${extra} WHERE id = :id AND status = :from`, { id, from, to, ...params });
  if (!r.affectedRows) throw new BosError(409, "This payroll run changed in the meantime — reload and try again");
};

/** Marks a finalised run paid, inside the caller's transaction. */
export async function payPayrollRun(conn: PoolConnection, tenantId: number, runId: string, paidOn: string) {
  const run = await loadRun(conn, tenantId, runId, true);
  if (run.status !== "finalized") throw new BosError(409, run.status === "paid" ? "This run is already marked paid" : "Finalise the run before marking it paid");
  if (paidOn < `${run.period}-01`) throw new BosError(400, "The payment date can't be before the payroll month");
  await transition(conn, run.id, "finalized", "paid", ", paid_on = :paidOn", { paidOn });
  return mapRun(await loadRun(conn, tenantId, run.id));
}

export const payrollPaidEvent = (run: ReturnType<typeof mapRun>, ip?: string): BosEventInput => ({
  type: "payroll.pay",
  entityType: "payroll_run",
  entityId: run.id,
  summary: `Paid salaries for ${periodLabel(run.period)} · ${inr(run.netTotal)}`,
  notice: { kind: "workflow", title: `Salaries for ${periodLabel(run.period)} paid`, body: `${run.employeeCount} employees · ${inr(run.netTotal)}`, path: `?ws=finance&m=payroll&open=${run.id}`, dedupeKey: `bos-payroll-paid:${run.id}` },
  ip,
});

export function registerPayroll(router: Router, deps: BosDeps): void {
  /* ----- Settings ----- */

  router.get("/payroll/settings", async (_req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    res.json(await loadConfig(deps, actor.tenantId));
  });

  router.put("/payroll/settings", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const config = normalizePayrollConfig(parse(ConfigInput, req.body));
    await exec(
      deps.db,
      `INSERT INTO bos_payroll_settings (tenant_id, config, updated_by) VALUES (:t, :config, :userId)
       ON DUPLICATE KEY UPDATE config = VALUES(config), updated_by = VALUES(updated_by)`,
      { t: actor.tenantId, config: JSON.stringify(config), userId: actor.userId },
    );
    await recordEvent(deps, actor, { type: "payroll.settings", entityType: "payroll_settings", entityId: String(actor.tenantId), summary: "Updated payroll settings", payload: { ...config }, ip: req.ip });
    res.json(await loadConfig(deps, actor.tenantId));
  });

  /* ----- Salary structures ----- */

  router.get("/payroll/structures", async (_req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const { config, saved } = await loadConfig(deps, actor.tenantId);
    const since = `${addDaysISO(`${todayISO().slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
    const list = await rows<EligibleRow & { status: string; ctc_annual: string | number | null }>(
      deps.db,
      `SELECT e.id, e.emp_code, e.first_name, e.last_name, e.designation, e.status, e.join_date, e.exit_date, e.ctc_annual, d.name AS department_name,
              s.employee_id AS has_structure, s.basic, s.hra, s.special, s.pf_applicable, s.pt_applicable, s.tds_monthly, s.pan, s.uan, s.pf_number, s.esi_number, s.updated_at
       FROM bos_employees e
       LEFT JOIN bos_departments d ON d.id = e.department_id
       LEFT JOIN bos_salary_structures s ON s.employee_id = e.id AND s.tenant_id = e.tenant_id
       WHERE e.tenant_id = :t AND (e.status <> 'exited' OR e.exit_date >= :since)
       ORDER BY e.first_name, e.last_name LIMIT 5000`,
      { t: actor.tenantId, since },
    );
    res.json({
      config,
      settingsSaved: saved,
      employees: list.map((e) => {
        const ctc = e.ctc_annual === null ? null : money(e.ctc_annual);
        return {
          employeeId: e.id,
          empCode: e.emp_code,
          name: fullName(e.first_name, e.last_name),
          designation: e.designation,
          departmentName: e.department_name,
          status: e.status,
          joinDate: e.join_date,
          exitDate: e.exit_date,
          ctcAnnual: ctc,
          structure: e.has_structure ? mapStructure(e) : null,
          suggested: ctc ? structureFromCtc(ctc, config) : null,
        };
      }),
    });
  });

  router.put("/payroll/structures/:employeeId", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(StructureInput, req.body);
    const emp = await one<{ id: string; first_name: string; last_name: string | null }>(deps.db, `SELECT id, first_name, last_name FROM bos_employees WHERE id = :id AND tenant_id = :t`, { id: req.params.employeeId, t: actor.tenantId });
    if (!emp) throw notFound("Employee");
    await exec(
      deps.db,
      `INSERT INTO bos_salary_structures (tenant_id, employee_id, basic, hra, special, pf_applicable, pt_applicable, tds_monthly, pan, uan, pf_number, esi_number, updated_by)
       VALUES (:t, :employeeId, :basic, :hra, :special, :pf, :pt, :tdsMonthly, :pan, :uan, :pfNumber, :esiNumber, :userId)
       ON DUPLICATE KEY UPDATE basic = VALUES(basic), hra = VALUES(hra), special = VALUES(special), pf_applicable = VALUES(pf_applicable),
         pt_applicable = VALUES(pt_applicable), tds_monthly = VALUES(tds_monthly), pan = VALUES(pan), uan = VALUES(uan),
         pf_number = VALUES(pf_number), esi_number = VALUES(esi_number), updated_by = VALUES(updated_by)`,
      {
        t: actor.tenantId,
        employeeId: emp.id,
        basic: round2(input.basic),
        hra: round2(input.hra),
        special: round2(input.special),
        pf: input.pf ? 1 : 0,
        pt: input.pt ? 1 : 0,
        tdsMonthly: input.tdsMonthly ?? null,
        pan: input.pan || null,
        uan: input.uan || null,
        pfNumber: input.pfNumber || null,
        esiNumber: input.esiNumber || null,
        userId: actor.userId,
      },
    );
    await recordEvent(deps, actor, { type: "salary.update", entityType: "employee", entityId: emp.id, summary: `Updated the salary structure of ${fullName(emp.first_name, emp.last_name)}`, ip: req.ip });
    const row = await one<StructureRow>(deps.db, `SELECT * FROM bos_salary_structures WHERE tenant_id = :t AND employee_id = :id`, { t: actor.tenantId, id: emp.id });
    res.json({ structure: mapStructure(row!) });
  });

  /* ----- Overview & runs ----- */

  router.get("/payroll/overview", async (_req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const today = todayISO();
    const [{ saved, config }, { ready, missing }, runs] = await Promise.all([
      loadConfig(deps, actor.tenantId),
      eligible(deps.db, actor.tenantId, today.slice(0, 7)),
      rows<RunRow>(deps.db, `SELECT * FROM bos_payroll_runs WHERE tenant_id = :t ORDER BY period DESC LIMIT 60`, { t: actor.tenantId }),
    ]);
    const latest = runs.find((r) => r.status !== "draft") ?? null;
    let dues = null;
    if (latest) {
      const slips = (await rows<PayslipRow>(deps.db, `SELECT * FROM bos_payslips WHERE run_id = :id`, { id: latest.id })).map(mapPayslip);
      dues = { period: latest.period, ...statutoryTotals(slips), due: dueDates(latest.period) };
    }
    res.json({
      today,
      settingsSaved: saved,
      config,
      headcount: ready.length + missing.length,
      withStructure: ready.length,
      missing,
      runs: runs.map(mapRun),
      dues,
    });
  });

  router.get("/payroll/runs", async (_req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const list = await rows<RunRow>(deps.db, `SELECT * FROM bos_payroll_runs WHERE tenant_id = :t ORDER BY period DESC LIMIT 120`, { t: actor.tenantId });
    res.json({ runs: list.map(mapRun) });
  });

  router.post("/payroll/runs", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const { period } = parse(z.object({ period: z.string().regex(PERIOD_RE, "Pick a month") }), req.body);
    if (period > todayISO().slice(0, 7)) throw new BosError(400, "Payroll can't be run for a future month");
    const id = randomUUID();
    try {
      await tx(deps.db, async (conn) => {
        await exec(conn, `INSERT INTO bos_payroll_runs (id, tenant_id, period, created_by) VALUES (:id, :t, :period, :userId)`, { id, t: actor.tenantId, period, userId: actor.userId });
        await computeRun(deps, conn, actor.tenantId, await loadRun(conn, actor.tenantId, id, true));
      });
    } catch (err) {
      if ((err as { code?: string }).code === "ER_DUP_ENTRY") throw new BosError(409, `There is already a payroll run for ${periodLabel(period)}`);
      throw err;
    }
    const run = mapRun(await loadRun(deps.db, actor.tenantId, id));
    await recordEvent(deps, actor, { type: "payroll.create", entityType: "payroll_run", entityId: id, summary: `Started payroll for ${periodLabel(period)} · ${run.employeeCount} employees`, ip: req.ip });
    res.status(201).json({ run });
  });

  router.get("/payroll/runs/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const run = await loadRun(deps.db, actor.tenantId, req.params.id);
    const [slips, pending] = await Promise.all([
      rows<PayslipRow>(deps.db, `SELECT * FROM bos_payslips WHERE run_id = :id ORDER BY employee_name`, { id: run.id }),
      run.status === "draft" ? eligible(deps.db, actor.tenantId, run.period) : Promise.resolve(null),
    ]);
    const payslips = slips.map(mapPayslip);
    res.json({ run: mapRun(run), payslips, statutory: { ...statutoryTotals(payslips), due: dueDates(run.period) }, missing: pending?.missing ?? [] });
  });

  router.post("/payroll/runs/:id/recalculate", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    await tx(deps.db, async (conn) => {
      const run = await loadRun(conn, actor.tenantId, req.params.id, true);
      if (run.status !== "draft") throw new BosError(409, "Only a draft run can be recalculated — reopen it first");
      await computeRun(deps, conn, actor.tenantId, run);
    });
    res.json({ run: mapRun(await loadRun(deps.db, actor.tenantId, req.params.id)) });
  });

  router.post("/payroll/runs/:id/finalize", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const run = await tx(deps.db, async (conn) => {
      const r = await loadRun(conn, actor.tenantId, req.params.id, true);
      if (r.status !== "draft") throw new BosError(409, "This run is already finalised");
      if (!Number(r.employee_count)) throw new BosError(400, "There are no payslips to finalise — set up salary structures first");
      await transition(conn, r.id, "draft", "finalized", ", finalized_by = :userId, finalized_at = CURRENT_TIMESTAMP", { userId: actor.userId });
      return mapRun(await loadRun(conn, actor.tenantId, r.id));
    });
    await recordEvent(deps, actor, {
      type: "payroll.finalize",
      entityType: "payroll_run",
      entityId: run.id,
      summary: `Finalised payroll for ${periodLabel(run.period)} · net ${inr(run.netTotal)}`,
      notice: { kind: "workflow", title: `Payroll for ${periodLabel(run.period)} finalised`, body: `${run.employeeCount} payslips · net pay ${inr(run.netTotal)}`, path: `?ws=finance&m=payroll&open=${run.id}`, dedupeKey: `bos-payroll-final:${run.id}` },
      ip: req.ip,
    });
    res.json({ run });
  });

  router.post("/payroll/runs/:id/reopen", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const run = await loadRun(deps.db, actor.tenantId, req.params.id);
    if (run.status !== "finalized") throw new BosError(409, run.status === "paid" ? "A paid run can't be reopened" : "This run is already a draft");
    await tx(deps.db, (conn) => transition(conn, run.id, "finalized", "draft", ", finalized_by = NULL, finalized_at = NULL"));
    await recordEvent(deps, actor, { type: "payroll.reopen", entityType: "payroll_run", entityId: run.id, summary: `Reopened payroll for ${periodLabel(run.period)}`, ip: req.ip });
    res.json({ run: mapRun(await loadRun(deps.db, actor.tenantId, run.id)) });
  });

  router.post("/payroll/runs/:id/pay", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const { paidOn } = parse(z.object({ paidOn: isoDate }), req.body);
    const paid = await tx(deps.db, (conn) => payPayrollRun(conn, actor.tenantId, req.params.id, paidOn));
    await recordEvent(deps, actor, payrollPaidEvent(paid, req.ip));
    res.json({ run: paid });
  });

  router.delete("/payroll/runs/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const run = await loadRun(deps.db, actor.tenantId, req.params.id);
    if (run.status !== "draft") throw new BosError(409, "Only a draft run can be deleted");
    const r = await exec(deps.db, `DELETE FROM bos_payroll_runs WHERE id = :id AND tenant_id = :t AND status = 'draft'`, { id: run.id, t: actor.tenantId });
    if (!r.affectedRows) throw new BosError(409, "This payroll run changed in the meantime — reload and try again");
    await recordEvent(deps, actor, { type: "payroll.delete", entityType: "payroll_run", entityId: run.id, summary: `Deleted the draft payroll for ${periodLabel(run.period)}`, ip: req.ip });
    res.status(204).end();
  });

  router.get("/payroll/runs/:id/bank-advice", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const run = await loadRun(deps.db, actor.tenantId, req.params.id);
    if (run.status === "draft") throw new BosError(409, "Finalise the run before downloading the bank advice");
    const list = await rows<{ emp_code: string; employee_name: string; net_pay: string | number; bank: unknown }>(
      deps.db,
      `SELECT p.emp_code, p.employee_name, p.net_pay, e.bank FROM bos_payslips p LEFT JOIN bos_employees e ON e.id = p.employee_id
       WHERE p.run_id = :id AND p.net_pay > 0 ORDER BY p.employee_name`,
      { id: run.id },
    );
    await recordEvent(deps, actor, { type: "payroll.bank_advice", entityType: "payroll_run", entityId: run.id, summary: `Downloaded the bank advice for ${periodLabel(run.period)}`, ip: req.ip });
    res.json({
      period: run.period,
      rows: list.map((r) => {
        const bank = json<{ name?: string; holder?: string; account?: string; ifsc?: string }>(r.bank, {});
        return { empCode: r.emp_code, name: r.employee_name, holder: bank.holder || r.employee_name, account: String(bank.account ?? "").replace(/\s+/g, ""), ifsc: bank.ifsc ?? "", bankName: bank.name ?? "", amount: money(r.net_pay) };
      }),
    });
  });

  /* ----- Payslips ----- */

  router.patch("/payroll/payslips/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(AdjustInput, req.body);
    await tx(deps.db, async (conn) => {
      const slip = await one<{ run_id: string; adjustments: unknown }>(conn, `SELECT run_id, adjustments FROM bos_payslips WHERE id = :id AND tenant_id = :t`, { id: req.params.id, t: actor.tenantId });
      if (!slip) throw notFound("Payslip");
      const run = await loadRun(conn, actor.tenantId, slip.run_id, true);
      if (run.status !== "draft") throw new BosError(409, "Reopen the run to change a payslip");
      const next: Adjustments = { ...json<Adjustments>(slip.adjustments, {}), ...input };
      await exec(conn, `UPDATE bos_payslips SET adjustments = :adj WHERE id = :id`, { adj: JSON.stringify(next), id: req.params.id });
      await computeRun(deps, conn, actor.tenantId, run);
    });
    const row = await one<PayslipRow>(deps.db, `SELECT * FROM bos_payslips WHERE id = :id`, { id: req.params.id });
    if (!row) throw notFound("Payslip");
    await recordEvent(deps, actor, { type: "payslip.adjust", entityType: "payroll_run", entityId: row.run_id, summary: `Adjusted the payslip of ${row.employee_name}`, payload: { fields: Object.keys(input) }, ip: req.ip });
    res.json({ payslip: mapPayslip(row) });
  });

  router.get("/payroll/payslips/:id", async (req, res) => {
    const actor = actorOf(res);
    const row = await one<PayslipRow & { user_id: number | null }>(
      deps.db,
      `SELECT p.*, r.period, r.status, r.paid_on, e.user_id FROM bos_payslips p
       JOIN bos_payroll_runs r ON r.id = p.run_id LEFT JOIN bos_employees e ON e.id = p.employee_id
       WHERE p.id = :id AND p.tenant_id = :t`,
      { id: req.params.id, t: actor.tenantId },
    );
    if (!row) throw notFound("Payslip");
    const isSelf = Boolean(actor.userId && row.user_id === actor.userId);
    if (!isManager(actor) && !(isSelf && row.status !== "draft")) throw notFound("Payslip");
    res.json({ payslip: mapPayslip(row) });
  });

  const releasedFor = (tenantId: number, employeeId: string) =>
    rows<PayslipRow>(
      deps.db,
      `SELECT p.*, r.period, r.status, r.paid_on FROM bos_payslips p JOIN bos_payroll_runs r ON r.id = p.run_id
       WHERE p.tenant_id = :t AND p.employee_id = :employeeId AND r.status IN ${RELEASED} ORDER BY r.period DESC LIMIT 36`,
      { t: tenantId, employeeId },
    );

  router.get("/payroll/employees/:employeeId/payslips", async (req, res) => {
    const actor = actorOf(res);
    const emp = await one<{ id: string; user_id: number | null }>(deps.db, `SELECT id, user_id FROM bos_employees WHERE id = :id AND tenant_id = :t`, { id: req.params.employeeId, t: actor.tenantId });
    if (!emp) throw notFound("Employee");
    const isSelf = Boolean(actor.userId && emp.user_id === actor.userId);
    if (!isManager(actor) && !isSelf) throw forbidden("Payslips are visible to the employee and to owners and admins");
    const [slips, structure] = await Promise.all([
      releasedFor(actor.tenantId, emp.id),
      one<StructureRow>(deps.db, `SELECT * FROM bos_salary_structures WHERE tenant_id = :t AND employee_id = :id`, { t: actor.tenantId, id: emp.id }),
    ]);
    res.json({ structure: structure ? mapStructure(structure) : null, payslips: slips.map(mapPayslip) });
  });

  router.get("/payroll/me", async (_req, res) => {
    const actor = actorOf(res);
    const me = await employeeForActor(deps, actor);
    if (!me) {
      res.json({ employeeId: null, payslips: [] });
      return;
    }
    res.json({ employeeId: me.id, payslips: (await releasedFor(actor.tenantId, me.id)).map(mapPayslip) });
  });
}

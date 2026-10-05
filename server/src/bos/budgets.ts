import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  attributeSpend,
  BUDGET_BASES,
  COMPANY_LABEL,
  evaluateHead,
  fyEnd,
  fyMonths,
  HEAD_KINDS,
  headId,
  headKey,
  normaliseMonths,
  PAYROLL_LABEL,
  seedMonths,
  sumMonths,
  type ActualsBook,
  type BudgetBasis,
  type HeadKind,
} from "./budget-logic.js";
import { actorOf, optText, parse, recordEvent, type BosDeps } from "./context.js";
import { exec, money, one, rows, tx } from "./db.js";
import { EXPENSE_CATEGORIES } from "./finance.js";
import { BosError, forbidden, isManager, notFound, type BosActor } from "./host.js";
import { fiscalYearLabel, fiscalYearStart, round2, todayISO } from "./logic.js";
import { getSettings } from "./workspace.js";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const managerOnly = (actor: BosActor) => {
  if (!isManager(actor)) throw forbidden("Budgets are available to owners and admins");
};

/* ---------- Inputs ---------- */

const months = z.array(z.coerce.number().min(0, "Budgets can't be negative").max(1e11, "Amount is too large")).length(12, "Enter twelve months");

const CreateInput = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  basis: z.enum(BUDGET_BASES).default("category"),
  name: optText(120),
  seed: z.enum(["blank", "actuals", "budget"]).default("blank"),
  uplift: z.coerce.number().min(-90).max(500).default(0),
});
const BudgetPatch = z.object({ name: z.string().trim().min(1, "Required").max(120).optional(), notes: optText(500) });
const LineInput = z.object({
  kind: z.enum(["category", "payroll", "department", "company"]),
  name: z.string().trim().max(80).optional(),
  departmentId: z.string().max(36).optional(),
  months,
  note: optText(300),
});
const LinePatch = z.object({ months: months.optional(), note: optText(300) });

/* ---------- Rows ---------- */

type BudgetRow = {
  id: string;
  fy_start: string;
  basis: BudgetBasis;
  name: string;
  notes: string | null;
  updated_at: string;
  annual?: string | number | null;
  line_count?: string | number | null;
};
type LineRow = { id: string; budget_id: string; kind: HeadKind; head_key: string; label: string; months: unknown; annual: string | number; note: string | null };

const BUDGET_SELECT = `
  SELECT b.*,
    (SELECT COALESCE(SUM(l.annual), 0) FROM bos_budget_lines l WHERE l.budget_id = b.id) AS annual,
    (SELECT COUNT(*) FROM bos_budget_lines l WHERE l.budget_id = b.id) AS line_count
  FROM bos_budgets b`;

const fyStartMonth = (fyStart: string) => Number(fyStart.slice(5, 7));
const fyLabel = (fyStart: string) => `FY ${fiscalYearLabel(fyStart, fyStartMonth(fyStart))}`;

const mapBudget = (r: BudgetRow) => ({
  id: r.id,
  year: Number(r.fy_start.slice(0, 4)),
  fyStart: r.fy_start,
  fyEnd: fyEnd(r.fy_start),
  fyLabel: fyLabel(r.fy_start),
  basis: r.basis,
  name: r.name,
  notes: r.notes,
  annual: money(r.annual),
  lineCount: Number(r.line_count ?? 0),
  updatedAt: r.updated_at,
});

async function loadBudget(db: BosDeps["db"], tenantId: number, id: string): Promise<BudgetRow> {
  const row = await one<BudgetRow>(db, `${BUDGET_SELECT} WHERE b.id = :id AND b.tenant_id = :t`, { id, t: tenantId });
  if (!row) throw notFound("Budget");
  return row;
}

async function loadLine(db: BosDeps["db"], budgetId: string, lineId: string): Promise<LineRow> {
  const row = await one<LineRow>(db, `SELECT * FROM bos_budget_lines WHERE id = :id AND budget_id = :b`, { id: lineId, b: budgetId });
  if (!row) throw notFound("Budget line");
  return row;
}

const touch = (db: BosDeps["db"], id: string) => exec(db, `UPDATE bos_budgets SET updated_at = CURRENT_TIMESTAMP WHERE id = :id`, { id });

/* ---------- Actual spend ---------- */

type Department = { id: string; name: string };

const departmentsOf = (db: BosDeps["db"], tenantId: number) => rows<Department>(db, `SELECT id, name FROM bos_departments WHERE tenant_id = :t ORDER BY name`, { t: tenantId });

/** Spend in one financial year on the same accrual rules as profit & loss, attributed to heads for `basis`. */
async function actualsFor(db: BosDeps["db"], tenantId: number, basis: BudgetBasis, fyStart: string, departments: ReadonlyArray<Department>): Promise<ActualsBook> {
  const p = { t: tenantId, from: fyStart, to: fyEnd(fyStart), fromMonth: fyStart.slice(0, 7), toMonth: fyEnd(fyStart).slice(0, 7) };
  const [bills, expenses, payroll] = await Promise.all([
    rows<{ ym: string; category: string | null; amount: string | number }>(
      db,
      `SELECT DATE_FORMAT(bill_date, '%Y-%m') AS ym, category, SUM(amount) AS amount FROM bos_bills
       WHERE tenant_id = :t AND status IN ('approved','paid') AND bill_date BETWEEN :from AND :to GROUP BY ym, category`,
      p,
    ),
    rows<{ ym: string; category: string; department_id: string | null; amount: string | number }>(
      db,
      `SELECT DATE_FORMAT(x.spent_on, '%Y-%m') AS ym, x.category, e.department_id, SUM(x.amount) AS amount
       FROM bos_expenses x LEFT JOIN bos_employees e ON e.id = x.employee_id AND e.tenant_id = x.tenant_id
       WHERE x.tenant_id = :t AND x.status IN ('approved','reimbursed') AND x.spent_on BETWEEN :from AND :to
       GROUP BY ym, x.category, e.department_id`,
      p,
    ),
    basis === "category"
      ? rows<{ ym: string; department_name: null; amount: string | number }>(
          db,
          `SELECT period AS ym, NULL AS department_name, SUM(gross_total + employer_total) AS amount FROM bos_payroll_runs
           WHERE tenant_id = :t AND status IN ('finalized','paid') AND period BETWEEN :fromMonth AND :toMonth GROUP BY period`,
          p,
        )
      : rows<{ ym: string; department_name: string | null; amount: string | number }>(
          db,
          `SELECT r.period AS ym, s.department_name, SUM(s.employer_cost) AS amount
           FROM bos_payslips s JOIN bos_payroll_runs r ON r.id = s.run_id
           WHERE r.tenant_id = :t AND r.status IN ('finalized','paid') AND r.period BETWEEN :fromMonth AND :toMonth
           GROUP BY r.period, s.department_name`,
          p,
        ),
  ]);
  return attributeSpend(
    basis,
    fyStart,
    {
      bills: bills.map((b) => ({ ym: b.ym, category: b.category, amount: money(b.amount) })),
      expenses: expenses.map((e) => ({ ym: e.ym, category: e.category, departmentId: e.department_id, amount: money(e.amount) })),
      payroll: payroll.map((r) => ({ ym: r.ym, departmentName: r.department_name, amount: money(r.amount) })),
    },
    departments,
  );
}

const previousFy = (fyStart: string) => `${Number(fyStart.slice(0, 4)) - 1}${fyStart.slice(4)}`;

/* ---------- Routes ---------- */

export function registerBudgets(router: Router, deps: BosDeps): void {
  router.get("/budgets", async (_req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const today = todayISO();
    const settings = await getSettings(deps, actor.tenantId);
    const list = await rows<BudgetRow>(deps.db, `${BUDGET_SELECT} WHERE b.tenant_id = :t ORDER BY b.fy_start DESC, b.basis`, { t: actor.tenantId });
    res.json({
      today,
      fiscalYearStart: settings.fiscalYearStart,
      currentYear: Number(fiscalYearStart(today, settings.fiscalYearStart).slice(0, 4)),
      budgets: list.map(mapBudget),
    });
  });

  router.post("/budgets", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(CreateInput, req.body);
    const settings = await getSettings(deps, actor.tenantId);
    const currentYear = Number(fiscalYearStart(todayISO(), settings.fiscalYearStart).slice(0, 4));
    if (input.year < currentYear - 5 || input.year > currentYear + 1) throw new BosError(400, `Pick a financial year from ${currentYear - 5} to ${currentYear + 1}`);
    const fyStart = `${input.year}-${String(settings.fiscalYearStart).padStart(2, "0")}-01`;
    const t = actor.tenantId;
    if (await one(deps.db, `SELECT id FROM bos_budgets WHERE tenant_id = :t AND fy_start = :fyStart AND basis = :basis`, { t, fyStart, basis: input.basis })) {
      throw new BosError(409, `There's already a ${input.basis} budget for ${fyLabel(fyStart)}`);
    }

    type Seed = { kind: HeadKind; key: string; label: string; months: number[]; note: string | null };
    let seeds: Seed[] = [];
    const lastYear = previousFy(fyStart);
    if (input.seed === "actuals") {
      const book = await actualsFor(deps.db, t, input.basis, lastYear, await departmentsOf(deps.db, t));
      seeds = [...book.heads.values()].map((h) => ({ kind: h.kind, key: h.key, label: h.label, months: seedMonths(h.months, input.uplift), note: null })).filter((s) => sumMonths(s.months) > 0);
    } else if (input.seed === "budget") {
      const prev = await one<{ id: string }>(deps.db, `SELECT id FROM bos_budgets WHERE tenant_id = :t AND fy_start = :lastYear AND basis = :basis`, { t, lastYear, basis: input.basis });
      if (!prev) throw new BosError(409, `There's no ${input.basis} budget for ${fyLabel(lastYear)} to copy`);
      const lines = await rows<LineRow>(deps.db, `SELECT * FROM bos_budget_lines WHERE budget_id = :id`, { id: prev.id });
      seeds = lines.map((l) => ({ kind: l.kind, key: l.head_key, label: l.label, months: seedMonths(normaliseMonths(l.months), input.uplift), note: l.note }));
    }

    const id = randomUUID();
    const name = input.name?.trim() || `${fyLabel(fyStart)} budget`;
    await tx(deps.db, async (conn) => {
      await exec(conn, `INSERT INTO bos_budgets (id, tenant_id, fy_start, basis, name, created_by) VALUES (:id, :t, :fyStart, :basis, :name, :userId)`, {
        id,
        t,
        fyStart,
        basis: input.basis,
        name,
        userId: actor.userId,
      });
      for (const s of seeds) {
        await exec(
          conn,
          `INSERT INTO bos_budget_lines (id, tenant_id, budget_id, kind, head_key, label, months, annual, note)
           VALUES (:lineId, :t, :id, :kind, :key, :label, :months, :annual, :note)`,
          { lineId: randomUUID(), t, id, kind: s.kind, key: s.key, label: s.label, months: JSON.stringify(s.months), annual: sumMonths(s.months), note: s.note },
        );
      }
    });
    const how = input.seed === "actuals" ? ` from ${fyLabel(lastYear)} actual spend` : input.seed === "budget" ? ` from the ${fyLabel(lastYear)} budget` : "";
    await recordEvent(deps, actor, {
      type: "budget.create",
      entityType: "budget",
      entityId: id,
      summary: `Created the ${fyLabel(fyStart)} ${input.basis} budget${how}${how && input.uplift ? ` (${input.uplift > 0 ? "+" : ""}${input.uplift}%)` : ""}`,
      payload: { basis: input.basis, seed: input.seed, uplift: input.uplift, lines: seeds.length },
      ip: req.ip,
    });
    res.status(201).json({ budget: mapBudget(await loadBudget(deps.db, t, id)), seeded: seeds.length });
  });

  router.get("/budgets/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const t = actor.tenantId;
    const b = await loadBudget(deps.db, t, req.params.id);
    const today = todayISO();
    const departments = await departmentsOf(deps.db, t);
    const [lines, book, lastBook, billCategories] = await Promise.all([
      rows<LineRow>(deps.db, `SELECT * FROM bos_budget_lines WHERE budget_id = :id ORDER BY created_at, label`, { id: b.id }),
      actualsFor(deps.db, t, b.basis, b.fy_start, departments),
      actualsFor(deps.db, t, b.basis, previousFy(b.fy_start), departments),
      b.basis === "category"
        ? rows<{ category: string }>(deps.db, `SELECT DISTINCT category FROM bos_bills WHERE tenant_id = :t AND category IS NOT NULL AND category <> '' ORDER BY category LIMIT 200`, { t })
        : Promise.resolve([]),
    ]);
    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    const lastYearOf = (kind: HeadKind, key: string) => sumMonths(lastBook.months(kind, key));

    const heads = lines.map((l) => {
      const budget = normaliseMonths(l.months);
      const actual = book.months(l.kind, l.head_key);
      return {
        id: l.id,
        kind: l.kind,
        key: l.head_key,
        label: l.kind === "department" ? (deptName.get(l.head_key) ?? `${l.label} (removed)`) : l.label,
        note: l.note,
        budgetMonths: budget,
        actualMonths: actual,
        lastYear: lastYearOf(l.kind, l.head_key),
        ...evaluateHead(budget, actual, b.fy_start, today),
      };
    });
    const budgeted = new Set(lines.map((l) => headId(l.kind, l.head_key)));
    const unbudgeted = [...book.heads.values()]
      .filter((h) => !budgeted.has(headId(h.kind, h.key)))
      .map((h) => ({ kind: h.kind, key: h.key, label: h.label, actualMonths: h.months, total: sumMonths(h.months), lastYear: lastYearOf(h.kind, h.key) }))
      .sort((a, c) => c.total - a.total);

    const monthly = {
      budget: Array.from({ length: 12 }, (_, i) => round2(heads.reduce((s, h) => s + h.budgetMonths[i], 0))),
      actual: Array.from({ length: 12 }, (_, i) => round2([...book.heads.values()].reduce((s, h) => s + h.months[i], 0))),
    };
    const total = evaluateHead(monthly.budget, monthly.actual, b.fy_start, today);

    const taken = (kind: HeadKind, key: string) => budgeted.has(headId(kind, key));
    const categoryNames = new Map<string, string>();
    for (const name of [...EXPENSE_CATEGORIES, ...billCategories.map((c) => c.category), ...unbudgeted.filter((u) => u.kind === "category").map((u) => u.label)]) {
      const key = headKey(name);
      if (!taken("category", key) && !categoryNames.has(key)) categoryNames.set(key, name.trim());
    }

    res.json({
      budget: mapBudget(b),
      today,
      months: fyMonths(b.fy_start),
      heads,
      unbudgeted,
      monthly,
      totals: { ...total, budgetedSpend: round2(heads.reduce((s, h) => s + h.actual, 0)), unbudgetedSpend: round2(unbudgeted.reduce((s, u) => s + u.total, 0)) },
      options:
        b.basis === "category"
          ? { categories: [...categoryNames.values()], departments: [], payroll: !taken("payroll", ""), company: false }
          : { categories: [], departments: departments.filter((d) => !taken("department", d.id)), payroll: false, company: !taken("company", "") },
    });
  });

  router.patch("/budgets/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(BudgetPatch, req.body);
    const b = await loadBudget(deps.db, actor.tenantId, req.params.id);
    await exec(deps.db, `UPDATE bos_budgets SET name = :name, notes = :notes WHERE id = :id`, {
      id: b.id,
      name: input.name ?? b.name,
      notes: input.notes === undefined ? b.notes : input.notes || null,
    });
    await recordEvent(deps, actor, { type: "budget.update", entityType: "budget", entityId: b.id, summary: `Updated the ${fyLabel(b.fy_start)} budget details`, ip: req.ip });
    res.json({ budget: mapBudget(await loadBudget(deps.db, actor.tenantId, b.id)) });
  });

  router.delete("/budgets/:id", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const b = await loadBudget(deps.db, actor.tenantId, req.params.id);
    await exec(deps.db, `DELETE FROM bos_budgets WHERE id = :id AND tenant_id = :t`, { id: b.id, t: actor.tenantId });
    await recordEvent(deps, actor, {
      type: "budget.delete",
      entityType: "budget",
      entityId: b.id,
      summary: `Deleted the ${fyLabel(b.fy_start)} ${b.basis} budget (${inr(money(b.annual))})`,
      ip: req.ip,
    });
    res.status(204).end();
  });

  router.post("/budgets/:id/lines", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(LineInput, req.body);
    const t = actor.tenantId;
    const b = await loadBudget(deps.db, t, req.params.id);
    if (!HEAD_KINDS[b.basis].includes(input.kind)) throw new BosError(400, `A ${b.basis} budget can't have a ${input.kind} head`);
    let key = "";
    let label: string;
    if (input.kind === "category") {
      if (!input.name) throw new BosError(400, "Enter a category");
      key = headKey(input.name);
      label = input.name.replace(/\s+/g, " ");
    } else if (input.kind === "department") {
      const d = input.departmentId ? await one<Department>(deps.db, `SELECT id, name FROM bos_departments WHERE id = :id AND tenant_id = :t`, { id: input.departmentId, t }) : null;
      if (!d) throw notFound("Department");
      key = d.id;
      label = d.name;
    } else {
      label = input.kind === "payroll" ? PAYROLL_LABEL : COMPANY_LABEL;
    }
    if (await one(deps.db, `SELECT id FROM bos_budget_lines WHERE budget_id = :b AND kind = :kind AND head_key = :key`, { b: b.id, kind: input.kind, key })) {
      throw new BosError(409, `${label} is already in this budget`);
    }
    const id = randomUUID();
    const amounts = normaliseMonths(input.months);
    await exec(
      deps.db,
      `INSERT INTO bos_budget_lines (id, tenant_id, budget_id, kind, head_key, label, months, annual, note)
       VALUES (:id, :t, :b, :kind, :key, :label, :months, :annual, :note)`,
      { id, t, b: b.id, kind: input.kind, key, label, months: JSON.stringify(amounts), annual: sumMonths(amounts), note: input.note ?? null },
    );
    await touch(deps.db, b.id);
    await recordEvent(deps, actor, {
      type: "budget.line_add",
      entityType: "budget",
      entityId: b.id,
      summary: `Budgeted ${inr(sumMonths(amounts))} for ${label} in ${fyLabel(b.fy_start)}`,
      payload: { lineId: id },
      ip: req.ip,
    });
    res.status(201).json({ lineId: id });
  });

  router.patch("/budgets/:id/lines/:lineId", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const input = parse(LinePatch, req.body);
    const b = await loadBudget(deps.db, actor.tenantId, req.params.id);
    const line = await loadLine(deps.db, b.id, req.params.lineId);
    const before = money(line.annual);
    const amounts = input.months ? normaliseMonths(input.months) : normaliseMonths(line.months);
    await exec(deps.db, `UPDATE bos_budget_lines SET months = :months, annual = :annual, note = :note WHERE id = :id`, {
      id: line.id,
      months: JSON.stringify(amounts),
      annual: sumMonths(amounts),
      note: input.note === undefined ? line.note : input.note || null,
    });
    await touch(deps.db, b.id);
    const after = sumMonths(amounts);
    await recordEvent(deps, actor, {
      type: "budget.line_update",
      entityType: "budget",
      entityId: b.id,
      summary: after === before ? `Updated the ${line.label} budget for ${fyLabel(b.fy_start)}` : `Changed the ${line.label} budget for ${fyLabel(b.fy_start)} from ${inr(before)} to ${inr(after)}`,
      payload: { lineId: line.id, before, after },
      ip: req.ip,
    });
    res.json({ ok: true });
  });

  router.delete("/budgets/:id/lines/:lineId", async (req, res) => {
    const actor = actorOf(res);
    managerOnly(actor);
    const b = await loadBudget(deps.db, actor.tenantId, req.params.id);
    const line = await loadLine(deps.db, b.id, req.params.lineId);
    await exec(deps.db, `DELETE FROM bos_budget_lines WHERE id = :id`, { id: line.id });
    await touch(deps.db, b.id);
    await recordEvent(deps, actor, {
      type: "budget.line_delete",
      entityType: "budget",
      entityId: b.id,
      summary: `Removed ${line.label} (${inr(money(line.annual))}) from the ${fyLabel(b.fy_start)} budget`,
      payload: { lineId: line.id },
      ip: req.ip,
    });
    res.status(204).end();
  });
}

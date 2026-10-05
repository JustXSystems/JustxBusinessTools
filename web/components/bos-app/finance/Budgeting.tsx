"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  DataTable,
  Field,
  FormGrid,
  Grid,
  Input,
  KpiCard,
  ModuleToolbar,
  ProgressBar,
  Segmented,
  Select,
  Textarea,
  useToast,
  WidgetCard,
  WidgetRow,
  type BosColumn,
  type BosTone,
} from "@/components/bos";
import { bos, type BudgetBasis, type BudgetDetail, type BudgetFigures, type BudgetHead, type BudgetHeadKind, type BudgetSeed, type BudgetStatus } from "@/lib/bos-app/api";
import { budgetBadge, dateLabel, inr, inrCompact, monthLabel, spreadEvenly } from "@/lib/bos-app/format";
import { downloadCsv } from "@/lib/export/csv";
import { Loaded, ManagersOnly, Stack, StatusBadge, useBosAction, useBosApp, useBosData } from "../core";
import { ConfirmDialog, FormDialog, useFormState } from "../dialogs";

const BASES: ReadonlyArray<{ value: BudgetBasis; label: string }> = [
  { value: "category", label: "By category" },
  { value: "department", label: "By department" },
];
const STATUS_TONE: Record<BudgetStatus, BosTone> = { ok: "emerald", watch: "amber", over: "coral" };

const two = (n: number) => String(n % 100).padStart(2, "0");
const fyName = (year: number, startMonth: number) => (startMonth === 1 ? `FY ${year}` : `FY ${two(year)}-${two(year + 1)}`);
const shortMonth = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
const usedText = (f: BudgetFigures) => (f.usedPct === null ? (f.actual > 0 ? "No budget" : "—") : `${f.usedPct}%`);
const sum = (list: ReadonlyArray<number>) => Math.round(list.reduce((s, v) => s + v, 0) * 100) / 100;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Finance → Budgeting: a yearly plan per category or department, tracked against recorded spend. Managers only. */
export function Budgeting() {
  const { canManage, takeIntent } = useBosApp();
  const [intent] = useState(() => takeIntent("budgeting"));
  if (!canManage) return <ManagersOnly>Budgets and budget-vs-actual tracking are limited to owners and admins.</ManagersOnly>;
  return <BudgetHome openId={intent?.startsWith("open:") ? intent.slice(5) : null} />;
}

function BudgetHome({ openId }: { openId: string | null }) {
  const [pick, setPick] = useState<{ year: number; basis: BudgetBasis } | null>(null);
  const [creating, setCreating] = useState(false);
  const state = useBosData(() => bos.budgets(), []);
  return (
    <Loaded state={state}>
      {(list) => {
        const opened = openId ? list.budgets.find((b) => b.id === openId) : undefined;
        const { year, basis } = pick ?? (opened ? { year: opened.year, basis: opened.basis } : { year: list.currentYear, basis: "category" as BudgetBasis });
        const years = [...new Set([list.currentYear + 1, list.currentYear, list.currentYear - 1, ...list.budgets.map((b) => b.year)])].sort((a, b) => b - a);
        const budget = list.budgets.find((b) => b.year === year && b.basis === basis);
        const label = fyName(year, list.fiscalYearStart);
        return (
          <Stack>
            <ModuleToolbar>
              <Select aria-label="Financial year" size="sm" value={String(year)} onChange={(e) => setPick({ year: Number(e.target.value), basis })} style={{ width: "auto" }}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {fyName(y, list.fiscalYearStart)}
                    {y === list.currentYear ? " · current" : ""}
                  </option>
                ))}
              </Select>
              <Segmented size="sm" role="radio" aria-label="Budget basis" options={BASES} value={basis} onChange={(v) => setPick({ year, basis: v })} />
              <span className="bos-spacer" />
            </ModuleToolbar>
            {budget ? (
              <BudgetView key={budget.id} id={budget.id} onDeleted={state.reload} />
            ) : (
              <Alert
                tone="blue"
                title={`No ${basis} budget for ${label} yet`}
                actions={
                  <Button size="sm" variant="primary" icon="plus" onClick={() => setCreating(true)}>
                    Create budget
                  </Button>
                }
              >
                {basis === "category"
                  ? "Plan the year by what money is spent on — travel, rent, site materials, payroll. BOS tracks approved bills, expense claims and finalised payroll against each head, month by month."
                  : "Plan the year per department (cost centre). Expense claims count against the claimant's department and salaries against the department on the payslip; vendor bills are company-wide."}{" "}
                You can start from last year&apos;s actual spend.
              </Alert>
            )}
            {creating ? (
              <CreateBudgetDialog
                year={year}
                basis={basis}
                label={label}
                lastLabel={fyName(year - 1, list.fiscalYearStart)}
                hasLastBudget={list.budgets.some((b) => b.year === year - 1 && b.basis === basis)}
                onClose={() => setCreating(false)}
              />
            ) : null}
          </Stack>
        );
      }}
    </Loaded>
  );
}

function CreateBudgetDialog({
  year,
  basis,
  label,
  lastLabel,
  hasLastBudget,
  onClose,
}: {
  year: number;
  basis: BudgetBasis;
  label: string;
  lastLabel: string;
  hasLastBudget: boolean;
  onClose: () => void;
}) {
  const { run, busy } = useBosAction();
  const { show } = useToast();
  const f = useFormState(() => ({ name: "", seed: (hasLastBudget ? "budget" : "actuals") as BudgetSeed, uplift: "0" }));
  const v = f.values;
  const submit = async () => {
    const out = await run("create", () => bos.createBudget({ year, basis, name: v.name.trim() || null, seed: v.seed, uplift: Number(v.uplift) || 0 }));
    if (!out) return;
    show({
      tone: "emerald",
      title: "Budget created",
      description: out.seeded ? `${plural(out.seeded, "head")} filled in — review and adjust them` : v.seed === "blank" ? "Add the heads you want to plan" : `Nothing to copy from ${lastLabel} — add heads to plan`,
    });
    onClose();
  };
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Create the ${label} budget`}
      description={basis === "category" ? "Heads are spend categories plus payroll." : "Heads are departments plus company-wide costs."}
      icon={{ tone: "emerald", name: "trend" }}
      submitLabel="Create budget"
      busy={busy === "create"}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label="Name" full>
          {({ id }) => <Input id={id} maxLength={120} value={v.name} placeholder={`${label} budget`} onChange={(e) => f.set("name")(e.target.value)} />}
        </Field>
        <Field label="Start from">
          {({ id }) => (
            <Select id={id} value={v.seed} onChange={(e) => f.set("seed")(e.target.value as BudgetSeed)}>
              <option value="actuals">{lastLabel} actual spend</option>
              <option value="budget" disabled={!hasLastBudget}>
                {lastLabel} budget{hasLastBudget ? "" : " (none)"}
              </option>
              <option value="blank">Start empty</option>
            </Select>
          )}
        </Field>
        {v.seed !== "blank" ? (
          <Field label="Adjust by (%)" hint="10 plans 10% more; a negative number plans a cut">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" step="1" min={-90} max={500} value={v.uplift} onChange={(e) => f.set("uplift")(e.target.value)} />}
          </Field>
        ) : null}
      </FormGrid>
    </FormDialog>
  );
}

/* ---------- One budget ---------- */

type Adding = { kind: BudgetHeadKind; key: string; label: string } | "new";

/** `onDeleted` reloads only the budget list, so this view unmounts instead of refetching a budget that's gone. */
function BudgetView({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { run, busy } = useBosAction();
  const [view, setView] = useState<"summary" | "monthly">("summary");
  const [editing, setEditing] = useState<BudgetHead | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [removing, setRemoving] = useState<BudgetHead | null>(null);
  const [dialog, setDialog] = useState<"details" | "delete" | null>(null);
  const state = useBosData(() => bos.budget(id), [id]);

  return (
    <Loaded state={state} rows={2}>
      {(detail) => {
        const { budget: b, heads, unbudgeted, totals: t, months, monthly, today } = detail;
        const current = months.indexOf(today.slice(0, 7));
        const over = heads.filter((h) => h.status === "over");
        const watch = heads.filter((h) => h.status === "watch");
        const canAdd = b.basis === "category" || detail.options.departments.length > 0 || detail.options.company;

        const columns: BosColumn<BudgetHead>[] = [
          {
            key: "label",
            header: "Head",
            cell: (h) => (
              <span style={{ display: "block", maxWidth: 260 }}>
                <span style={{ fontWeight: 600 }}>{h.label}</span>
                {h.note ? <span className="bos-text-faint" style={{ display: "block", fontSize: 11.5 }}>{h.note}</span> : null}
              </span>
            ),
          },
          { key: "annual", header: "Budget", align: "right", mono: true, cell: (h) => inr(h.annual) },
          { key: "toDate", header: "Budget to date", align: "right", mono: true, cell: (h) => inr(h.toDate) },
          { key: "actual", header: "Spent", align: "right", mono: true, cell: (h) => inr(h.actual) },
          { key: "remaining", header: "Remaining", align: "right", mono: true, cell: (h) => <span style={h.remaining < 0 ? { color: "var(--bos-coral-600)" } : undefined}>{inr(h.remaining)}</span> },
          { key: "used", header: "Used", align: "right", mono: true, cell: usedText },
          { key: "projected", header: "Projected", align: "right", mono: true, cell: (h) => inr(h.projected) },
          { key: "status", header: "Status", cell: (h) => <StatusBadge view={budgetBadge(h.status)} /> },
        ];

        type MonthRow = { id: string; label: string; budget: number[] | null; actual: number[] };
        const monthRows: MonthRow[] = [
          ...heads.map((h) => ({ id: h.id, label: h.label, budget: h.budgetMonths, actual: h.actualMonths })),
          ...unbudgeted.map((u) => ({ id: `u-${u.kind}-${u.key}`, label: `${u.label} · unbudgeted`, budget: null, actual: u.actualMonths })),
          { id: "total", label: "Total", budget: monthly.budget, actual: monthly.actual },
        ];
        const monthColumns: BosColumn<MonthRow>[] = [
          { key: "label", header: "Head", cell: (r) => <span style={{ fontWeight: r.id === "total" ? 700 : 600, whiteSpace: "nowrap" }}>{r.label}</span> },
          ...months.map<BosColumn<MonthRow>>((ym, i) => ({
            key: ym,
            header: shortMonth(ym),
            align: "right",
            mono: true,
            cell: (r) => <MonthCell actual={r.actual[i]} budget={r.budget?.[i] ?? null} />,
          })),
          { key: "total", header: "Year", align: "right", mono: true, cell: (r) => <MonthCell actual={sum(r.actual)} budget={r.budget ? sum(r.budget) : null} /> },
        ];

        return (
          <>
            <Grid cols={4} min={140}>
              <KpiCard label={`Annual budget (${b.fyLabel})`} value={inrCompact(t.annual)} chip={{ color: "mint", glyph: "🎯" }} delta={plural(heads.length, "head")} deltaTone="muted" />
              <KpiCard
                label="Spent to date"
                value={inrCompact(t.actual)}
                chip={{ color: "rose", glyph: "₹" }}
                delta={`Budget to date ${inrCompact(t.toDate)}`}
                deltaTone={t.actual > t.toDate + 0.5 ? "warn" : "muted"}
              />
              <KpiCard label="Remaining" value={inrCompact(t.remaining)} valueTone={t.remaining < 0 ? "coral" : "emerald"} chip={{ color: "blue", glyph: "◎" }} delta={`${usedText(t)} used`} deltaTone="muted" />
              <KpiCard
                label="Projected year-end"
                value={inrCompact(t.projected)}
                chip={{ color: "lavender", glyph: "↗" }}
                delta={t.projected > t.annual + 0.5 ? `${inrCompact(t.projected - t.annual)} over budget` : "Within budget"}
                deltaTone={t.projected > t.annual + 0.5 ? "warn" : "up"}
              />
            </Grid>

            {!heads.length ? (
              <Alert
                tone="blue"
                title="Add the heads you want to plan"
                actions={
                  <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding("new")}>
                    Add head
                  </Button>
                }
              >
                {b.basis === "category"
                  ? "A head is a spend category (bills and claims with the same category name count against it) or payroll."
                  : "A head is a department, or company-wide for vendor bills and spend without a department."}
              </Alert>
            ) : over.length || watch.length ? (
              <Alert tone={over.length ? "coral" : "amber"} title={over.length ? `${plural(over.length, "head")} over budget` : `${plural(watch.length, "head")} running ahead of plan`}>
                {[...over, ...watch].map((h) => h.label).join(", ")}. &quot;Projected&quot; is what&apos;s spent so far plus the plan for the rest of the year.
              </Alert>
            ) : null}

            <ModuleToolbar>
              <span className="bos-kpi-label">{b.name}</span>
              <span className="bos-spacer" />
              <Button size="sm" variant="ghost" onClick={() => setDialog("delete")}>
                Delete
              </Button>
              <Button size="sm" icon="edit" onClick={() => setDialog("details")}>
                Details
              </Button>
              <Button size="sm" icon="download" disabled={!heads.length && !unbudgeted.length} onClick={() => exportBudget(detail)}>
                Download CSV
              </Button>
              <Button size="sm" variant="primary" icon="plus" disabled={!canAdd} onClick={() => setAdding("new")}>
                Add head
              </Button>
            </ModuleToolbar>

            {heads.length || unbudgeted.length ? (
              <Grid template="1.4fr 1fr">
                <WidgetCard title="🎯 Budget vs actual" dot="mint" note={b.fyLabel}>
                  {heads.length ? (
                    <div className="bos-budget-bars">
                      {heads.map((h) => (
                        <button key={h.id} type="button" className="bos-budget-bar" onClick={() => setEditing(h)}>
                          <span className="bos-row-between" style={{ fontSize: 12.5 }}>
                            <span style={{ fontWeight: 600 }}>{h.label}</span>
                            <span className="bos-mono" style={{ fontSize: 11.5, color: `var(--bos-${STATUS_TONE[h.status]}-600)` }}>
                              {inrCompact(h.actual)} / {inrCompact(h.annual)}
                            </span>
                          </span>
                          <ProgressBar value={h.usedPct ?? (h.actual > 0 ? 100 : 0)} tone={STATUS_TONE[h.status]} label={`${h.label}: ${usedText(h)} of budget used`} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <WidgetRow label={<span className="bos-text-faint">No heads yet</span>} />
                  )}
                </WidgetCard>
                <Stack gap={16}>
                  <WidgetCard title="🧾 Unbudgeted spend" dot="rose" note={unbudgeted.length ? inr(t.unbudgetedSpend) : undefined}>
                    {unbudgeted.length ? (
                      unbudgeted.slice(0, 6).map((u) => (
                        <WidgetRow key={`${u.kind}:${u.key}`} label={`${u.label} · ${inr(u.total)}`} value="Add to budget" valueTone="blue" onClick={() => setAdding({ kind: u.kind, key: u.key, label: u.label })} />
                      ))
                    ) : (
                      <WidgetRow label="Every rupee spent has a budget head" value="✓" valueTone="emerald" />
                    )}
                  </WidgetCard>
                  {current >= 0 ? (
                    <WidgetCard title={`📅 ${monthLabel(months[current])}`} dot="blue">
                      <WidgetRow label="Budget" value={inr(monthly.budget[current])} />
                      <WidgetRow label="Spent so far" value={inr(monthly.actual[current])} valueTone={monthly.actual[current] > monthly.budget[current] + 0.5 ? "coral" : "text"} />
                    </WidgetCard>
                  ) : null}
                </Stack>
              </Grid>
            ) : null}

            {heads.length || unbudgeted.length ? (
              <div>
                <ModuleToolbar>
                  <Segmented
                    size="sm"
                    aria-label="Budget view"
                    options={[
                      { value: "summary", label: "Summary" },
                      { value: "monthly", label: "Month by month" },
                    ]}
                    value={view}
                    onChange={setView}
                  />
                  <span className="bos-spacer" />
                  <span className="bos-text-faint" style={{ fontSize: 12 }}>
                    As of {dateLabel(today)} · approved bills and claims, finalised payroll, excluding GST
                  </span>
                </ModuleToolbar>
                {view === "summary" ? (
                  <DataTable caption="Budget vs actual by head" columns={columns} rows={heads} rowKey={(h) => h.id} onRowClick={setEditing} empty="No heads yet — add one to start planning." />
                ) : (
                  <DataTable caption="Spent (top) against budget (below), by month" columns={monthColumns} rows={monthRows} rowKey={(r) => r.id} compact />
                )}
              </div>
            ) : null}

            {adding || editing ? (
              <LineDialog
                key={editing?.id ?? (adding === "new" ? "new" : `${adding?.kind}:${adding?.key}`)}
                detail={detail}
                head={editing}
                prefill={adding && adding !== "new" ? adding : null}
                onClose={() => {
                  setAdding(null);
                  setEditing(null);
                }}
                onRemove={(h) => {
                  setEditing(null);
                  setRemoving(h);
                }}
              />
            ) : null}
            <ConfirmDialog
              open={removing !== null}
              onClose={() => setRemoving(null)}
              title={`Remove ${removing?.label ?? "this head"}?`}
              description="Its spend stays recorded and shows under unbudgeted spend."
              confirmLabel="Remove"
              destructive
              busy={busy === "remove"}
              onConfirm={async () => {
                if (!removing) return;
                const done = await run(
                  "remove",
                  async () => {
                    await bos.deleteBudgetLine(b.id, removing.id);
                    return true;
                  },
                  { success: "Head removed", description: removing.label },
                );
                if (done) setRemoving(null);
              }}
            />
            {dialog === "details" ? <DetailsDialog id={b.id} name={b.name} notes={b.notes} onClose={() => setDialog(null)} /> : null}
            <ConfirmDialog
              open={dialog === "delete"}
              onClose={() => setDialog(null)}
              title={`Delete the ${b.fyLabel} ${b.basis} budget?`}
              description="The plan is removed. Bills, claims and payroll aren't affected."
              confirmLabel="Delete budget"
              destructive
              busy={busy === "delete"}
              onConfirm={async () => {
                const done = await run(
                  "delete",
                  async () => {
                    await bos.deleteBudget(b.id);
                    return true;
                  },
                  { success: "Budget deleted", description: b.name, refresh: false },
                );
                if (!done) return;
                setDialog(null);
                onDeleted();
              }}
            />
          </>
        );
      }}
    </Loaded>
  );
}

function MonthCell({ actual, budget }: { actual: number; budget: number | null }) {
  const over = budget !== null ? actual > budget + 0.5 : actual > 0;
  return (
    <span className="bos-budget-cell">
      <span style={over ? { color: "var(--bos-coral-600)" } : undefined}>{actual ? inrCompact(actual) : "—"}</span>
      <span className="bos-text-faint">{budget === null ? "no budget" : inrCompact(budget)}</span>
    </span>
  );
}

function exportBudget({ budget: b, heads, unbudgeted, months }: BudgetDetail) {
  const monthHeaders = months.flatMap((ym) => [`${monthLabel(ym)} budget`, `${monthLabel(ym)} spent`]);
  const headers = ["Head", "Annual budget", "Budget to date", "Spent", "Remaining", "Used %", "Projected", "Status", ...monthHeaders];
  const monthCells = (budget: number[] | null, actual: number[]) => Object.fromEntries(months.flatMap((ym, i) => [[`${monthLabel(ym)} budget`, budget ? budget[i] : ""], [`${monthLabel(ym)} spent`, actual[i]]]));
  downloadCsv(`budget_${b.fyLabel.replace(/\s+/g, "-")}_${b.basis}.csv`, headers, [
    ...heads.map((h) => ({
      Head: h.label,
      "Annual budget": h.annual,
      "Budget to date": h.toDate,
      Spent: h.actual,
      Remaining: h.remaining,
      "Used %": h.usedPct ?? "",
      Projected: h.projected,
      Status: budgetBadge(h.status).text,
      ...monthCells(h.budgetMonths, h.actualMonths),
    })),
    ...unbudgeted.map((u) => ({ Head: `${u.label} (unbudgeted)`, "Annual budget": 0, "Budget to date": 0, Spent: u.total, Remaining: -u.total, "Used %": "", Projected: u.total, Status: "UNBUDGETED", ...monthCells(null, u.actualMonths) })),
  ]);
}

function DetailsDialog({ id, name, notes, onClose }: { id: string; name: string; notes: string | null; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ name, notes: notes ?? "" }));
  const submit = async () => {
    const out = await run("details", () => bos.updateBudget(id, { name: f.values.name.trim(), notes: f.values.notes.trim() || null }), { success: "Budget updated" });
    if (out) onClose();
  };
  return (
    <FormDialog open onClose={onClose} title="Budget details" icon={{ tone: "emerald", name: "edit" }} submitLabel="Save" busy={busy === "details"} onSubmit={submit}>
      <FormGrid>
        <Field label="Name" full>
          {({ id: fid }) => <Input id={fid} required maxLength={120} value={f.values.name} onChange={(e) => f.set("name")(e.target.value)} />}
        </Field>
        <Field label="Notes" full>
          {({ id: fid }) => <Textarea id={fid} rows={3} maxLength={500} value={f.values.notes} placeholder="Assumptions, approvals, revisions…" onChange={(e) => f.set("notes")(e.target.value)} />}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/* ---------- Adding and editing a head ---------- */

const CUSTOM = "custom";

/** Mirrors the API: categories match by name, ignoring case and spacing. */
const headKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase() || "uncategorised";

function LineDialog({
  detail,
  head,
  prefill,
  onClose,
  onRemove,
}: {
  detail: BudgetDetail;
  head: BudgetHead | null;
  prefill: { kind: BudgetHeadKind; key: string; label: string } | null;
  onClose: () => void;
  onRemove: (h: BudgetHead) => void;
}) {
  const { run, busy } = useBosAction();
  const { budget: b, months, options, unbudgeted } = detail;
  const choices: Array<{ value: string; label: string }> =
    b.basis === "category"
      ? [...options.categories.map((c) => ({ value: `cat:${c}`, label: c })), ...(options.payroll ? [{ value: "payroll", label: "Payroll (employer cost)" }] : []), { value: CUSTOM, label: "Another category…" }]
      : [...options.departments.map((d) => ({ value: `dept:${d.id}`, label: d.name })), ...(options.company ? [{ value: "company", label: "Company-wide (bills and unassigned spend)" }] : [])];

  const evenly = (list: ReadonlyArray<number>) => spreadEvenly(sum(list)).every((v, i) => Math.abs(v - list[i]) < 0.005);
  const choiceFor = (p: { kind: BudgetHeadKind; key: string; label: string }) =>
    p.kind === "category" ? (choices.find((c) => c.value.startsWith("cat:") && headKey(c.value.slice(4)) === p.key)?.value ?? `cat:${p.label}`) : p.kind === "department" ? `dept:${p.key}` : p.kind;
  const f = useFormState(() => {
    const start = head?.budgetMonths ?? null;
    const known = prefill ? unbudgeted.find((u) => u.kind === prefill.kind && u.key === prefill.key) : undefined;
    const suggested = known ? Math.round(known.lastYear || 0) : 0;
    return {
      choice: prefill ? choiceFor(prefill) : (choices[0]?.value ?? CUSTOM),
      custom: "",
      mode: (start && !evenly(start) ? "monthly" : "even") as "even" | "monthly",
      annual: start ? String(sum(start)) : suggested ? String(suggested) : "",
      months: (start ?? spreadEvenly(suggested)).map((n) => (n ? String(n) : "")),
      note: head?.note ?? "",
    };
  });
  const v = f.values;
  const monthAmounts = v.months.map((s) => Math.max(0, Number(s) || 0));
  const amounts = v.mode === "even" ? spreadEvenly(Number(v.annual) || 0) : monthAmounts;
  const total = sum(amounts);

  const selected = head
    ? { kind: head.kind, key: head.key }
    : v.choice === "payroll" || v.choice === "company"
      ? { kind: v.choice as BudgetHeadKind, key: "" }
      : v.choice.startsWith("dept:")
        ? { kind: "department" as const, key: v.choice.slice(5) }
        : { kind: "category" as const, key: headKey(v.choice === CUSTOM ? v.custom : v.choice.slice(4)) };
  const spentNow = head ? head.actual : (unbudgeted.find((u) => u.kind === selected.kind && u.key === selected.key)?.total ?? 0);
  const lastYear = head ? head.lastYear : (unbudgeted.find((u) => u.kind === selected.kind && u.key === selected.key)?.lastYear ?? 0);

  const setMode = (mode: "even" | "monthly") => {
    if (mode === v.mode) return;
    if (mode === "monthly") f.setValues((s) => ({ ...s, mode, months: spreadEvenly(Number(s.annual) || 0).map((n) => (n ? String(n) : "")) }));
    else f.setValues((s) => ({ ...s, mode, annual: String(sum(s.months.map((m) => Math.max(0, Number(m) || 0)))) }));
  };

  const submit = async () => {
    const note = v.note.trim() || null;
    if (head) {
      const out = await run("line", () => bos.updateBudgetLine(b.id, head.id, { months: amounts, note }), { success: "Budget updated", description: `${head.label} · ${inr(total)}` });
      if (out) onClose();
      return;
    }
    const input =
      selected.kind === "category"
        ? { kind: "category" as const, name: v.choice === CUSTOM ? v.custom.trim() : v.choice.slice(4), months: amounts, note }
        : selected.kind === "department"
          ? { kind: "department" as const, departmentId: selected.key, months: amounts, note }
          : { kind: selected.kind, months: amounts, note };
    const out = await run("line", () => bos.addBudgetLine(b.id, input), { success: "Head added", description: inr(total) });
    if (out) onClose();
  };

  return (
    <FormDialog
      open
      onClose={onClose}
      title={head ? `Budget for ${head.label}` : "Add a budget head"}
      description={`${b.fyLabel} · ${monthLabel(months[0])} to ${monthLabel(months[11])}`}
      icon={{ tone: "emerald", name: "trend" }}
      submitLabel={head ? "Save" : "Add head"}
      busy={busy === "line"}
      onSubmit={submit}
      wide
      note={
        head ? (
          <Button size="sm" variant="ghost" onClick={() => onRemove(head)}>
            Remove from budget
          </Button>
        ) : undefined
      }
    >
      <FormGrid>
        {head ? null : (
          <>
            <Field label="Head" full={v.choice !== CUSTOM}>
              {({ id }) => (
                <Select id={id} value={v.choice} onChange={(e) => f.set("choice")(e.target.value)}>
                  {choices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {v.choice === CUSTOM ? (
              <Field label="Category name" hint="Bills and claims with this category count against it">
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} required maxLength={80} value={v.custom} placeholder="e.g. Rent" onChange={(e) => f.set("custom")(e.target.value)} />}
              </Field>
            ) : null}
          </>
        )}
        <div className="bos-form-grid-full">
          <Segmented
            size="sm"
            role="radio"
            aria-label="How to plan"
            options={[
              { value: "even", label: "Same every month" },
              { value: "monthly", label: "Month by month" },
            ]}
            value={v.mode}
            onChange={setMode}
          />
        </div>
        {v.mode === "even" ? (
          <Field label="Annual budget (₹)" hint={total ? `About ${inr(total / 12)} a month` : undefined}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} type="number" min={0} step="1" inputMode="decimal" value={v.annual} placeholder="0" onChange={(e) => f.set("annual")(e.target.value)} />
            )}
          </Field>
        ) : (
          <div className="bos-form-grid-full">
            <div className="bos-budget-months">
              {months.map((ym, i) => (
                <Field key={ym} label={monthLabel(ym)}>
                  {({ id }) => (
                    <Input
                      id={id}
                      size="sm"
                      type="number"
                      min={0}
                      step="1"
                      inputMode="decimal"
                      value={v.months[i]}
                      placeholder="0"
                      onChange={(e) => f.set("months")(v.months.map((m, j) => (j === i ? e.target.value : m)))}
                    />
                  )}
                </Field>
              ))}
            </div>
          </div>
        )}
        <Field label="Note">{({ id }) => <Input id={id} maxLength={300} value={v.note} placeholder="Optional" onChange={(e) => f.set("note")(e.target.value)} />}</Field>
      </FormGrid>
      <p className="bos-text-faint" style={{ fontSize: 12, margin: "12px 0 0" }}>
        Year total {inr(total)}
        {spentNow ? ` · spent so far ${inr(spentNow)}` : ""}
        {lastYear ? ` · last year ${inr(lastYear)}` : ""}
      </p>
    </FormDialog>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DataTable,
  Field,
  FormGrid,
  Grid,
  Input,
  KpiCard,
  ModuleToolbar,
  Pagination,
  SearchInput,
  Segmented,
  Select,
  Switch,
  WidgetCard,
  WidgetRow,
  type BosColumn,
} from "@/components/bos";
import { bos, type BosPayslip, type PayrollConfig, type PayrollEmployee, type PayrollRun, type PayslipLine } from "@/lib/bos-app/api";
import { dateLabel, defaultPayrollPeriod, inr, inrCompact, monthLabel, payrollBadge, rupeesInWords, timeAgo, todayLocal } from "@/lib/bos-app/format";
import { downloadCsv } from "@/lib/export/csv";
import { Loaded, ManagersOnly, Stack, StatusBadge, useBosAction, useBosApp, useBosData, usePrint } from "../core";
import { ConfirmDialog, FormDialog, useFormState } from "../dialogs";

type Section = "runs" | "structures" | "settings";

const SECTIONS: ReadonlyArray<{ value: Section; label: string }> = [
  { value: "runs", label: "Payroll runs" },
  { value: "structures", label: "Salary structures" },
  { value: "settings", label: "Settings" },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const lineAmount = (lines: ReadonlyArray<PayslipLine>, key: string) => lines.find((l) => l.key === key)?.amount ?? 0;
const names = (list: ReadonlyArray<{ name: string }>) => (list.length > 3 ? `${list.slice(0, 3).map((e) => e.name).join(", ")} and ${list.length - 3} more` : list.map((e) => e.name).join(", "));
const blankToNull = (v: string) => (v.trim() === "" ? null : Number(v));

/** Finance → Payroll. Payslip links (`payslip:<id>`) open for anyone the API allows; everything else is for managers. */
export function Payroll() {
  const { canManage, takeIntent, navigate } = useBosApp();
  const [intent] = useState(() => takeIntent("payroll"));
  const [runId, setRunId] = useState<string | null>(intent?.startsWith("open:") ? intent.slice(5) : null);
  const [slipId, setSlipId] = useState<string | null>(intent?.startsWith("payslip:") ? intent.slice(8) : null);
  const [section, setSection] = useState<Section>("runs");

  if (slipId) {
    return canManage ? (
      <PayslipView id={slipId} backLabel={runId ? "Back to the payroll run" : "Back to payroll"} onBack={() => setSlipId(null)} />
    ) : (
      <PayslipView id={slipId} backLabel="Back to My Profile" onBack={() => navigate("home", "myprofile")} />
    );
  }
  if (!canManage) {
    return <ManagersOnly>Payroll runs, salary structures and statutory dues are limited to owners and admins. Your own payslips are in Home → My Profile once payroll is finalised.</ManagersOnly>;
  }
  if (runId) return <RunDetail id={runId} onBack={() => setRunId(null)} onOpenSlip={setSlipId} />;
  return (
    <Stack>
      <div className="bos-subtabs" style={{ paddingTop: 0 }}>
        <Segmented<Section> role="tabs" size="sm" scroll aria-label="Payroll sections" options={SECTIONS} value={section} onChange={setSection} />
      </div>
      {section === "runs" ? <RunsSection onOpen={setRunId} goTo={setSection} /> : section === "structures" ? <StructuresSection /> : <SettingsSection onSaved={() => setSection("runs")} />}
    </Stack>
  );
}

/* ---------- Runs ---------- */

function RunsSection({ onOpen, goTo }: { onOpen: (id: string) => void; goTo: (s: Section) => void }) {
  const { navigate } = useBosApp();
  const { run, busy } = useBosAction();
  const [period, setPeriod] = useState(() => defaultPayrollPeriod(todayLocal()));
  const state = useBosData(() => bos.payrollOverview(), []);

  return (
    <Loaded state={state}>
      {(o) => {
        const latest = o.runs.find((r) => r.status !== "draft") ?? null;
        const existing = o.runs.find((r) => r.period === period);
        const dues = o.dues;
        const statutory = dues ? dues.pfEmployee + dues.pfEmployer + dues.esiEmployee + dues.esiEmployer + dues.pt : 0;
        const columns: BosColumn<PayrollRun>[] = [
          { key: "period", header: "Month", cell: (r) => <strong>{monthLabel(r.period)}</strong> },
          { key: "status", header: "Status", cell: (r) => <StatusBadge view={payrollBadge(r.status)} /> },
          { key: "employees", header: "Employees", align: "right", mono: true, cell: (r) => r.employeeCount },
          { key: "gross", header: "Gross", align: "right", mono: true, cell: (r) => inr(r.grossTotal) },
          { key: "deductions", header: "Deductions", align: "right", mono: true, cell: (r) => inr(r.deductionTotal) },
          { key: "net", header: "Net pay", align: "right", mono: true, cell: (r) => inr(r.netTotal) },
          { key: "paidOn", header: "Paid on", mono: true, cell: (r) => (r.paidOn ? dateLabel(r.paidOn) : "—") },
        ];
        const create = async () => {
          const out = await run("create-run", () => bos.createPayrollRun(period), { success: `Payroll for ${monthLabel(period)} calculated`, description: "Review the payslips, then finalise." });
          if (out) onOpen(out.run.id);
        };
        return (
          <Stack>
            {!o.settingsSaved || !o.withStructure ? (
              <Alert
                tone="blue"
                title="Set up payroll in two steps"
                actions={
                  <>
                    <Button size="sm" variant={o.settingsSaved ? undefined : "primary"} onClick={() => goTo("settings")}>
                      {o.settingsSaved ? "Settings saved ✓" : "1 · Review settings"}
                    </Button>
                    <Button size="sm" variant={o.settingsSaved ? "primary" : undefined} onClick={() => goTo("structures")}>
                      2 · Set salaries
                    </Button>
                  </>
                }
              >
                First choose what applies to your business — PF, ESI and professional tax start off. Then give each employee a salary structure ({o.withStructure} of {o.headcount} ready); BOS suggests one from the CTC on their record.
              </Alert>
            ) : o.missing.length ? (
              <Alert
                tone="amber"
                title={`${plural(o.missing.length, "employee")} without a salary structure`}
                actions={
                  <Button size="sm" onClick={() => goTo("structures")}>
                    Set salaries
                  </Button>
                }
              >
                {names(o.missing)} won&apos;t be included in payroll until a salary structure is set.
              </Alert>
            ) : null}
            <Grid cols={4} min={140}>
              <KpiCard label="Net pay" value={latest ? inrCompact(latest.netTotal) : "—"} chip={{ color: "mint", glyph: "✓" }} delta={latest ? `${monthLabel(latest.period)} · ${plural(latest.employeeCount, "employee")}` : "No finalised run yet"} deltaTone="muted" />
              <KpiCard label="Employer cost" value={latest ? inrCompact(latest.grossTotal + latest.employerTotal) : "—"} chip={{ color: "blue", glyph: "₹" }} delta="Gross + employer PF & ESI" deltaTone="muted" />
              <KpiCard label="Statutory dues" value={dues ? inrCompact(statutory) : "—"} chip={{ color: "lavender", glyph: "🏛" }} delta={dues && statutory ? `PF & ESI due ${dateLabel(dues.due.pfEsi)}` : "PF, ESI and PT"} deltaTone={dues && statutory ? "warn" : "muted"} />
              <KpiCard label="TDS to deposit" value={dues ? inrCompact(dues.tds) : "—"} chip={{ color: "rose", glyph: "₹" }} delta={dues && dues.tds ? `Due ${dateLabel(dues.due.tds)}` : "Income tax withheld"} deltaTone={dues && dues.tds ? "warn" : "muted"} />
            </Grid>
            <Grid template="1.6fr 1fr">
              <div>
                <ModuleToolbar>
                  <Field label="Payroll month">{({ id }) => <Input id={id} type="month" size="sm" value={period} max={todayLocal().slice(0, 7)} onChange={(e) => e.target.value && setPeriod(e.target.value)} />}</Field>
                  <span className="bos-spacer" />
                  {existing ? (
                    <Button size="sm" onClick={() => onOpen(existing.id)}>
                      Open {monthLabel(period)}
                    </Button>
                  ) : (
                    <Button size="sm" variant="primary" icon="plus" disabled={!o.settingsSaved || busy !== null} onClick={create}>
                      {busy === "create-run" ? "Calculating…" : `Run payroll for ${monthLabel(period)}`}
                    </Button>
                  )}
                </ModuleToolbar>
                <div style={{ marginTop: 12 }}>
                  <DataTable caption="Payroll runs" columns={columns} rows={o.runs} rowKey={(r) => r.id} onRowClick={(r) => onOpen(r.id)} empty="No payroll runs yet — pick a month and run payroll." />
                  <Pagination>{plural(o.runs.length, "payroll run")}</Pagination>
                </div>
              </div>
              <Stack gap={16}>
                <WidgetCard title="✅ Readiness" dot="mint">
                  <WidgetRow label="Payroll settings" value={o.settingsSaved ? "Saved" : "Not reviewed"} valueTone={o.settingsSaved ? "emerald" : "amber"} onClick={() => goTo("settings")} />
                  <WidgetRow label="Salary structures" value={`${o.withStructure} of ${o.headcount}`} valueTone={o.missing.length ? "amber" : "emerald"} onClick={() => goTo("structures")} />
                  <WidgetRow label="PF / ESI" value={[o.config.pfEnabled && "PF", o.config.esiEnabled && "ESI"].filter(Boolean).join(" + ") || "Off"} valueTone="faint" />
                  <WidgetRow label="Professional tax" value={o.config.ptSlabs.length ? plural(o.config.ptSlabs.length, "slab") : "Off"} valueTone="faint" />
                </WidgetCard>
                {dues ? (
                  <WidgetCard title={`🏛️ Dues · ${monthLabel(dues.period)}`} dot="blue">
                    <WidgetRow label={`PF (employee + employer) · by ${dateLabel(dues.due.pfEsi)}`} value={inr(dues.pfEmployee + dues.pfEmployer)} />
                    <WidgetRow label={`ESI (employee + employer) · by ${dateLabel(dues.due.pfEsi)}`} value={inr(dues.esiEmployee + dues.esiEmployer)} />
                    <WidgetRow label="Professional tax · per state schedule" value={inr(dues.pt)} />
                    <WidgetRow label={`TDS · by ${dateLabel(dues.due.tds)}`} value={inr(dues.tds)} />
                  </WidgetCard>
                ) : null}
                <WidgetCard title="🔗 Related" dot="lavender">
                  <WidgetRow label="Mark attendance" chevron onClick={() => navigate("hr", "leave", "biometric")} />
                  <WidgetRow label="Approve leave (LOP comes from here)" chevron onClick={() => navigate("hr", "leave")} />
                  <WidgetRow label="Payroll in profit & loss" chevron onClick={() => navigate("finance", "reports")} />
                </WidgetCard>
              </Stack>
            </Grid>
          </Stack>
        );
      }}
    </Loaded>
  );
}

/* ---------- Run detail ---------- */

type RunView = "register" | "statutory";

function exportRegister(period: string, slips: ReadonlyArray<BosPayslip>) {
  const headers = ["Emp code", "Name", "Department", "Days in month", "Paid days", "LOP days", "Basic", "HRA", "Special", "Bonus", "Gross", "PF", "ESI", "PT", "TDS", "Other", "Total deductions", "Net pay", "Employer PF", "Employer ESI"];
  downloadCsv(
    `payroll-register_${period}.csv`,
    headers,
    slips.map((p) => ({
      "Emp code": p.empCode,
      Name: p.name,
      Department: p.departmentName ?? "",
      "Days in month": p.daysInMonth,
      "Paid days": p.paidDays,
      "LOP days": p.lopDays,
      Basic: lineAmount(p.earnings, "basic"),
      HRA: lineAmount(p.earnings, "hra"),
      Special: lineAmount(p.earnings, "special"),
      Bonus: lineAmount(p.earnings, "bonus"),
      Gross: p.gross,
      PF: lineAmount(p.deductions, "pf"),
      ESI: lineAmount(p.deductions, "esi"),
      PT: lineAmount(p.deductions, "pt"),
      TDS: lineAmount(p.deductions, "tds"),
      Other: lineAmount(p.deductions, "other"),
      "Total deductions": p.totalDeductions,
      "Net pay": p.netPay,
      "Employer PF": lineAmount(p.employer, "pf"),
      "Employer ESI": lineAmount(p.employer, "esi"),
    })),
  );
}

function RunDetail({ id, onBack, onOpenSlip }: { id: string; onBack: () => void; onOpenSlip: (id: string) => void }) {
  const { run: act, busy } = useBosAction();
  const [view, setView] = useState<RunView>("register");
  const [adjusting, setAdjusting] = useState<BosPayslip | null>(null);
  const [paying, setPaying] = useState(false);
  const [confirm, setConfirm] = useState<"finalize" | "reopen" | "delete" | null>(null);
  const state = useBosData(() => bos.payrollRun(id), [id]);

  return (
    <Loaded state={state} rows={2}>
      {({ run: r, payslips, statutory, missing }) => {
        const draft = r.status === "draft";
        const label = monthLabel(r.period);
        const lop = payslips.reduce((s, p) => s + p.lopDays, 0);
        const register: BosColumn<BosPayslip>[] = [
          {
            key: "employee",
            header: "Employee",
            cell: (p) => (
              <span>
                {p.name}
                <span className="bos-text-faint"> · {p.empCode}</span>
              </span>
            ),
          },
          { key: "days", header: "Paid days", align: "right", mono: true, cell: (p) => (p.lopDays ? <span title={`${p.lopDays} day(s) loss of pay`}>{p.paidDays}/{p.daysInMonth} <span style={{ color: "var(--bos-coral-600)" }}>−{p.lopDays}</span></span> : `${p.paidDays}/${p.daysInMonth}`) },
          { key: "gross", header: "Gross", align: "right", mono: true, cell: (p) => inr(p.gross) },
          { key: "pf", header: "PF", align: "right", mono: true, cell: (p) => inr(lineAmount(p.deductions, "pf")) },
          { key: "esi", header: "ESI", align: "right", mono: true, cell: (p) => inr(lineAmount(p.deductions, "esi")) },
          { key: "pt", header: "PT", align: "right", mono: true, cell: (p) => inr(lineAmount(p.deductions, "pt")) },
          { key: "tds", header: "TDS", align: "right", mono: true, cell: (p) => inr(lineAmount(p.deductions, "tds")) },
          { key: "other", header: "Other", align: "right", mono: true, cell: (p) => inr(lineAmount(p.deductions, "other")) },
          { key: "net", header: "Net pay", align: "right", mono: true, cell: (p) => <strong>{inr(p.netPay)}</strong> },
          {
            key: "actions",
            header: "",
            cell: (p) =>
              draft ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAdjusting(p);
                  }}
                >
                  Adjust
                </Button>
              ) : null,
          },
        ];
        const statutoryCols: BosColumn<BosPayslip>[] = [
          { key: "employee", header: "Employee", cell: (p) => p.name },
          { key: "uan", header: "UAN", mono: true, cell: (p) => p.statutory?.uan ?? "—" },
          { key: "pfWage", header: "PF wage", align: "right", mono: true, cell: (p) => inr(p.statutory?.pfWage ?? 0) },
          { key: "pfEe", header: "PF (employee)", align: "right", mono: true, cell: (p) => inr(lineAmount(p.deductions, "pf")) },
          { key: "pfEr", header: "PF (employer)", align: "right", mono: true, cell: (p) => inr(lineAmount(p.employer, "pf")) },
          { key: "esiEe", header: "ESI (employee)", align: "right", mono: true, cell: (p) => inr(lineAmount(p.deductions, "esi")) },
          { key: "esiEr", header: "ESI (employer)", align: "right", mono: true, cell: (p) => inr(lineAmount(p.employer, "esi")) },
          { key: "pt", header: "PT", align: "right", mono: true, cell: (p) => inr(lineAmount(p.deductions, "pt")) },
          { key: "tds", header: "TDS", align: "right", mono: true, cell: (p) => inr(lineAmount(p.deductions, "tds")) },
          { key: "pan", header: "PAN", mono: true, cell: (p) => p.statutory?.pan ?? <span style={{ color: "var(--bos-amber-600)" }}>Missing</span> },
        ];
        const bankAdvice = async () => {
          const out = await act("bank", () => bos.bankAdvice(r.id), { refresh: false });
          if (!out) return;
          downloadCsv(
            `bank-advice_${r.period}.csv`,
            ["Emp code", "Beneficiary", "Account number", "IFSC", "Bank", "Amount"],
            out.rows.map((b) => ({ "Emp code": b.empCode, Beneficiary: b.holder, "Account number": b.account, IFSC: b.ifsc, Bank: b.bankName, Amount: b.amount })),
          );
        };
        return (
          <>
            <div className="bos-app-recordbar">
              <button type="button" className="bos-back-link" onClick={onBack}>
                ‹ Back to payroll
              </button>
              <div className="bos-app-actions">
                <Button size="sm" icon="download" disabled={!payslips.length} onClick={() => exportRegister(r.period, payslips)}>
                  Register CSV
                </Button>
                {draft ? (
                  <>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirm("delete")}>
                      Delete draft
                    </Button>
                    <Button size="sm" icon="refresh" disabled={busy !== null} onClick={() => act("recalc", () => bos.recalculatePayrollRun(r.id), { success: "Payroll recalculated", description: label })}>
                      {busy === "recalc" ? "Recalculating…" : "Recalculate"}
                    </Button>
                    <Button size="sm" variant="primary" icon="check" disabled={busy !== null || !payslips.length} onClick={() => setConfirm("finalize")}>
                      Finalise
                    </Button>
                  </>
                ) : (
                  <Button size="sm" icon="download" disabled={busy !== null} onClick={bankAdvice}>
                    Bank advice
                  </Button>
                )}
                {r.status === "finalized" ? (
                  <>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirm("reopen")}>
                      Reopen
                    </Button>
                    <Button size="sm" variant="success" icon="wallet" disabled={busy !== null} onClick={() => setPaying(true)}>
                      Mark paid
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
            <Stack>
              <Grid cols={4} min={140}>
                <KpiCard label={`Payroll · ${label}`} value={plural(r.employeeCount, "employee")} chip={{ color: "blue", glyph: "👥" }} delta={lop ? `${lop} day(s) loss of pay` : "No loss of pay"} deltaTone={lop ? "warn" : "muted"} interactive={false} />
                <KpiCard label="Gross pay" value={inr(r.grossTotal)} chip={{ color: "lavender", glyph: "₹" }} delta={`Employer cost ${inr(r.grossTotal + r.employerTotal)}`} deltaTone="muted" interactive={false} />
                <KpiCard label="Deductions" value={inr(r.deductionTotal)} chip={{ color: "rose", glyph: "−" }} delta="PF, ESI, PT, TDS & other" deltaTone="muted" interactive={false} />
                <KpiCard
                  label="Net pay"
                  value={inr(r.netTotal)}
                  valueTone="emerald"
                  chip={{ color: "mint", glyph: "✓" }}
                  delta={r.status === "paid" ? `Paid ${dateLabel(r.paidOn)}` : r.status === "finalized" ? "Finalised · ready to pay" : "Draft"}
                  deltaTone={r.status === "paid" ? "up" : "muted"}
                  interactive={false}
                />
              </Grid>
              {draft ? (
                <Alert tone="blue" title={`Draft${r.calculatedAt ? ` · calculated ${timeAgo(r.calculatedAt)}` : ""}`}>
                  Figures use salary structures, attendance and approved LOP leave as of the last calculation. Recalculate after changes, adjust individual payslips if needed, then finalise to release payslips to employees.
                </Alert>
              ) : (
                <Alert tone={r.status === "paid" ? "emerald" : "blue"} title={r.status === "paid" ? `Paid on ${dateLabel(r.paidOn)}` : "Finalised"}>
                  {r.status === "paid" ? "Payslips are locked and visible to employees in My Profile." : "Payslips are locked and visible to employees in My Profile. Reopen to make corrections before marking the run paid."}
                </Alert>
              )}
              {draft && missing.length ? (
                <Alert tone="amber" title={`${plural(missing.length, "employee")} not included`}>
                  {names(missing)} {missing.length === 1 ? "has" : "have"} no salary structure. Add one in Salary structures, then recalculate.
                </Alert>
              ) : null}
              <div>
                <ModuleToolbar>
                  <Segmented<RunView>
                    role="radio"
                    size="sm"
                    aria-label="Run view"
                    options={[
                      { value: "register", label: "Payroll register" },
                      { value: "statutory", label: "Statutory" },
                    ]}
                    value={view}
                    onChange={setView}
                  />
                </ModuleToolbar>
                <div style={{ marginTop: 12 }}>
                  {view === "register" ? (
                    <DataTable caption={`Payroll register, ${label}`} columns={register} rows={payslips} rowKey={(p) => p.id} onRowClick={(p) => onOpenSlip(p.id)} empty="No payslips — set up salary structures, then recalculate." compact />
                  ) : (
                    <DataTable caption={`Statutory deductions, ${label}`} columns={statutoryCols} rows={payslips} rowKey={(p) => p.id} onRowClick={(p) => onOpenSlip(p.id)} empty="No payslips yet." compact />
                  )}
                  <Pagination>
                    {view === "register"
                      ? `${plural(payslips.length, "payslip")} · click a row to open the payslip`
                      : `PF ${inr(statutory.pfEmployee + statutory.pfEmployer)} and ESI ${inr(statutory.esiEmployee + statutory.esiEmployer)} due ${dateLabel(statutory.due.pfEsi)} · TDS ${inr(statutory.tds)} due ${dateLabel(statutory.due.tds)}`}
                  </Pagination>
                </div>
              </div>
            </Stack>
            <AdjustDialog slip={adjusting} onClose={() => setAdjusting(null)} />
            <PayDialog run={paying ? r : null} onClose={() => setPaying(false)} />
            <ConfirmDialog
              open={confirm === "finalize"}
              onClose={() => setConfirm(null)}
              title={`Finalise payroll for ${label}?`}
              description={`${plural(payslips.length, "payslip")} · net pay ${inr(r.netTotal)}. Payslips are locked and become visible to employees. You can reopen the run until it's marked paid.`}
              confirmLabel="Finalise"
              busy={busy === "finalize"}
              onConfirm={async () => {
                await act("finalize", () => bos.finalizePayrollRun(r.id), { success: `Payroll for ${label} finalised`, description: "Payslips are now visible to employees." });
                setConfirm(null);
              }}
            />
            <ConfirmDialog
              open={confirm === "reopen"}
              onClose={() => setConfirm(null)}
              title={`Reopen payroll for ${label}?`}
              description="The run goes back to draft and payslips are hidden from employees until you finalise again."
              confirmLabel="Reopen"
              busy={busy === "reopen"}
              onConfirm={async () => {
                await act("reopen", () => bos.reopenPayrollRun(r.id), { success: "Payroll reopened", tone: "amber", description: label });
                setConfirm(null);
              }}
            />
            <ConfirmDialog
              open={confirm === "delete"}
              onClose={() => setConfirm(null)}
              destructive
              title={`Delete the draft for ${label}?`}
              description="Its payslips and adjustments are removed. You can run payroll for this month again."
              confirmLabel="Delete"
              busy={busy === "delete"}
              onConfirm={async () => {
                const ok = await act("delete", () => bos.deletePayrollRun(r.id), { success: "Draft deleted", description: label });
                setConfirm(null);
                if (ok !== undefined) onBack();
              }}
            />
          </>
        );
      }}
    </Loaded>
  );
}

function AdjustDialog({ slip, onClose }: { slip: BosPayslip | null; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const init = () => ({
    bonus: slip?.adjustments.bonus ? String(slip.adjustments.bonus) : "",
    otherDeduction: slip?.adjustments.otherDeduction ? String(slip.adjustments.otherDeduction) : "",
    tdsOverride: slip?.adjustments.tdsOverride !== null && slip?.adjustments.tdsOverride !== undefined ? String(slip.adjustments.tdsOverride) : "",
    lopDays: slip?.adjustments.lopDays !== null && slip?.adjustments.lopDays !== undefined ? String(slip.adjustments.lopDays) : "",
    note: slip?.adjustments.note ?? "",
  });
  const f = useFormState(init);
  const { setValues } = f;
  useEffect(() => {
    if (slip) setValues(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refill when a different payslip opens
  }, [slip?.id]);
  const v = f.values;
  const computedLop = slip?.attendance?.computedLop ?? 0;
  const submit = async () => {
    if (!slip) return;
    const ok = await run(
      "adjust",
      () =>
        bos.adjustPayslip(slip.id, {
          bonus: Number(v.bonus) || 0,
          otherDeduction: Number(v.otherDeduction) || 0,
          tdsOverride: blankToNull(v.tdsOverride),
          lopDays: blankToNull(v.lopDays),
          note: v.note.trim() || null,
        }),
      { success: "Payslip updated", description: slip.name },
    );
    if (ok) onClose();
  };
  return (
    <FormDialog
      open={slip !== null}
      onClose={onClose}
      title={slip ? `Adjust ${slip.name}'s payslip` : "Adjust payslip"}
      description="Applies to this month only. Leave a field blank to use the calculated value."
      icon={{ tone: "blue", name: "edit" }}
      submitLabel="Save & recalculate"
      busy={busy === "adjust"}
      onSubmit={submit}
      wide
    >
      <FormGrid>
        <Field label="Bonus / incentive (₹)" hint="Paid in full; not part of the PF or ESI wage">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} step="1" inputMode="numeric" value={v.bonus} onChange={(e) => f.set("bonus")(e.target.value)} />}
        </Field>
        <Field label="Other deductions (₹)" hint="Advances, recoveries">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} step="1" inputMode="numeric" value={v.otherDeduction} onChange={(e) => f.set("otherDeduction")(e.target.value)} />}
        </Field>
        <Field label="TDS this month (₹)" hint="Blank = as per salary structure">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} step="1" inputMode="numeric" value={v.tdsOverride} onChange={(e) => f.set("tdsOverride")(e.target.value)} />}
        </Field>
        <Field label="Loss-of-pay days" hint={`Blank = ${computedLop} from attendance & LOP leave`}>
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} max={31} step="0.5" inputMode="decimal" value={v.lopDays} onChange={(e) => f.set("lopDays")(e.target.value)} />}
        </Field>
        <Field label="Note" full>
          {({ id }) => <Input id={id} maxLength={200} value={v.note} placeholder="Optional — e.g. Diwali bonus" onChange={(e) => f.set("note")(e.target.value)} />}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

function PayDialog({ run: payroll, onClose }: { run: PayrollRun | null; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const [paidOn, setPaidOn] = useState(todayLocal());
  return (
    <FormDialog
      open={payroll !== null}
      onClose={onClose}
      title={payroll ? `Mark ${monthLabel(payroll.period)} salaries paid` : "Mark paid"}
      description={payroll ? `${plural(payroll.employeeCount, "employee")} · ${inr(payroll.netTotal)}. Use the bank advice to make the transfers first.` : undefined}
      icon={{ tone: "emerald", name: "wallet" }}
      submitLabel="Mark paid"
      busy={busy === "pay"}
      onSubmit={async () => {
        if (!payroll) return;
        const ok = await run("pay", () => bos.payPayrollRun(payroll.id, paidOn), { success: "Salaries marked paid", description: monthLabel(payroll.period) });
        if (ok) onClose();
      }}
    >
      <FormGrid>
        <Field label="Paid on">{({ id }) => <Input id={id} type="date" required min={payroll ? `${payroll.period}-01` : undefined} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}</Field>
      </FormGrid>
    </FormDialog>
  );
}

/* ---------- Payslip ---------- */

export function PayslipPaper({ slip }: { slip: BosPayslip }) {
  const { session } = useBosApp();
  const s = session.settings;
  const brand = session.brand?.name || s.companyName || "Your Company";
  const seller = [s.address, [s.gstin && `GSTIN ${s.gstin}`, s.state].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
  const rows = Math.max(slip.earnings.length, slip.deductions.length, 1);
  const meta: Array<[string, string]> = [
    ["Employee", slip.name],
    ["Employee ID", slip.empCode],
    ["Designation", slip.designation ?? "—"],
    ["Department", slip.departmentName ?? "—"],
    ["Paid days", `${slip.paidDays} of ${slip.daysInMonth}${slip.lopDays ? ` · ${slip.lopDays} LOP` : ""}`],
    ["PAN / UAN", [slip.statutory?.pan, slip.statutory?.uan].filter(Boolean).join(" · ") || "—"],
  ];
  return (
    <article className="bos-inv-paper bos-payslip" aria-label="Payslip">
      <div className="bos-inv-paper-top">
        <div>
          <div className="bos-inv-paper-brand">{brand}</div>
          {seller ? <div className="bos-inv-paper-seller">{seller}</div> : null}
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="bos-inv-paper-title">PAYSLIP</div>
          <div className="bos-inv-paper-sub">{slip.period ? monthLabel(slip.period) : ""}</div>
        </div>
      </div>
      <div className="bos-inv-paper-meta bos-payslip-meta">
        {meta.map(([label, value]) => (
          <div key={label}>
            <div className="bos-inv-paper-label">{label}</div>
            <div className="bos-inv-paper-value">{value}</div>
          </div>
        ))}
      </div>
      <table className="bos-inv-paper-table">
        <thead>
          <tr>
            <th>Earnings</th>
            <th>Amount</th>
            <th>Deductions</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => {
            const e = slip.earnings[i];
            const d = slip.deductions[i];
            return (
              <tr key={i}>
                <td>{e?.label ?? ""}</td>
                <td>{e ? inr(e.amount) : ""}</td>
                <td>{d?.label ?? (i === 0 ? "No deductions" : "")}</td>
                <td>{d ? inr(d.amount) : ""}</td>
              </tr>
            );
          })}
          <tr className="bos-payslip-subtotal">
            <td>Gross earnings</td>
            <td>{inr(slip.gross)}</td>
            <td>Total deductions</td>
            <td>{inr(slip.totalDeductions)}</td>
          </tr>
        </tbody>
      </table>
      <div className="bos-inv-totals">
        <div className="bos-inv-totals-row is-total">
          <span>Net pay</span>
          <span>{inr(slip.netPay)}</span>
        </div>
      </div>
      <div className="bos-payslip-words">{rupeesInWords(slip.netPay)}</div>
      {slip.employer.length ? (
        <div className="bos-payslip-note">
          Employer contributions (not part of take-home): {slip.employer.map((l) => `${l.label} ${inr(l.amount)}`).join(" · ")}
        </div>
      ) : null}
      {slip.adjustments.note ? <div className="bos-payslip-note">Note: {slip.adjustments.note}</div> : null}
      <div className="bos-payslip-note">This is a computer-generated payslip and does not need a signature. · Powered by Justx BOS</div>
    </article>
  );
}

function PayslipView({ id, onBack, backLabel }: { id: string; onBack: () => void; backLabel: string }) {
  const print = usePrint();
  const state = useBosData(() => bos.payslip(id), [id]);
  return (
    <>
      <div className="bos-app-recordbar">
        <button type="button" className="bos-back-link" onClick={onBack}>
          ‹ {backLabel}
        </button>
        <div className="bos-app-actions">
          <Button size="sm" icon="printer" disabled={!state.data} onClick={print}>
            Print / PDF
          </Button>
        </div>
      </div>
      <Loaded state={state} rows={1}>
        {({ payslip }) => (
          <div className="bos-payslip-wrap">
            {payslip.runStatus === "draft" ? (
              <div style={{ marginBottom: 12 }}>
                <Alert tone="amber" title="Draft payslip">
                  Employees can&apos;t see this yet — it is released when the run is finalised.
                </Alert>
              </div>
            ) : null}
            <PayslipPaper slip={payslip} />
          </div>
        )}
      </Loaded>
    </>
  );
}

/** Released payslips for one employee (profile tab and My Profile). */
export function PayslipList({ payslips, empty }: { payslips: ReadonlyArray<BosPayslip>; empty: string }) {
  const { navigate } = useBosApp();
  return (
    <DataTable
      caption="Payslips"
      rowKey={(p) => p.id}
      rows={payslips}
      empty={empty}
      onRowClick={(p) => navigate("finance", "payroll", `payslip:${p.id}`)}
      columns={[
        { key: "month", header: "Month", cell: (p) => (p.period ? monthLabel(p.period) : "—") },
        { key: "days", header: "Paid days", align: "right", mono: true, cell: (p) => `${p.paidDays}/${p.daysInMonth}` },
        { key: "gross", header: "Gross", align: "right", mono: true, cell: (p) => inr(p.gross) },
        { key: "deductions", header: "Deductions", align: "right", mono: true, cell: (p) => inr(p.totalDeductions) },
        { key: "net", header: "Net pay", align: "right", mono: true, cell: (p) => <strong>{inr(p.netPay)}</strong> },
        { key: "status", header: "Status", cell: (p) => (p.runStatus ? <StatusBadge view={payrollBadge(p.runStatus)} /> : null) },
      ]}
    />
  );
}

/* ---------- Salary structures ---------- */

function StructuresSection() {
  const [editing, setEditing] = useState<PayrollEmployee | null>(null);
  const [query, setQuery] = useState("");
  const state = useBosData(() => bos.salaryStructures(), []);

  return (
    <Loaded state={state}>
      {({ employees, config, settingsSaved }) => {
        const q = query.trim().toLowerCase();
        const rows = employees.filter((e) => !q || `${e.name} ${e.empCode} ${e.designation ?? ""} ${e.departmentName ?? ""}`.toLowerCase().includes(q));
        const set = employees.filter((e) => e.structure);
        const columns: BosColumn<PayrollEmployee>[] = [
          {
            key: "employee",
            header: "Employee",
            cell: (e) => (
              <span>
                {e.name}
                <span className="bos-text-faint"> · {e.empCode}</span>
              </span>
            ),
          },
          { key: "designation", header: "Designation", cell: (e) => e.designation ?? "—" },
          { key: "ctc", header: "Annual CTC", align: "right", mono: true, cell: (e) => (e.ctcAnnual ? inr(e.ctcAnnual) : "—") },
          { key: "gross", header: "Monthly gross", align: "right", mono: true, cell: (e) => (e.structure ? inr(e.structure.gross) : "—") },
          { key: "basic", header: "Basic", align: "right", mono: true, cell: (e) => (e.structure ? inr(e.structure.basic) : "—") },
          { key: "tds", header: "TDS / month", align: "right", mono: true, cell: (e) => (e.structure ? (e.structure.tdsMonthly !== null ? inr(e.structure.tdsMonthly) : <span title="New-regime estimate">≈ {inr(e.structure.tdsEstimate)}</span>) : "—") },
          {
            key: "status",
            header: "Status",
            cell: (e) => <StatusBadge view={e.structure ? { text: "SET", tone: "emerald" } : { text: "NOT SET", tone: "amber" }} />,
          },
          {
            key: "action",
            header: "",
            cell: (e) => (
              <Button
                size="sm"
                variant={e.structure ? "ghost" : "primary"}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setEditing(e);
                }}
              >
                {e.structure ? "Edit" : "Set up"}
              </Button>
            ),
          },
        ];
        return (
          <Stack>
            <Grid cols={4} min={140}>
              <KpiCard label="Employees" value={employees.filter((e) => e.status !== "exited").length} chip={{ color: "blue", glyph: "👥" }} delta="Active, probation & notice" deltaTone="muted" />
              <KpiCard label="Salary set" value={set.length} chip={{ color: "mint", glyph: "✓" }} delta={`${employees.length - set.length} still to set up`} deltaTone={employees.length - set.length ? "warn" : "up"} />
              <KpiCard label="Monthly gross" value={inrCompact(set.reduce((s, e) => s + (e.structure?.gross ?? 0), 0))} chip={{ color: "lavender", glyph: "₹" }} delta="Before deductions" deltaTone="muted" />
              <KpiCard label="Annual payroll" value={inrCompact(set.reduce((s, e) => s + (e.structure?.gross ?? 0), 0) * 12)} chip={{ color: "rose", glyph: "◎" }} delta="Gross × 12" deltaTone="muted" />
            </Grid>
            {!settingsSaved ? (
              <Alert tone="blue" title="Suggestions use the default split">
                Basic {config.basicPct}% of gross and HRA {config.hraPct}% of basic, with PF off. Review payroll settings first if your company deducts PF — the employer&apos;s PF share then comes out of the CTC.
              </Alert>
            ) : null}
            <div>
              <ModuleToolbar>
                <SearchInput placeholder="Search employees…" aria-label="Search employees" value={query} onChange={(e) => setQuery(e.target.value)} />
              </ModuleToolbar>
              <div style={{ marginTop: 12 }}>
                <DataTable caption="Salary structures" columns={columns} rows={rows} rowKey={(e) => e.employeeId} onRowClick={setEditing} empty={employees.length ? "No employees match." : "No employees yet — add them in HR Management → Employees."} />
                <Pagination>Monthly amounts · TDS marked ≈ is the new-regime estimate</Pagination>
              </div>
            </div>
            <StructureDialog employee={editing} config={config} onClose={() => setEditing(null)} />
          </Stack>
        );
      }}
    </Loaded>
  );
}

function StructureDialog({ employee, config, onClose }: { employee: PayrollEmployee | null; config: PayrollConfig; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const init = () => {
    const s = employee?.structure;
    const base = s ?? employee?.suggested ?? { basic: 0, hra: 0, special: 0 };
    return {
      basic: base.basic ? String(base.basic) : "",
      hra: base.hra ? String(base.hra) : "",
      special: base.special ? String(base.special) : "",
      pf: s ? s.pf : true,
      pt: s ? s.pt : true,
      tdsMode: s && s.tdsMonthly !== null ? "fixed" : "auto",
      tdsMonthly: s && s.tdsMonthly !== null ? String(s.tdsMonthly) : "",
      pan: s?.pan ?? "",
      uan: s?.uan ?? "",
      pfNumber: s?.pfNumber ?? "",
      esiNumber: s?.esiNumber ?? "",
    };
  };
  const f = useFormState(init);
  const { setValues } = f;
  useEffect(() => {
    if (employee) setValues(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refill when a different employee opens
  }, [employee?.employeeId]);
  const v = f.values;
  const gross = (Number(v.basic) || 0) + (Number(v.hra) || 0) + (Number(v.special) || 0);
  const submit = async () => {
    if (!employee) return;
    const ok = await run(
      "structure",
      () =>
        bos.saveSalaryStructure(employee.employeeId, {
          basic: Number(v.basic) || 0,
          hra: Number(v.hra) || 0,
          special: Number(v.special) || 0,
          pf: v.pf,
          pt: v.pt,
          tdsMonthly: v.tdsMode === "fixed" ? Number(v.tdsMonthly) || 0 : null,
          pan: v.pan.trim() || null,
          uan: v.uan.trim() || null,
          pfNumber: v.pfNumber.trim() || null,
          esiNumber: v.esiNumber.trim() || null,
        }),
      { success: "Salary structure saved", description: employee.name },
    );
    if (ok) onClose();
  };
  const money = (key: "basic" | "hra" | "special", label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} step="1" inputMode="numeric" value={v[key]} onChange={(e) => f.set(key)(e.target.value)} />}
    </Field>
  );
  return (
    <FormDialog
      open={employee !== null}
      onClose={onClose}
      title={employee ? `Salary · ${employee.name}` : "Salary structure"}
      description={employee?.ctcAnnual ? `Annual CTC on record ${inr(employee.ctcAnnual)} · monthly amounts below` : "Monthly amounts. Add the CTC on the employee record to get a suggested split."}
      icon={{ tone: "emerald", name: "wallet" }}
      submitLabel="Save salary"
      busy={busy === "structure"}
      onSubmit={submit}
      wide
      note={`Monthly gross ${inr(gross)} · annual ${inr(gross * 12)}`}
    >
      {employee?.suggested ? (
        <div style={{ marginBottom: 12 }}>
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => setValues((s) => ({ ...s, basic: String(employee.suggested!.basic), hra: String(employee.suggested!.hra), special: String(employee.suggested!.special) }))}>
            Fill from CTC
          </Button>
        </div>
      ) : null}
      <FormGrid>
        {money("basic", "Basic (₹ / month)", `PF is 12% of basic${config.pfCapWage ? ", up to ₹15,000" : ""}`)}
        {money("hra", "HRA (₹ / month)")}
        {money("special", "Special allowance (₹ / month)")}
        <Field label="Income tax (TDS)">
          {({ id }) => (
            <Select id={id} value={v.tdsMode} onChange={(e) => f.set("tdsMode")(e.target.value)}>
              <option value="auto">New-regime estimate</option>
              <option value="fixed">Fixed monthly amount</option>
            </Select>
          )}
        </Field>
        {v.tdsMode === "fixed" ? (
          <Field label="TDS (₹ / month)" hint="From the employee's declarations">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} step="1" inputMode="numeric" required value={v.tdsMonthly} onChange={(e) => f.set("tdsMonthly")(e.target.value)} />}
          </Field>
        ) : null}
        <Field label="PAN">{({ id }) => <Input id={id} value={v.pan} maxLength={10} placeholder="ABCDE1234F" onChange={(e) => f.set("pan")(e.target.value.toUpperCase())} />}</Field>
        <Field label="UAN">{({ id }) => <Input id={id} value={v.uan} maxLength={12} inputMode="numeric" placeholder="12 digits" onChange={(e) => f.set("uan")(e.target.value.replace(/\D/g, ""))} />}</Field>
        <Field label="PF number">{({ id }) => <Input id={id} value={v.pfNumber} maxLength={40} onChange={(e) => f.set("pfNumber")(e.target.value)} />}</Field>
        <Field label="ESI number">{({ id }) => <Input id={id} value={v.esiNumber} maxLength={20} onChange={(e) => f.set("esiNumber")(e.target.value)} />}</Field>
      </FormGrid>
      <div className="bos-row" style={{ gap: 18, marginTop: 12, fontSize: 12.5, flexWrap: "wrap" }}>
        <label className="bos-row" style={{ gap: 8 }}>
          <Checkbox checked={v.pf} onChange={f.set("pf")} aria-label="Deduct PF" />
          Deduct PF{config.pfEnabled ? "" : " (PF is off in settings)"}
        </label>
        <label className="bos-row" style={{ gap: 8 }}>
          <Checkbox checked={v.pt} onChange={f.set("pt")} aria-label="Deduct professional tax" />
          Deduct professional tax{config.ptSlabs.length ? "" : " (no slabs in settings)"}
        </label>
      </div>
    </FormDialog>
  );
}

/* ---------- Settings ---------- */

function SettingsSection({ onSaved }: { onSaved: () => void }) {
  const state = useBosData(() => bos.payrollSettings(), []);
  return <Loaded state={state}>{(s) => <SettingsForm key={s.updatedAt ?? "new"} initial={s.config} saved={s.saved} onSaved={onSaved} />}</Loaded>;
}

type SlabDraft = { from: string; amount: string };

function SettingsForm({ initial, saved, onSaved }: { initial: PayrollConfig; saved: boolean; onSaved: () => void }) {
  const { run, busy } = useBosAction();
  const [c, setC] = useState<PayrollConfig>(initial);
  const [slabs, setSlabs] = useState<SlabDraft[]>(() => initial.ptSlabs.map((s) => ({ from: String(s.from), amount: String(s.amount) })));
  const set = <K extends keyof PayrollConfig>(k: K, value: PayrollConfig[K]) => setC((d) => ({ ...d, [k]: value }));
  const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void, note: string) => (
    <div className="bos-row" style={{ gap: 10, alignItems: "flex-start" }}>
      <Switch checked={checked} onChange={onChange} aria-label={label} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div className="bos-text-faint" style={{ fontSize: 12, marginTop: 2 }}>
          {note}
        </div>
      </div>
    </div>
  );
  const submit = async () => {
    const ptSlabs = slabs.filter((s) => s.from.trim() !== "" && s.amount.trim() !== "").map((s) => ({ from: Number(s.from), amount: Number(s.amount) }));
    const out = await run("payroll-settings", () => bos.savePayrollSettings({ ...c, ptSlabs }), { success: "Payroll settings saved" });
    if (out) onSaved();
  };
  return (
    <Card interactive={false} style={{ maxWidth: 760 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="bos-kpi-label">Payroll settings</div>
        <div className="bos-text-faint" style={{ fontSize: 12, margin: "4px 0 16px" }}>
          {saved ? "Changes apply to drafts when they are recalculated; finalised payslips never change." : "Review these once before your first payroll run. Statutory deductions start off — turn on what applies to your establishment."}
        </div>
        <Stack gap={16}>
          <FormGrid>
            <Field label="Basic (% of gross)" hint="Used to split a CTC into a suggested structure">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={10} max={100} step="any" required value={c.basicPct} onChange={(e) => set("basicPct", Number(e.target.value))} />}
            </Field>
            <Field label="HRA (% of basic)">{({ id }) => <Input id={id} type="number" min={0} max={100} step="any" required value={c.hraPct} onChange={(e) => set("hraPct", Number(e.target.value))} />}</Field>
          </FormGrid>
          {toggle("Provident fund (EPF)", c.pfEnabled, (v) => set("pfEnabled", v), "12% of basic from the employee and 12% from the employer. Required for establishments with 20 or more employees.")}
          {c.pfEnabled ? <div style={{ marginLeft: 46 }}>{toggle("Cap the PF wage at ₹15,000", c.pfCapWage, (v) => set("pfCapWage", v), "Contributions stop at ₹1,800 a month each, the statutory minimum.")}</div> : null}
          {toggle("Employees' State Insurance (ESI)", c.esiEnabled, (v) => set("esiEnabled", v), "0.75% from the employee and 3.25% from the employer, for employees earning up to ₹21,000 gross a month.")}
          {toggle("Pay unmarked days", c.unmarkedPaid, (v) => set("unmarkedPaid", v), "Working days with no attendance mark are paid. Turn off if every working day is marked, so unmarked days become loss of pay.")}
          <div>
            <div className="bos-field-label" style={{ marginBottom: 6 }}>
              Professional tax slabs (monthly)
            </div>
            <div className="bos-text-faint" style={{ fontSize: 12, marginBottom: 10 }}>
              PT varies by state. Enter your state&apos;s slabs: the highest slab the month&apos;s gross reaches applies — e.g. gross from ₹25,000 → ₹200. Leave empty if PT doesn&apos;t apply.
            </div>
            <Stack gap={8}>
              {slabs.map((s, i) => (
                <div key={i} className="bos-row" style={{ gap: 8, alignItems: "flex-end" }}>
                  <Field label={`Gross from (₹) · slab ${i + 1}`}>
                    {({ id }) => <Input id={id} type="number" min={0} step="1" size="sm" value={s.from} onChange={(e) => setSlabs((list) => list.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />}
                  </Field>
                  <Field label="PT (₹ / month)">
                    {({ id }) => <Input id={id} type="number" min={0} step="1" size="sm" value={s.amount} onChange={(e) => setSlabs((list) => list.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />}
                  </Field>
                  <Button size="sm" variant="ghost" aria-label={`Remove slab ${i + 1}`} onClick={() => setSlabs((list) => list.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </div>
              ))}
              <div>
                <Button size="sm" icon="plus" disabled={slabs.length >= 12} onClick={() => setSlabs((list) => [...list, { from: "", amount: "" }])}>
                  Add slab
                </Button>
              </div>
            </Stack>
          </div>
        </Stack>
        <div className="bos-row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
          <Button size="sm" variant="primary" type="submit" icon="check" disabled={busy !== null}>
            {busy ? "Saving…" : saved ? "Save settings" : "Save & continue"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

"use client";

import "./insights.css";
import { useState } from "react";
import { Alert, Button, Card, FilterChip, Grid, Input, KpiCard, type BosChipColor } from "@/components/bos";
import { Loaded, PageHeader, PeriodPicker, RequirePerm, Stack, SubTabs, useIms, useImsData, useOpenIntent, usePrint } from "../core";
import type { Period } from "@/lib/ims/api";
import { REPORT_CATALOG, catalogEntry, reports, type ReportFilterKey, type ReportFilters, type ReportMeta, type ReportResult, type ReportSummary, type ReportType, type SavedReport } from "@/lib/ims/reports";
import { addDaysISO, downloadCsv, downloadXlsx } from "@/lib/ims/format";
import { ReportChartView, ReportPaper, ReportTable, cellText, exportColumns, filterControls, filtersText, periodText, useDebounced, useDialog } from "./report-view";
import { SavedReportDialog, SavedReportsTab, type SavedDraft } from "./saved";

type Tab = "catalog" | "saved";
type RunnerSpec = { seq: number; type: ReportType; initial: SavedDraft | null; saved: SavedReport | null };

const GROUPS = ["Inventory", "Purchasing", "Sales & finance", "People"] as const;

export function ReportsModule() {
  return (
    <RequirePerm perm={["reports", "audit"]} what="reports">
      <ReportsWorkspace />
    </RequirePerm>
  );
}

function ReportsWorkspace() {
  const { session, can } = useIms();
  const openId = useOpenIntent("reports");
  const today = session.today;
  const [tab, setTab] = useState<Tab>(openId ? "saved" : "catalog");
  const [runner, setRunner] = useState<RunnerSpec | null>(null);
  const meta = useImsData(() => reports.meta(), []);
  const saveDlg = useDialog<SavedDraft | null>(null);

  const openRunner = (type: ReportType, initial: SavedDraft | null = null, saved: SavedReport | null = null) => setRunner((r) => ({ seq: (r?.seq ?? 0) + 1, type, initial, saved }));

  return (
    <Stack>
      <PageHeader
        title="Reports"
        sub="Stock, purchasing, sales and field reports — filter, export, print, save and schedule."
        actions={
          can("reports") ? (
            <Button size="sm" variant="primary" icon="plus" onClick={() => saveDlg.show(null)}>
              New saved report
            </Button>
          ) : undefined
        }
      />
      {runner ? null : (
        <SubTabs
          label="Reports sections"
          value={tab}
          onChange={setTab}
          options={[
            { value: "catalog", label: "All reports" },
            { value: "saved", label: "Saved & scheduled" },
          ]}
        />
      )}

      {runner ? (
        <ReportRunner
          key={runner.seq}
          spec={runner}
          meta={meta.data}
          today={today}
          onBack={() => setRunner(null)}
          onSave={(draft) => saveDlg.show(draft)}
        />
      ) : tab === "catalog" ? (
        <Catalog onRun={(t) => openRunner(t)} />
      ) : (
        <SavedReportsTab
          meta={meta.data}
          openId={openId}
          today={today}
          onCreate={() => saveDlg.show(null)}
          onRun={(s) => openRunner(s.type, { type: s.type, period: s.period, from: s.from, to: s.to, filters: s.filters }, s)}
        />
      )}

      {can("reports") ? <SavedReportDialog key={`new-${saveDlg.seq}`} open={saveDlg.open} onClose={saveDlg.hide} meta={meta.data} saved={null} draft={saveDlg.value} today={today} /> : null}
    </Stack>
  );
}

/* ---------- Catalog ---------- */

function Catalog({ onRun }: { onRun: (t: ReportType) => void }) {
  return (
    <div>
      {GROUPS.map((g) => (
        <section key={g} aria-label={g}>
          <div className="ims-group-title">{g}</div>
          <div className="ims-tiles">
            {REPORT_CATALOG.filter((r) => r.group === g).map((r) => (
              <button key={r.type} type="button" className="ims-tile" onClick={() => onRun(r.type)}>
                <span className="ims-tile-ic" style={{ background: r.tint }} aria-hidden="true">
                  {r.icon}
                </span>
                <span className="ims-rp-tile-text">
                  <span className="ims-tile-title">{r.label}</span>
                  <span className="ims-tile-desc">{r.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---------- Runner ---------- */

const CHIP: Record<NonNullable<ReportSummary["tone"]> | "none", BosChipColor> = { blue: "blue", emerald: "mint", amber: "amber", coral: "rose", none: "lavender" };

function ReportRunner({ spec, meta, today, onBack, onSave }: { spec: RunnerSpec; meta: ReportMeta | null; today: string; onBack: () => void; onSave: (draft: SavedDraft) => void }) {
  const { session, can } = useIms();
  const entry = catalogEntry(spec.type);
  const print = usePrint();
  const [period, setPeriod] = useState<Period>(spec.initial?.period ?? "30d");
  const [from, setFrom] = useState(spec.initial?.from ?? addDaysISO(today, -29));
  const [to, setTo] = useState(spec.initial?.to ?? today);
  const [filters, setFilters] = useState<ReportFilters>(() => {
    const f = { ...(spec.initial?.filters ?? {}) };
    delete f.q;
    return f;
  });
  const [qText, setQText] = useState(spec.initial?.filters.q ?? "");
  const [dirty, setDirty] = useState(false);
  const [paper, setPaper] = useState(false);
  const [exporting, setExporting] = useState(false);
  const q = useDebounced(qText.trim());

  const customOk = period !== "custom" || Boolean(from && to && from <= to);
  const params = { type: spec.type, period, from: period === "custom" ? from : undefined, to: period === "custom" ? to : undefined, ...filters, q: q || undefined };
  const fromSaved = Boolean(spec.saved && !dirty);
  const state = useImsData<ReportResult | null>(
    () => (!customOk ? Promise.resolve(null) : fromSaved && spec.saved ? reports.runSaved(spec.saved.id).then((r) => r.report) : reports.run(params).then((r) => r.report)),
    [JSON.stringify(params), customOk, fromSaved],
  );

  const touch = () => setDirty(true);
  const setF = (key: ReportFilterKey, value: string) => {
    touch();
    setFilters((f) => {
      const next = { ...f };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  };
  const allFilters: ReportFilters = { ...filters, ...(q ? { q } : {}) };
  const business = {
    name: session.brand?.name || session.settings.businessName,
    gstin: session.brand?.gstin ?? session.settings.gstin,
    address: [session.brand?.address ?? session.settings.address, session.brand?.state ?? session.settings.state].filter(Boolean).join(", ") || null,
  };
  const fileBase = (r: ReportResult) => `${spec.type}-${r.range ? `${r.range.from}-to-${r.range.to}` : r.asOf}`;

  const controls = filterControls(entry, meta, filters, setF, "sm");

  return (
    <Stack gap={16}>
      <Card interactive={false}>
        <div className="ims-rp-head">
          <Button size="sm" variant="ghost" icon="chevronLeft" onClick={onBack}>
            All reports
          </Button>
          <span className="ims-tile-ic" style={{ background: entry.tint }} aria-hidden="true">
            {entry.icon}
          </span>
          <div className="ims-rp-head-text">
            <h2 className="ims-rp-title">{spec.saved ? spec.saved.name : entry.label}</h2>
            <div className="ims-faint">{spec.saved ? `${entry.label} · saved report${dirty ? " (modified — not saved)" : ""}` : entry.desc}</div>
          </div>
        </div>
        <div className="ims-rp-controls" style={{ marginTop: 14 }}>
          {entry.usesPeriod ? (
            <>
              <PeriodPicker
                value={period}
                onChange={(p) => {
                  touch();
                  setPeriod(p);
                }}
              />
              <FilterChip
                active={period === "custom"}
                onClick={() => {
                  touch();
                  setPeriod("custom");
                }}
              >
                Custom
              </FilterChip>
              {period === "custom" ? (
                <>
                  <Input
                    type="date"
                    size="sm"
                    aria-label="From"
                    value={from}
                    max={to || today}
                    onChange={(e) => {
                      touch();
                      setFrom(e.target.value);
                    }}
                    style={{ width: 150 }}
                  />
                  <Input
                    type="date"
                    size="sm"
                    aria-label="To"
                    value={to}
                    min={from}
                    max={today}
                    onChange={(e) => {
                      touch();
                      setTo(e.target.value);
                    }}
                    style={{ width: 150 }}
                  />
                </>
              ) : null}
            </>
          ) : (
            <span className="ims-faint">Snapshot as of today</span>
          )}
        </div>
        <div className="ims-toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
          {controls.map((c) => (
            <span key={c.key}>{c.render()}</span>
          ))}
          {entry.filters.includes("q") ? (
            <Input
              className="ims-grow"
              size="sm"
              type="search"
              placeholder="Search…"
              value={qText}
              onChange={(e) => {
                touch();
                setQText(e.target.value);
              }}
              aria-label="Search report rows"
            />
          ) : (
            <span className="ims-grow" />
          )}
          <Button
            size="sm"
            icon="download"
            disabled={!state.data?.rows.length}
            onClick={() => {
              if (state.data) downloadCsv(fileBase(state.data), state.data.rows, exportColumns(state.data));
            }}
          >
            CSV
          </Button>
          <Button
            size="sm"
            icon="download"
            disabled={!state.data?.rows.length || exporting}
            onClick={async () => {
              if (!state.data) return;
              setExporting(true);
              try {
                await downloadXlsx(fileBase(state.data), state.data.title, state.data.rows, exportColumns(state.data));
              } finally {
                setExporting(false);
              }
            }}
          >
            Excel
          </Button>
          <Button
            size="sm"
            icon="printer"
            disabled={!state.data}
            onClick={() => {
              setPaper(true);
              window.setTimeout(print, 80);
            }}
          >
            Print
          </Button>
          {can("reports") ? (
            <Button size="sm" variant="primary" icon="calendar" onClick={() => onSave({ type: spec.type, period, from: period === "custom" ? from : null, to: period === "custom" ? to : null, filters: allFilters })}>
              Save & schedule
            </Button>
          ) : null}
        </div>
      </Card>

      {!customOk ? (
        <Alert tone="amber" title="Check the dates">
          The start date must be on or before the end date.
        </Alert>
      ) : (
        <Loaded state={state} rows={2}>
          {(report) =>
            report ? (
              <ReportBody
                report={report}
                refreshing={state.loading}
                paper={paper}
                onClosePaper={() => setPaper(false)}
                onPrint={print}
                business={business}
                filters={filtersText(entry, meta, allFilters)}
                preparedBy={session.actor.name}
              />
            ) : null
          }
        </Loaded>
      )}
    </Stack>
  );
}

function ReportBody({
  report,
  refreshing,
  paper,
  onClosePaper,
  onPrint,
  business,
  filters,
  preparedBy,
}: {
  report: ReportResult;
  refreshing: boolean;
  paper: boolean;
  onClosePaper: () => void;
  onPrint: () => void;
  business: { name: string; gstin: string | null; address: string | null };
  filters: string[];
  preparedBy: string | null;
}) {
  return (
    <Stack gap={16}>
      {report.summary.length ? (
        <Grid cols={Math.min(4, report.summary.length)} min={150}>
          {report.summary.slice(0, 8).map((s) => (
            <KpiCard
              key={s.label}
              label={s.label}
              value={typeof s.value === "number" ? cellText(s.value, s.kind) : s.value}
              chip={{ color: CHIP[s.tone ?? "none"], glyph: s.kind === "money" ? "₹" : s.kind === "pct" ? "%" : "#" }}
              valueTone={s.tone === "coral" || s.tone === "amber" ? s.tone : undefined}
              delta={s.hint}
              deltaTone="muted"
              interactive={false}
            />
          ))}
        </Grid>
      ) : null}

      <div className={report.chart ? "ims-split" : undefined}>
        <Card interactive={false}>
          <div className="ims-between" style={{ marginBottom: 10 }}>
            <h3 className="ims-rp-section-title" style={{ margin: 0 }}>
              {report.title} · {periodText(report)}
            </h3>
            <span className="ims-faint" aria-live="polite">
              {refreshing ? "Refreshing…" : `${report.rows.length.toLocaleString("en-IN")} rows`}
            </span>
          </div>
          <ReportTable key={`${report.generatedAt}`} report={report} />
        </Card>
        {report.chart ? (
          <Card interactive={false}>
            <h3 className="ims-rp-section-title">{report.chart.title}</h3>
            <ReportChartView chart={report.chart} />
            {report.notes.length ? (
              <ul className="ims-rp-steps" style={{ marginTop: 16 }}>
                {report.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}
      </div>
      {!report.chart && report.notes.length ? (
        <Alert tone="blue" title="About this report">
          {report.notes.join(" ")}
        </Alert>
      ) : null}

      {paper ? (
        <Card interactive={false}>
          <div className="ims-between" style={{ marginBottom: 12 }}>
            <h3 className="ims-rp-section-title" style={{ margin: 0 }}>
              Print view
            </h3>
            <div className="ims-row">
              <Button size="sm" icon="printer" onClick={onPrint}>
                Print again
              </Button>
              <Button size="sm" variant="ghost" icon="x" onClick={onClosePaper}>
                Close
              </Button>
            </div>
          </div>
          <ReportPaper report={report} business={business} filters={filters} preparedBy={preparedBy} />
        </Card>
      ) : null}
    </Stack>
  );
}

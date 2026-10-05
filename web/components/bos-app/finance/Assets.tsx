"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  DataTable,
  DetailsGrid,
  Field,
  FormGrid,
  Grid,
  Input,
  KpiCard,
  ModuleToolbar,
  SearchInput,
  Segmented,
  Select,
  Textarea,
  WidgetCard,
  type BosColumn,
} from "@/components/bos";
import { bos, type AssetCategoryPreset, type AssetEvent, type AssetInput, type AssetsOverview, type BosAsset, type DepreciationMethod, type DepreciationReport } from "@/lib/bos-app/api";
import { addDaysISO, assetBadge, dateLabel, depreciationLabel, inr, inrCompact, todayLocal } from "@/lib/bos-app/format";
import { downloadCsv } from "@/lib/export/csv";
import { Loaded, ManagersOnly, Stack, StatusBadge, useBosAction, useBosApp, useBosData } from "../core";
import { ConfirmDialog, FormDialog, useFormState } from "../dialogs";

type Filter = "held" | "maintenance" | "disposed" | "all";
type View = "register" | "depreciation";

const METHODS: ReadonlyArray<{ value: DepreciationMethod; label: string }> = [
  { value: "wdv", label: "Written-down value (WDV)" },
  { value: "slm", label: "Straight line (SLM)" },
  { value: "none", label: "No depreciation" },
];

const two = (n: number) => String(n % 100).padStart(2, "0");
const fyName = (year: number, startMonth: number) => (startMonth === 1 ? `FY ${year}` : `FY ${two(year)}-${two(year + 1)}`);
const fyYearOf = (date: string, startMonth: number) => Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < startMonth ? 1 : 0);
const presetRate = (presets: ReadonlyArray<AssetCategoryPreset>, category: string, method: DepreciationMethod) => {
  if (method === "none") return 0;
  const p = presets.find((c) => c.name === category);
  return p ? p[method] : 0;
};
const holderOf = (a: BosAsset) => a.employeeName ?? ([a.departmentName, a.location].filter(Boolean).join(" · ") || "—");

const eventText = (e: AssetEvent) => {
  switch (e.kind) {
    case "assign":
      return `Assigned to ${e.employeeName ?? "an employee"}`;
    case "return":
      return `Returned by ${e.employeeName ?? "the employee"}`;
    case "transfer":
      return `Moved to ${[e.departmentName, e.location].filter(Boolean).join(" · ") || "no department or location"}`;
    case "maintenance_start":
      return "Sent for maintenance";
    case "maintenance_end":
      return `Back in use${e.amount ? ` · maintenance cost ${inr(e.amount)}` : ""}`;
    case "dispose":
      return e.amount ? `Disposed of for ${inr(e.amount)}` : "Written off";
    case "reinstate":
      return "Disposal undone";
    default:
      return e.kind;
  }
};

/** Finance → Assets: fixed asset register, allocation, maintenance, transfers, disposal and depreciation. Managers only. */
export function Assets() {
  const { canManage, takeIntent } = useBosApp();
  const [intent] = useState(() => takeIntent("assets"));
  const [assetId, setAssetId] = useState<string | null>(intent?.startsWith("open:") ? intent.slice(5) : null);
  if (!canManage) return <ManagersOnly>The asset register and depreciation are limited to owners and admins.</ManagersOnly>;
  return assetId ? <AssetView id={assetId} onBack={() => setAssetId(null)} /> : <AssetsHome onOpen={setAssetId} />;
}

/* ---------- Register ---------- */

function AssetsHome({ onOpen }: { onOpen: (id: string) => void }) {
  const [view, setView] = useState<View>("register");
  const [filter, setFilter] = useState<Filter>("held");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const state = useBosData(() => bos.assets(), []);
  return (
    <Loaded state={state}>
      {(overview) => {
        const { assets, totals: t } = overview;
        const q = query.trim().toLowerCase();
        const matches = (a: BosAsset) => !q || [a.tag, a.name, a.category, a.serialNo, a.employeeName, a.departmentName, a.location, a.vendorName].some((s) => s?.toLowerCase().includes(q));
        const inFilter = (a: BosAsset) => (filter === "held" ? a.status !== "disposed" : filter === "all" ? true : a.status === filter);
        const shown = assets.filter((a) => inFilter(a) && matches(a));
        const disposed = assets.filter((a) => a.status === "disposed").length;

        const columns: BosColumn<BosAsset>[] = [
          {
            key: "asset",
            header: "Asset",
            cell: (a) => (
              <span style={{ display: "block", maxWidth: 300 }}>
                <span style={{ fontWeight: 600 }}>{a.name}</span>
                <span className="bos-text-faint" style={{ display: "block", fontSize: 11.5 }}>
                  {a.tag} · {a.category}
                </span>
              </span>
            ),
          },
          { key: "date", header: "Purchase Date", mono: true, cell: (a) => dateLabel(a.purchaseDate) },
          { key: "cost", header: "Cost", align: "right", mono: true, cell: (a) => inr(a.cost) },
          { key: "method", header: "Method", cell: (a) => depreciationLabel(a.method, a.rate) },
          { key: "book", header: "Book Value", align: "right", mono: true, cell: (a) => (a.status === "disposed" ? <span className="bos-text-faint">—</span> : inr(a.bookValue)) },
          { key: "holder", header: "With", cell: holderOf },
          { key: "status", header: "Status", cell: (a) => <StatusBadge view={assetBadge(a.status)} /> },
        ];

        return (
          <Stack>
            <Grid cols={4} min={140}>
              <KpiCard label="Total assets" value={t.count.toLocaleString("en-IN")} chip={{ color: "blue", glyph: "▣" }} delta={`${inrCompact(t.bookValue)} book value`} deltaTone="muted" />
              <KpiCard label="Under maintenance" value={t.maintenance.toLocaleString("en-IN")} chip={{ color: "amber", glyph: "🔧" }} delta={t.maintenance ? "Out of service" : "Everything in service"} deltaTone={t.maintenance ? "warn" : "muted"} />
              <KpiCard label="Transfers (MTD)" value={t.transfersMtd.toLocaleString("en-IN")} chip={{ color: "lavender", glyph: "↔" }} delta="Department or location moves" deltaTone="muted" />
              <KpiCard label={`Disposed (${overview.fyLabel})`} value={t.disposedFy.toLocaleString("en-IN")} chip={{ color: "rose", glyph: "🗑" }} delta={`Depreciation ${inrCompact(t.depreciationFy)} this year`} deltaTone="muted" />
            </Grid>

            {!assets.length ? (
              <Alert
                tone="blue"
                title="Add your first asset"
                actions={
                  <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>
                    Add asset
                  </Button>
                }
              >
                Record laptops, vehicles, furniture, tools and equipment with their cost and purchase date. BOS works out depreciation each financial year (WDV or SLM), tracks who has each asset and where it is, and keeps the history of
                maintenance, transfers and disposal.
              </Alert>
            ) : t.warrantySoon ? (
              <Alert tone="amber" title={`${t.warrantySoon} ${t.warrantySoon === 1 ? "warranty ends" : "warranties end"} in the next 30 days`}>
                {assets
                  .filter((a) => a.status !== "disposed" && a.warrantyUntil && a.warrantyUntil >= overview.today && a.warrantyUntil <= addDaysISO(overview.today, 30))
                  .map((a) => `${a.name} (${dateLabel(a.warrantyUntil)})`)
                  .join(", ")}
              </Alert>
            ) : null}

            {assets.length ? (
              <div>
                <ModuleToolbar>
                  <Segmented<View>
                    size="sm"
                    aria-label="Assets view"
                    options={[
                      { value: "register", label: "Register" },
                      { value: "depreciation", label: "Depreciation schedule" },
                    ]}
                    value={view}
                    onChange={setView}
                  />
                  <span className="bos-spacer" />
                  {view === "register" ? (
                    <>
                      <Button size="sm" icon="download" onClick={() => exportRegister(overview)}>
                        Download CSV
                      </Button>
                      <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>
                        Add asset
                      </Button>
                    </>
                  ) : null}
                </ModuleToolbar>
                {view === "register" ? (
                  <div style={{ marginTop: 12 }}>
                    <ModuleToolbar>
                      <Segmented<Filter>
                        role="radio"
                        size="sm"
                        aria-label="Show assets"
                        options={[
                          { value: "held", label: `In the register (${t.count})` },
                          { value: "maintenance", label: `Maintenance (${t.maintenance})` },
                          { value: "disposed", label: `Disposed (${disposed})` },
                          { value: "all", label: "All" },
                        ]}
                        value={filter}
                        onChange={setFilter}
                      />
                      <span className="bos-spacer" />
                      <SearchInput placeholder="Search name, tag, serial, person…" aria-label="Search assets" value={query} onChange={(e) => setQuery(e.target.value)} />
                    </ModuleToolbar>
                    <div style={{ marginTop: 12 }}>
                      <DataTable caption="Asset register & depreciation" columns={columns} rows={shown} rowKey={(a) => a.id} onRowClick={(a) => onOpen(a.id)} empty="No assets match." />
                    </div>
                  </div>
                ) : (
                  <DepreciationView overview={overview} />
                )}
              </div>
            ) : null}

            {adding ? <AssetDialog presets={overview.categories} asset={null} today={overview.today} onClose={() => setAdding(false)} onSaved={(a) => onOpen(a.id)} /> : null}
          </Stack>
        );
      }}
    </Loaded>
  );
}

function exportRegister({ assets }: AssetsOverview) {
  const headers = ["Tag", "Asset", "Category", "Serial no.", "Purchase date", "Cost", "Salvage value", "Method", "Rate %", "Accumulated depreciation", "Book value", "Status", "With", "Department", "Location", "Vendor", "Warranty until"];
  downloadCsv(
    "asset-register.csv",
    headers,
    assets.map((a) => ({
      Tag: a.tag,
      Asset: a.name,
      Category: a.category,
      "Serial no.": a.serialNo ?? "",
      "Purchase date": a.purchaseDate,
      Cost: a.cost,
      "Salvage value": a.salvageValue,
      Method: a.method.toUpperCase(),
      "Rate %": a.rate,
      "Accumulated depreciation": a.accumulated,
      "Book value": a.status === "disposed" ? 0 : a.bookValue,
      Status: assetBadge(a.status).text,
      With: a.employeeName ?? "",
      Department: a.departmentName ?? "",
      Location: a.location ?? "",
      Vendor: a.vendorName ?? "",
      "Warranty until": a.warrantyUntil ?? "",
    })),
  );
}

/* ---------- Depreciation schedule ---------- */

function DepreciationView({ overview }: { overview: AssetsOverview }) {
  const { currentYear, fiscalYearStart: startMonth, assets } = overview;
  const [year, setYear] = useState(currentYear);
  const state = useBosData(() => bos.assetDepreciation(year), [year]);
  const earliest = assets.reduce((y, a) => Math.min(y, fyYearOf(a.purchaseDate, startMonth)), currentYear);
  const years = Array.from({ length: currentYear - Math.max(earliest, currentYear - 10) + 1 }, (_, i) => currentYear - i);
  return (
    <div style={{ marginTop: 12 }}>
      <ModuleToolbar>
        <Select aria-label="Financial year" size="sm" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} style={{ width: "auto" }}>
          {years.map((y) => (
            <option key={y} value={y}>
              {fyName(y, startMonth)}
              {y === currentYear ? " · current" : ""}
            </option>
          ))}
        </Select>
        <span className="bos-spacer" />
        <Button size="sm" icon="download" disabled={!state.data?.lines.length} onClick={() => state.data && exportSchedule(state.data)}>
          Download CSV
        </Button>
      </ModuleToolbar>
      <div style={{ marginTop: 12 }}>
        <Loaded state={state} rows={2}>
          {(report) => <ScheduleTables report={report} />}
        </Loaded>
      </div>
    </div>
  );
}

type Sums = DepreciationReport["totals"];
const sumColumns = <T extends Sums>(): BosColumn<T>[] => [
  { key: "opening", header: "Opening", align: "right", mono: true, cell: (r) => inr(r.opening) },
  { key: "additions", header: "Additions", align: "right", mono: true, cell: (r) => (r.additions ? inr(r.additions) : "—") },
  { key: "depreciation", header: "Depreciation", align: "right", mono: true, cell: (r) => inr(r.depreciation) },
  { key: "disposals", header: "Disposals", align: "right", mono: true, cell: (r) => (r.disposals ? inr(r.disposals) : "—") },
  { key: "closing", header: "Closing", align: "right", mono: true, cell: (r) => inr(r.closing) },
];

function ScheduleTables({ report }: { report: DepreciationReport }) {
  type CategoryRow = DepreciationReport["byCategory"][number];
  type Line = DepreciationReport["lines"][number];
  const categoryRows: CategoryRow[] = [...report.byCategory, { category: "Total", count: report.lines.length, ...report.totals }];
  const categoryColumns: BosColumn<CategoryRow>[] = [
    { key: "category", header: "Category", cell: (r) => <span style={{ fontWeight: r.category === "Total" ? 700 : 600 }}>{r.category}</span> },
    { key: "count", header: "Assets", align: "right", mono: true, cell: (r) => r.count },
    ...sumColumns<CategoryRow>(),
  ];
  const lineColumns: BosColumn<Line>[] = [
    {
      key: "asset",
      header: "Asset",
      cell: (l) => (
        <span style={{ display: "block", maxWidth: 280 }}>
          <span style={{ fontWeight: 600 }}>{l.name}</span>
          <span className="bos-text-faint" style={{ display: "block", fontSize: 11.5 }}>
            {l.tag} · {dateLabel(l.purchaseDate)}
            {l.disposedOn ? ` · disposed ${dateLabel(l.disposedOn)}` : ""}
          </span>
        </span>
      ),
    },
    { key: "method", header: "Method", cell: (l) => depreciationLabel(l.method, l.rate) },
    ...sumColumns<Line>(),
  ];
  if (!report.lines.length) return <Alert tone="blue" title={`No assets in ${report.fyLabel}`}>Nothing was held during this financial year.</Alert>;
  return (
    <Stack gap={16}>
      <p className="bos-text-faint" style={{ fontSize: 12, margin: 0 }}>
        {report.fyLabel} · {dateLabel(report.fyStart)} to {dateLabel(report.fyEnd)}
        {report.complete ? "" : " · the year is still running, so depreciation is shown for the full year"}. Depreciation is pro-rata by days held. It isn&apos;t added to Reports → profit &amp; loss, but the Accounting ledger posts it.
      </p>
      <DataTable caption={`Depreciation by category, ${report.fyLabel}`} columns={categoryColumns} rows={categoryRows} rowKey={(r) => r.category} compact />
      <DataTable caption={`Depreciation by asset, ${report.fyLabel}`} columns={lineColumns} rows={report.lines} rowKey={(l) => l.id} compact />
    </Stack>
  );
}

function exportSchedule(report: DepreciationReport) {
  const headers = ["Tag", "Asset", "Category", "Purchase date", "Disposed on", "Cost", "Method", "Rate %", "Opening", "Additions", "Depreciation", "Disposals", "Closing"];
  downloadCsv(
    `depreciation_${report.fyLabel.replace(/\s+/g, "-")}.csv`,
    headers,
    report.lines.map((l) => ({
      Tag: l.tag,
      Asset: l.name,
      Category: l.category,
      "Purchase date": l.purchaseDate,
      "Disposed on": l.disposedOn ?? "",
      Cost: l.cost,
      Method: l.method.toUpperCase(),
      "Rate %": l.rate,
      Opening: l.opening,
      Additions: l.additions,
      Depreciation: l.depreciation,
      Disposals: l.disposals,
      Closing: l.closing,
    })),
  );
}

/* ---------- One asset ---------- */

type Dialog = "edit" | "assign" | "return" | "transfer" | "maintenance" | "dispose" | "reinstate" | "delete";

function AssetView({ id, onBack }: { id: string; onBack: () => void }) {
  const { run, busy } = useBosAction();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const state = useBosData(() => bos.asset(id), [id]);
  const close = () => setDialog(null);
  return (
    <Loaded state={state} rows={2}>
      {({ asset: a, schedule, events, bill, disposal, categories }) => {
        const today = todayLocal();
        const disposed = a.status === "disposed";
        const scheduleColumns: BosColumn<(typeof schedule)[number]>[] = [
          { key: "label", header: "Financial year", cell: (r) => r.label },
          { key: "days", header: "Days held", align: "right", mono: true, cell: (r) => r.days },
          { key: "opening", header: "Opening", align: "right", mono: true, cell: (r) => inr(r.opening) },
          { key: "depreciation", header: "Depreciation", align: "right", mono: true, cell: (r) => inr(r.depreciation) },
          { key: "closing", header: "Closing", align: "right", mono: true, cell: (r) => inr(r.closing) },
        ];
        const eventColumns: BosColumn<AssetEvent>[] = [
          { key: "date", header: "Date", mono: true, cell: (e) => dateLabel(e.date) },
          { key: "event", header: "Event", cell: (e) => <span style={{ fontWeight: 600 }}>{eventText(e)}</span> },
          { key: "note", header: "Note", cell: (e) => e.note ?? <span className="bos-text-faint">—</span> },
        ];
        return (
          <>
            <div className="bos-app-recordbar">
              <button type="button" className="bos-back-link" onClick={onBack}>
                ‹ Back to assets
              </button>
              <div className="bos-app-actions">
                <Button size="sm" variant="ghost" onClick={() => setDialog("delete")}>
                  Delete
                </Button>
                <Button size="sm" icon="edit" onClick={() => setDialog("edit")}>
                  Edit
                </Button>
                {disposed ? (
                  <Button size="sm" variant="primary" onClick={() => setDialog("reinstate")}>
                    Reinstate
                  </Button>
                ) : (
                  <>
                    <Button size="sm" onClick={() => setDialog("dispose")}>
                      Dispose
                    </Button>
                    <Button size="sm" onClick={() => setDialog("maintenance")}>
                      {a.status === "maintenance" ? "Back in use" : "Send for maintenance"}
                    </Button>
                    <Button size="sm" onClick={() => setDialog("transfer")}>
                      Transfer
                    </Button>
                    {a.employeeId ? (
                      <Button size="sm" onClick={() => setDialog("return")}>
                        Return
                      </Button>
                    ) : null}
                    <Button size="sm" variant="primary" onClick={() => setDialog("assign")}>
                      {a.employeeId ? "Reassign" : "Assign"}
                    </Button>
                  </>
                )}
              </div>
            </div>
            <Stack>
              <div className="bos-row" style={{ gap: 10, alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{a.name}</h2>
                <StatusBadge view={assetBadge(a.status)} />
                <span className="bos-text-faint bos-mono" style={{ fontSize: 12 }}>
                  {a.tag}
                </span>
              </div>
              <Grid cols={4} min={140}>
                <KpiCard label="Cost" value={inr(a.cost)} chip={{ color: "blue", glyph: "₹" }} delta={`Purchased ${dateLabel(a.purchaseDate)}`} deltaTone="muted" interactive={false} />
                {disposal ? (
                  <>
                    <KpiCard label="Book value at disposal" value={inr(disposal.bookValue)} chip={{ color: "sage", glyph: "▣" }} delta={`Disposed ${dateLabel(a.disposedOn)}`} deltaTone="muted" interactive={false} />
                    <KpiCard label="Sale proceeds" value={inr(a.disposalAmount ?? 0)} chip={{ color: "mint", glyph: "↓" }} delta={a.disposalAmount ? "Received on disposal" : "Written off"} deltaTone="muted" interactive={false} />
                    <KpiCard
                      label={disposal.gainLoss >= 0 ? "Gain on disposal" : "Loss on disposal"}
                      value={inr(Math.abs(disposal.gainLoss))}
                      valueTone={disposal.gainLoss >= 0 ? "emerald" : "coral"}
                      chip={{ color: "rose", glyph: "±" }}
                      delta="Proceeds less book value"
                      deltaTone="muted"
                      interactive={false}
                    />
                  </>
                ) : (
                  <>
                    <KpiCard label="Book value" value={inr(a.bookValue)} chip={{ color: "sage", glyph: "▣" }} delta={a.salvageValue ? `Salvage ${inr(a.salvageValue)}` : "As of today"} deltaTone="muted" interactive={false} />
                    <KpiCard label="Depreciation this year" value={inr(a.depreciationThisFy)} chip={{ color: "lavender", glyph: "↘" }} delta={depreciationLabel(a.method, a.rate)} deltaTone="muted" interactive={false} />
                    <KpiCard label="Accumulated depreciation" value={inr(a.accumulated)} chip={{ color: "amber", glyph: "Σ" }} delta={a.cost ? `${Math.round((a.accumulated / a.cost) * 100)}% of cost` : ""} deltaTone="muted" interactive={false} />
                  </>
                )}
              </Grid>
              <WidgetCard title="🏷️ Details" dot="blue">
                <DetailsGrid
                  items={[
                    { label: "Category", value: a.category },
                    { label: "Serial no.", value: a.serialNo || "—" },
                    { label: "Method", value: depreciationLabel(a.method, a.rate) },
                    { label: "Salvage value", value: inr(a.salvageValue) },
                    { label: "With", value: a.employeeName || "—" },
                    { label: "Department", value: a.departmentName || "—" },
                    { label: "Location", value: a.location || "—" },
                    { label: "Warranty until", value: a.warrantyUntil ? dateLabel(a.warrantyUntil) : "—" },
                    { label: "Vendor", value: a.vendorName || "—" },
                    { label: "Purchase bill", value: bill ? `${bill.billNo || "Bill"} · ${bill.partyName} · ${inr(bill.total)}` : "—" },
                    ...(a.disposalNote ? [{ label: "Disposal note", value: a.disposalNote }] : []),
                    ...(a.notes ? [{ label: "Notes", value: a.notes }] : []),
                  ]}
                />
              </WidgetCard>
              {a.method !== "none" ? (
                <DataTable
                  caption={`Depreciation schedule, ${a.tag}`}
                  columns={scheduleColumns}
                  rows={schedule}
                  rowKey={(r) => r.fyStart}
                  compact
                  empty="No depreciation yet."
                />
              ) : null}
              <DataTable caption={`History, ${a.tag}`} columns={eventColumns} rows={events} rowKey={(e) => e.id} compact empty="No assignments, transfers or maintenance yet." />
            </Stack>

            {dialog === "edit" ? <AssetDialog presets={categories} asset={a} today={today} onClose={close} /> : null}
            {dialog === "assign" ? <AssignDialog asset={a} today={today} onClose={close} /> : null}
            {dialog === "return" ? <ReturnDialog asset={a} today={today} onClose={close} /> : null}
            {dialog === "transfer" ? <TransferDialog asset={a} today={today} onClose={close} /> : null}
            {dialog === "maintenance" ? <MaintenanceDialog asset={a} today={today} onClose={close} /> : null}
            {dialog === "dispose" ? <DisposeDialog asset={a} today={today} onClose={close} /> : null}
            <ConfirmDialog
              open={dialog === "reinstate"}
              onClose={close}
              title={`Reinstate ${a.name}?`}
              description="The disposal is undone and the asset goes back into the register, depreciating as before."
              confirmLabel="Reinstate"
              busy={busy === "reinstate"}
              onConfirm={async () => {
                const out = await run("reinstate", () => bos.reinstateAsset(a.id), { success: "Asset reinstated", description: a.name });
                if (out) close();
              }}
            />
            <ConfirmDialog
              open={dialog === "delete"}
              onClose={close}
              destructive
              title={`Delete ${a.tag} · ${a.name}?`}
              description="The asset and its history are removed from the register. If it was sold or scrapped, dispose of it instead so the record stays."
              confirmLabel="Delete"
              busy={busy === "delete"}
              onConfirm={async () => {
                const done = await run(
                  "delete",
                  async () => {
                    await bos.deleteAsset(a.id);
                    return true;
                  },
                  { success: "Asset deleted", description: a.name, refresh: false },
                );
                if (!done) return;
                close();
                onBack();
              }}
            />
          </>
        );
      }}
    </Loaded>
  );
}

/* ---------- Dialogs ---------- */

function DateNote({ date, note, min, today, onDate, onNote }: { date: string; note: string; min: string; today: string; onDate: (v: string) => void; onNote: (v: string) => void }) {
  return (
    <>
      <Field label="Date">{({ id }) => <Input id={id} type="date" required min={min} max={today} value={date} onChange={(e) => onDate(e.target.value)} />}</Field>
      <Field label="Note">{({ id }) => <Input id={id} maxLength={300} value={note} placeholder="Optional" onChange={(e) => onNote(e.target.value)} />}</Field>
    </>
  );
}

function AssetDialog({ presets, asset, today, onClose, onSaved }: { presets: ReadonlyArray<AssetCategoryPreset>; asset: BosAsset | null; today: string; onClose: () => void; onSaved?: (a: BosAsset) => void }) {
  const { run, busy } = useBosAction();
  const creating = asset === null;
  const lists = useBosData(async () => {
    const [bills, employees, departments] = await Promise.all([bos.bills(), creating ? bos.employees() : null, creating ? bos.departments() : null]);
    return {
      bills: bills.bills.filter((b) => b.status === "approved" || b.status === "paid" || b.id === asset?.billId),
      employees: employees?.employees.filter((e) => e.status !== "exited") ?? [],
      departments: departments?.departments ?? [],
    };
  }, [creating]);
  const first = presets[0]?.name ?? "Other";
  const f = useFormState(() => ({
    name: asset?.name ?? "",
    category: asset?.category ?? first,
    tag: asset?.tag ?? "",
    serialNo: asset?.serialNo ?? "",
    purchaseDate: asset?.purchaseDate ?? today,
    cost: asset ? String(asset.cost) : "",
    salvageValue: asset ? String(asset.salvageValue || "") : "",
    method: asset?.method ?? ("wdv" as DepreciationMethod),
    rate: asset ? String(asset.rate) : String(presetRate(presets, first, "wdv")),
    vendorName: asset?.vendorName ?? "",
    billId: asset?.billId ?? "",
    warrantyUntil: asset?.warrantyUntil ?? "",
    notes: asset?.notes ?? "",
    employeeId: "",
    departmentId: "",
    location: "",
  }));
  const v = f.values;
  const preset = presets.find((c) => c.name === v.category);
  const categories = presets.some((c) => c.name === v.category) ? presets.map((c) => c.name) : [v.category, ...presets.map((c) => c.name)];
  const bills = lists.data?.bills ?? [];

  const setCategory = (category: string) => f.setValues((s) => ({ ...s, category, rate: String(presetRate(presets, category, s.method)) }));
  const setMethod = (method: DepreciationMethod) => f.setValues((s) => ({ ...s, method, rate: String(presetRate(presets, s.category, method)) }));
  const setBill = (billId: string) =>
    f.setValues((s) => {
      const b = bills.find((x) => x.id === billId);
      if (!b) return { ...s, billId };
      return { ...s, billId, vendorName: s.vendorName || b.partyName, cost: s.cost || String(b.amount), purchaseDate: creating && s.purchaseDate === today ? b.billDate : s.purchaseDate };
    });

  const submit = async () => {
    const base = {
      name: v.name.trim(),
      category: v.category,
      tag: v.tag.trim() || null,
      serialNo: v.serialNo.trim() || null,
      purchaseDate: v.purchaseDate,
      cost: Number(v.cost) || 0,
      salvageValue: Number(v.salvageValue) || 0,
      method: v.method,
      rate: v.method === "none" ? 0 : Number(v.rate) || 0,
      vendorName: v.vendorName.trim() || null,
      billId: v.billId || null,
      warrantyUntil: v.warrantyUntil || null,
      notes: v.notes.trim() || null,
    };
    if (asset) {
      const out = await run("asset", () => bos.updateAsset(asset.id, base), { success: "Asset updated", description: base.name });
      if (out) onClose();
      return;
    }
    const input: AssetInput = { ...base, employeeId: v.employeeId || null, departmentId: v.departmentId || null, location: v.location.trim() || null };
    const out = await run("asset", () => bos.createAsset(input), { success: "Asset added", description: base.name });
    if (!out) return;
    onClose();
    onSaved?.(out.asset);
  };

  return (
    <FormDialog
      open
      onClose={onClose}
      title={asset ? `Edit ${asset.tag}` : "Add an asset"}
      description="Depreciation is worked out from the purchase date, pro-rata by days in the first year."
      icon={{ tone: "blue", name: "box" }}
      submitLabel={asset ? "Save" : "Add asset"}
      busy={busy === "asset"}
      onSubmit={submit}
      wide
    >
      <FormGrid>
        <Field label="Asset name">{({ id }) => <Input id={id} required maxLength={160} value={v.name} placeholder="e.g. Dell Latitude 5440" onChange={(e) => f.set("name")(e.target.value)} />}</Field>
        <Field label="Category">
          {({ id }) => (
            <Select id={id} value={v.category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Asset tag" hint={asset ? undefined : "Leave blank to number it automatically"}>
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={40} value={v.tag} placeholder="AST-0001" onChange={(e) => f.set("tag")(e.target.value)} />}
        </Field>
        <Field label="Serial / registration no.">{({ id }) => <Input id={id} maxLength={80} value={v.serialNo} placeholder="Optional" onChange={(e) => f.set("serialNo")(e.target.value)} />}</Field>
        <Field label="Purchase date">{({ id }) => <Input id={id} type="date" required max={today} value={v.purchaseDate} onChange={(e) => f.set("purchaseDate")(e.target.value)} />}</Field>
        <Field label="Cost (₹)" hint="Excluding GST you claim as input credit">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" required min={0.01} step="0.01" inputMode="decimal" value={v.cost} onChange={(e) => f.set("cost")(e.target.value)} />}
        </Field>
        <Field label="Depreciation method">
          {({ id }) => (
            <Select id={id} value={v.method} onChange={(e) => setMethod(e.target.value as DepreciationMethod)}>
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {v.method !== "none" ? (
          <Field label="Rate (% a year)" hint={preset && (preset.wdv || preset.slm) ? `Usual: WDV ${preset.wdv}% (Income-tax) · SLM ${preset.slm}% (Companies Act)` : undefined}>
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" required min={0} max={100} step="0.01" inputMode="decimal" value={v.rate} onChange={(e) => f.set("rate")(e.target.value)} />}
          </Field>
        ) : null}
        <Field label="Salvage value (₹)" hint="Book value never goes below this">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} step="0.01" inputMode="decimal" value={v.salvageValue} placeholder="0" onChange={(e) => f.set("salvageValue")(e.target.value)} />}
        </Field>
        <Field label="Warranty until">{({ id }) => <Input id={id} type="date" value={v.warrantyUntil} onChange={(e) => f.set("warrantyUntil")(e.target.value)} />}</Field>
        <Field label="Vendor">{({ id }) => <Input id={id} maxLength={200} value={v.vendorName} placeholder="Optional" onChange={(e) => f.set("vendorName")(e.target.value)} />}</Field>
        <Field label="Purchase bill" hint={bills.length ? "Links the asset to the bill in Payables" : undefined}>
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} value={v.billId} onChange={(e) => setBill(e.target.value)}>
              <option value="">Not linked</option>
              {bills.map((b) => (
                <option key={b.id} value={b.id}>
                  {[b.billNo, b.partyName, inr(b.total), dateLabel(b.billDate)].filter(Boolean).join(" · ")}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {creating ? (
          <>
            <Field label="Assign to">
              {({ id }) => (
                <Select id={id} value={v.employeeId} onChange={(e) => f.set("employeeId")(e.target.value)}>
                  <option value="">Nobody yet</option>
                  {(lists.data?.employees ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} · {e.empCode}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Department">
              {({ id }) => (
                <Select id={id} value={v.departmentId} onChange={(e) => f.set("departmentId")(e.target.value)}>
                  <option value="">None</option>
                  {(lists.data?.departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Location">{({ id }) => <Input id={id} maxLength={120} value={v.location} placeholder="e.g. Head office" onChange={(e) => f.set("location")(e.target.value)} />}</Field>
          </>
        ) : null}
        <Field label="Notes" full>
          {({ id }) => <Textarea id={id} rows={2} maxLength={2000} value={v.notes} placeholder="Optional" onChange={(e) => f.set("notes")(e.target.value)} />}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

function AssignDialog({ asset: a, today, onClose }: { asset: BosAsset; today: string; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const people = useBosData(() => bos.employees(), []);
  const f = useFormState(() => ({ employeeId: "", date: today, note: "" }));
  const v = f.values;
  const options = (people.data?.employees ?? []).filter((e) => e.status !== "exited" && e.id !== a.employeeId);
  const submit = async () => {
    const name = options.find((e) => e.id === v.employeeId)?.name ?? "";
    const out = await run("assign", () => bos.assignAsset(a.id, { employeeId: v.employeeId, date: v.date, note: v.note.trim() || null }), { success: "Asset assigned", description: `${a.name} → ${name}` });
    if (out) onClose();
  };
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`${a.employeeId ? "Reassign" : "Assign"} ${a.name}`}
      description={a.employeeName ? `Currently with ${a.employeeName}.` : "Record who has this asset."}
      icon={{ tone: "blue", name: "box" }}
      submitLabel="Assign"
      busy={busy === "assign"}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label="Employee" full>
          {({ id }) => (
            <Select id={id} required value={v.employeeId} onChange={(e) => f.set("employeeId")(e.target.value)}>
              <option value="">{people.loading && !people.data ? "Loading…" : "Choose an employee"}</option>
              {options.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.empCode}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <DateNote date={v.date} note={v.note} min={a.purchaseDate} today={today} onDate={f.set("date")} onNote={f.set("note")} />
      </FormGrid>
    </FormDialog>
  );
}

function ReturnDialog({ asset: a, today, onClose }: { asset: BosAsset; today: string; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ date: today, note: "" }));
  const submit = async () => {
    const out = await run("return", () => bos.assignAsset(a.id, { employeeId: null, date: f.values.date, note: f.values.note.trim() || null }), { success: "Asset returned", description: a.name });
    if (out) onClose();
  };
  return (
    <FormDialog open onClose={onClose} title={`${a.employeeName ?? "Employee"} returns ${a.name}`} icon={{ tone: "blue", name: "box" }} submitLabel="Record return" busy={busy === "return"} onSubmit={submit}>
      <FormGrid>
        <DateNote date={f.values.date} note={f.values.note} min={a.purchaseDate} today={today} onDate={f.set("date")} onNote={f.set("note")} />
      </FormGrid>
    </FormDialog>
  );
}

function TransferDialog({ asset: a, today, onClose }: { asset: BosAsset; today: string; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const depts = useBosData(() => bos.departments(), []);
  const f = useFormState(() => ({ departmentId: a.departmentId ?? "", location: a.location ?? "", date: today, note: "" }));
  const v = f.values;
  const submit = async () => {
    const out = await run("transfer", () => bos.transferAsset(a.id, { departmentId: v.departmentId || null, location: v.location.trim() || null, date: v.date, note: v.note.trim() || null }), {
      success: "Asset transferred",
      description: a.name,
    });
    if (out) onClose();
  };
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Transfer ${a.name}`}
      description={`Now: ${[a.departmentName, a.location].filter(Boolean).join(" · ") || "no department or location"}.`}
      icon={{ tone: "blue", name: "layers" }}
      submitLabel="Transfer"
      busy={busy === "transfer"}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label="Department">
          {({ id }) => (
            <Select id={id} value={v.departmentId} onChange={(e) => f.set("departmentId")(e.target.value)}>
              <option value="">None</option>
              {(depts.data?.departments ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Location">{({ id }) => <Input id={id} maxLength={120} value={v.location} placeholder="e.g. Site office, Pune" onChange={(e) => f.set("location")(e.target.value)} />}</Field>
        <DateNote date={v.date} note={v.note} min={a.purchaseDate} today={today} onDate={f.set("date")} onNote={f.set("note")} />
      </FormGrid>
    </FormDialog>
  );
}

function MaintenanceDialog({ asset: a, today, onClose }: { asset: BosAsset; today: string; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const ending = a.status === "maintenance";
  const f = useFormState(() => ({ cost: "", date: today, note: "" }));
  const v = f.values;
  const submit = async () => {
    const cost = Number(v.cost) || 0;
    const out = await run(
      "maintenance",
      () => bos.assetMaintenance(a.id, { action: ending ? "end" : "start", cost: ending && cost ? cost : undefined, date: v.date, note: v.note.trim() || null }),
      { success: ending ? "Back in use" : "Sent for maintenance", description: a.name },
    );
    if (out) onClose();
  };
  return (
    <FormDialog
      open
      onClose={onClose}
      title={ending ? `${a.name} is back in use` : `Send ${a.name} for maintenance`}
      description={ending ? "Record what the repair or service cost, if anything. Pay the vendor's bill in Payables as usual." : "The asset shows as under maintenance until it's back."}
      icon={{ tone: "amber", name: "tasks" }}
      submitLabel={ending ? "Mark back in use" : "Send for maintenance"}
      busy={busy === "maintenance"}
      onSubmit={submit}
    >
      <FormGrid>
        {ending ? (
          <Field label="Maintenance cost (₹)" full>
            {({ id }) => <Input id={id} type="number" min={0} step="0.01" inputMode="decimal" value={v.cost} placeholder="0" onChange={(e) => f.set("cost")(e.target.value)} />}
          </Field>
        ) : null}
        <DateNote date={v.date} note={v.note} min={a.purchaseDate} today={today} onDate={f.set("date")} onNote={f.set("note")} />
      </FormGrid>
    </FormDialog>
  );
}

function DisposeDialog({ asset: a, today, onClose }: { asset: BosAsset; today: string; onClose: () => void }) {
  const { run, busy } = useBosAction();
  const f = useFormState(() => ({ amount: "", date: today, note: "" }));
  const v = f.values;
  const amount = Number(v.amount) || 0;
  const submit = async () => {
    const out = await run("dispose", () => bos.disposeAsset(a.id, { amount, date: v.date, note: v.note.trim() || null }), { success: "Asset disposed of", description: a.name });
    if (!out) return;
    onClose();
  };
  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Dispose of ${a.name}`}
      description="Sold, scrapped or written off. Depreciation stops on the disposal date and the asset leaves the register — you can reinstate it later."
      icon={{ tone: "coral", name: "warning" }}
      submitLabel="Dispose"
      busy={busy === "dispose"}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label="Sale proceeds (₹)" hint="0 if scrapped or written off">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} step="0.01" inputMode="decimal" value={v.amount} placeholder="0" onChange={(e) => f.set("amount")(e.target.value)} />}
        </Field>
        <DateNote date={v.date} note={v.note} min={a.purchaseDate} today={today} onDate={f.set("date")} onNote={f.set("note")} />
      </FormGrid>
      <p className="bos-text-faint" style={{ fontSize: 12, margin: "12px 0 0" }}>
        Book value today {inr(a.bookValue)}
        {v.date === today ? ` · ${amount - a.bookValue >= 0 ? "gain" : "loss"} of about ${inr(Math.abs(amount - a.bookValue))}` : " · the gain or loss is worked out on the disposal date"}
        {a.employeeName ? ` · ${a.employeeName} will no longer hold it` : ""}
      </p>
    </FormDialog>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Checkbox, DataTable, Dialog, EmptyState, Field, FilterChip, FormGrid, Grid, Input, KpiCard, SearchInput, Select, Textarea, type BosColumn } from "@/components/bos";
import { ims, type Period } from "@/lib/ims/api";
import { dateLabel, dateRange, downloadCsv, downloadXlsx, inr, qtyText, round2, stampLabel, todayLocal, type ExportColumn } from "@/lib/ims/format";
import { EXCISE_STATUS_LABEL, EXCISE_STATUS_TONE, imsSystem, type ExciseInput, type ExciseList, type ExciseRecord, type ExciseRegisterRow, type ExciseStatus } from "@/lib/ims/system";
import { Loaded, PageHeader, PeriodPicker, Stack, SubTabs, useIms, useImsAction, useImsData, useOpenIntent, usePrint } from "../core";
import { ConfirmDialog, KeyValues, useDebounced } from "./shared";

type Tab = "records" | "register";
const STATUSES: ReadonlyArray<ExciseStatus> = ["received", "in_transit", "verified", "issued"];

export function ExciseModule() {
  const { session, navigate } = useIms();
  if (!session.settings.exciseActive) {
    return (
      <Stack>
        <PageHeader title="Excise Records" />
        <Alert tone="blue" title="The excise register is off" actions={<Button size="sm" onClick={() => navigate("settings")}>Open Settings</Button>}>
          Turn on excise in Settings → Business profile (or choose a liquor / bar business type) to keep a permit-wise excise register here.
        </Alert>
      </Stack>
    );
  }
  return <ExciseWorkspace />;
}

function ExciseWorkspace() {
  const openId = useOpenIntent("excise");
  const [tab, setTab] = useState<Tab>("records");
  const [period, setPeriod] = useState<Period>(openId ? "fytd" : "mtd");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<ExciseStatus | "">("");
  const [itemId, setItemId] = useState("");
  const dq = useDebounced(q.trim());
  const state = useImsData(() => imsSystem.excise({ period, q: dq || undefined, status: status || undefined, itemId: itemId || undefined }), [period, dq, status, itemId]);
  const [editing, setEditing] = useState<ExciseRecord | "new" | null>(null);
  const [opened, setOpened] = useState(false);
  const [printing, setPrinting] = useState(false);

  if (openId && !opened && state.data) {
    const rec = state.data.records.find((r) => r.id === openId);
    setOpened(true);
    if (rec) setEditing(rec);
  }

  return (
    <Stack>
      <PageHeader
        title="Excise Records"
        sub="Permit-wise excise register: receipts, issues, closing balance and duty paid."
        actions={
          state.data?.canEdit ? (
            <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
              New entry
            </Button>
          ) : null
        }
      />
      <Loaded state={state}>
        {(d) => (
          <>
            <Grid cols={4} min={150}>
              <KpiCard interactive={false} label="Duty this month" value={inr(d.totals.dutyMtd)} chip={{ color: "amber", glyph: "₹" }} />
              <KpiCard interactive={false} label="Duty this FY" value={inr(d.totals.dutyFy)} chip={{ color: "lavender", glyph: "Σ" }} />
              <KpiCard interactive={false} label="Bottles in / out" value={`${qtyText(d.totals.bottlesIn)} / ${qtyText(d.totals.bottlesOut)}`} delta={`${qtyText(d.totals.casesIn)} cases · ${qtyText(d.totals.bulkLitresIn)} BL`} deltaTone="muted" chip={{ color: "mint", glyph: "🍾" }} />
              <KpiCard interactive={false} label="Permits" value={d.totals.permits} delta={d.totals.inTransit ? `${d.totals.inTransit} in transit` : "None in transit"} deltaTone={d.totals.inTransit ? "warn" : "muted"} chip={{ color: "blue", glyph: "📄" }} />
            </Grid>
            <Card interactive={false}>
              <Stack gap={12}>
                <div className="ims-between" style={{ flexWrap: "wrap", gap: 10 }}>
                  <PeriodPicker value={period} onChange={setPeriod} />
                  <span className="ims-row">
                    <Button size="sm" icon="download" disabled={!d.records.length} onClick={() => downloadCsv(`excise-register-${d.range.from}-to-${d.range.to}`, d.records, EXPORT_COLS)}>
                      CSV
                    </Button>
                    <Button size="sm" icon="file" disabled={!d.records.length} onClick={() => void downloadXlsx(`excise-register-${d.range.from}-to-${d.range.to}`, "Excise", d.records, EXPORT_COLS)}>
                      Excel
                    </Button>
                    <Button size="sm" icon="printer" disabled={!d.register.length} onClick={() => setPrinting(true)}>
                      Print register
                    </Button>
                  </span>
                </div>
                <div className="ims-toolbar" style={{ marginBottom: 0 }}>
                  <SearchInput wrapperClassName="ims-grow" placeholder="Search permit, TP, batch, brand, vendor…" aria-label="Search excise records" value={q} onChange={(e) => setQ(e.target.value)} />
                  <Select size="sm" aria-label="Item" value={itemId} style={{ maxWidth: 240 }} onChange={(e) => setItemId(e.target.value)}>
                    <option value="">All items</option>
                    {d.items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                        {i.volumeMl ? ` · ${i.volumeMl} ml` : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="ims-row" style={{ flexWrap: "wrap", gap: 6 }} role="group" aria-label="Status">
                  <FilterChip active={!status} onClick={() => setStatus("")}>
                    All statuses
                  </FilterChip>
                  {STATUSES.map((s) => (
                    <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>
                      {EXCISE_STATUS_LABEL[s]}
                    </FilterChip>
                  ))}
                </div>
              </Stack>
            </Card>
            <SubTabs
              label="Excise view"
              value={tab}
              onChange={setTab}
              options={[
                { value: "records", label: `Entries (${d.records.length})` },
                { value: "register", label: "Stock register" },
              ]}
            />
            {tab === "records" ? <RecordsTable data={d} onOpen={setEditing} /> : <RegisterTable rows={d.register} range={d.range} />}
            <ExciseDialog key={editing === "new" ? "new" : (editing?.id ?? "none")} open={editing !== null} record={editing === "new" ? null : editing} data={d} onClose={() => setEditing(null)} />
            <PrintDialog open={printing} onClose={() => setPrinting(false)} data={d} />
          </>
        )}
      </Loaded>
    </Stack>
  );
}

const EXPORT_COLS: ReadonlyArray<ExportColumn<ExciseRecord>> = [
  { header: "Date", value: (r) => r.date },
  { header: "Item", value: (r) => r.itemName },
  { header: "Brand", value: (r) => r.brand },
  { header: "Volume (ml)", value: (r) => r.volumeMl },
  { header: "Category", value: (r) => r.exciseCategory },
  { header: "Permit no", value: (r) => r.permitNo },
  { header: "Permit date", value: (r) => r.permitDate },
  { header: "Transport permit", value: (r) => r.transportPermitNo },
  { header: "Batch", value: (r) => r.batchNo },
  { header: "Vendor", value: (r) => r.vendorName },
  { header: "Cases", value: (r) => r.cases },
  { header: "Bottles / case", value: (r) => r.bottlesPerCase },
  { header: "Opening", value: (r) => r.openingQty },
  { header: "Received", value: (r) => r.receivedQty },
  { header: "Issued", value: (r) => r.issuedQty },
  { header: "Closing", value: (r) => r.closingQty },
  { header: "Bulk litres", value: (r) => r.bulkLitres },
  { header: "Duty rate", value: (r) => r.dutyRate },
  { header: "Duty paid", value: (r) => r.dutyAmount },
  { header: "Status", value: (r) => EXCISE_STATUS_LABEL[r.status] },
  { header: "Stock posted", value: (r) => (r.stockPosted ? "Yes" : "No") },
  { header: "Notes", value: (r) => r.notes },
  { header: "Recorded by", value: (r) => r.createdByName },
];

function RecordsTable({ data, onOpen }: { data: ExciseList; onOpen: (r: ExciseRecord) => void }) {
  const columns: BosColumn<ExciseRecord>[] = [
    { key: "date", header: "Date", cell: (r) => <span className="ims-cell-stack"><span>{dateLabel(r.date)}</span><small>{r.batchNo ? `Batch ${r.batchNo}` : ""}</small></span> },
    {
      key: "item",
      header: "Item",
      cell: (r) => (
        <span className="ims-cell-stack">
          <span className="ims-strong">{r.itemName}</span>
          <small>{[r.brand, r.volumeMl ? `${r.volumeMl} ml` : null, r.exciseCategory].filter(Boolean).join(" · ") || "—"}</small>
        </span>
      ),
    },
    {
      key: "permit",
      header: "Permit / TP",
      cell: (r) => (
        <span className="ims-cell-stack">
          <span className="ims-num">{r.permitNo ?? "—"}</span>
          <small>{[r.transportPermitNo ? `TP ${r.transportPermitNo}` : null, r.vendorName].filter(Boolean).join(" · ")}</small>
        </span>
      ),
    },
    { key: "open", header: "Opening", align: "right", cell: (r) => <span className="ims-num ims-muted">{qtyText(r.openingQty)}</span> },
    { key: "in", header: "Received", align: "right", cell: (r) => <span className="ims-num ims-pos">{r.receivedQty ? `+${qtyText(r.receivedQty)}` : "—"}</span> },
    { key: "out", header: "Issued", align: "right", cell: (r) => <span className="ims-num ims-neg">{r.issuedQty ? `−${qtyText(r.issuedQty)}` : "—"}</span> },
    { key: "close", header: "Closing", align: "right", cell: (r) => <span className={r.closingQty < 0 ? "ims-num ims-neg ims-strong" : "ims-num ims-strong"}>{qtyText(r.closingQty)}</span> },
    { key: "duty", header: "Duty", align: "right", cell: (r) => <span className="ims-num">{inr(r.dutyAmount)}</span> },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <span className="ims-cell-stack" style={{ gap: 2 }}>
          <Badge tone={EXCISE_STATUS_TONE[r.status]}>{EXCISE_STATUS_LABEL[r.status]}</Badge>
          {r.stockPosted ? <small>Stock posted</small> : null}
        </span>
      ),
    },
  ];
  return (
    <Card interactive={false}>
      <div className="ims-between" style={{ marginBottom: 10 }}>
        <span className="ims-muted" style={{ fontSize: 13 }}>
          {dateRange(data.range.from, data.range.to)} · {data.records.length} entr{data.records.length === 1 ? "y" : "ies"} · duty {inr(data.totals.dutyPeriod)}
        </span>
      </div>
      <DataTable
        columns={columns}
        rows={data.records}
        rowKey={(r) => r.id}
        onRowClick={onOpen}
        caption="Excise entries"
        empty={
          <EmptyState glyph="🍷" title="No excise entries">
            {data.canEdit ? "Record each permit as stock arrives — IMS carries the closing balance forward and totals the duty." : "Nothing recorded in this period."}
          </EmptyState>
        }
      />
    </Card>
  );
}

function RegisterTable({ rows, range }: { rows: ExciseRegisterRow[]; range: { from: string; to: string } }) {
  const columns: BosColumn<ExciseRegisterRow>[] = [
    { key: "item", header: "Item", cell: (r) => <span className="ims-cell-stack"><span className="ims-strong">{r.itemName}</span><small>{[r.brand, r.volumeMl ? `${r.volumeMl} ml` : null].filter(Boolean).join(" · ") || "—"}</small></span> },
    { key: "open", header: "Opening", align: "right", cell: (r) => <span className="ims-num">{qtyText(r.opening)}</span> },
    { key: "in", header: "Received", align: "right", cell: (r) => <span className="ims-num ims-pos">{qtyText(r.received)}</span> },
    { key: "out", header: "Issued", align: "right", cell: (r) => <span className="ims-num ims-neg">{qtyText(r.issued)}</span> },
    { key: "close", header: "Closing", align: "right", cell: (r) => <span className="ims-num ims-strong">{qtyText(r.closing)}</span> },
    { key: "bl", header: "Bulk litres in", align: "right", cell: (r) => <span className="ims-num ims-muted">{r.volumeMl ? qtyText(round2((r.received * r.volumeMl) / 1000)) : "—"}</span> },
    { key: "duty", header: "Duty", align: "right", cell: (r) => <span className="ims-num">{inr(r.duty)}</span> },
    { key: "span", header: "Entries", cell: (r) => <span className="ims-muted">{r.first === r.last ? dateLabel(r.first) : `${dateLabel(r.first)} – ${dateLabel(r.last)}`}</span> },
  ];
  return (
    <Card interactive={false}>
      <div className="ims-muted" style={{ fontSize: 13, marginBottom: 10 }}>
        Item-wise movement for {dateRange(range.from, range.to)}. Opening is the first entry&apos;s opening; closing is the latest entry&apos;s closing.
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} caption="Excise stock register" empty={<EmptyState glyph="📒" title="Nothing to summarise">Entries in this period roll up here by item.</EmptyState>} />
    </Card>
  );
}

type Form = {
  date: string;
  itemId: string;
  itemName: string;
  brand: string;
  volumeMl: string;
  exciseCategory: string;
  batchNo: string;
  permitNo: string;
  transportPermitNo: string;
  permitDate: string;
  vendorId: string;
  vendorName: string;
  cases: string;
  bottlesPerCase: string;
  receivedQty: string;
  issuedQty: string;
  openingQty: string;
  dutyRate: string;
  dutyAmount: string;
  status: ExciseStatus;
  notes: string;
  postStock: boolean;
};

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const n = (v: string) => (v.trim() === "" ? null : Number(v));

function toForm(r: ExciseRecord | null): Form {
  return {
    date: r?.date ?? todayLocal(),
    itemId: r?.itemId ?? "",
    itemName: r?.itemId ? "" : (r?.itemName ?? ""),
    brand: s(r?.brand),
    volumeMl: s(r?.volumeMl),
    exciseCategory: s(r?.exciseCategory),
    batchNo: s(r?.batchNo),
    permitNo: s(r?.permitNo),
    transportPermitNo: s(r?.transportPermitNo),
    permitDate: s(r?.permitDate),
    vendorId: s(r?.vendorId),
    vendorName: r?.vendorId ? "" : s(r?.vendorName),
    cases: r ? s(r.cases || "") : "",
    bottlesPerCase: s(r?.bottlesPerCase),
    receivedQty: r ? s(r.receivedQty || "") : "",
    issuedQty: r ? s(r.issuedQty || "") : "",
    openingQty: r ? s(r.openingQty) : "",
    dutyRate: r ? s(r.dutyRate || "") : "",
    dutyAmount: r ? s(r.dutyAmount) : "",
    status: r?.status ?? "received",
    notes: s(r?.notes),
    postStock: false,
  };
}

function ExciseDialog({ open, record, data, onClose }: { open: boolean; record: ExciseRecord | null; data: ExciseList; onClose: () => void }) {
  const { run, isBusy } = useImsAction();
  const [f, setF] = useState<Form>(() => toForm(record));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const suppliers = useImsData(() => ims.partyOptions("supplier").then((r) => r.parties), []);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const item = data.items.find((i) => i.id === f.itemId) ?? null;
  const fromCases = n(f.cases) && n(f.bottlesPerCase) ? (n(f.cases) ?? 0) * (n(f.bottlesPerCase) ?? 0) : null;
  const received = n(f.receivedQty) ?? fromCases ?? 0;
  const autoDuty = round2((n(f.dutyRate) ?? 0) * received);
  const opening = n(f.openingQty);
  const closing = opening === null ? null : round2(opening + received - (n(f.issuedQty) ?? 0));
  const readOnly = !data.canEdit;
  const locked = Boolean(record?.stockPosted);
  const valid = f.permitNo.trim() && (f.itemId || f.itemName.trim()) && f.date;

  const pickItem = (id: string) => {
    const it = data.items.find((i) => i.id === id);
    setF((x) => ({ ...x, itemId: id, itemName: "", brand: x.brand || s(it?.brand), volumeMl: x.volumeMl || s(it?.volumeMl), exciseCategory: x.exciseCategory || s(it?.exciseCategory) }));
  };

  const payload = (): ExciseInput => ({
    date: f.date,
    itemId: f.itemId || null,
    itemName: f.itemId ? null : f.itemName.trim() || null,
    brand: f.brand.trim() || null,
    volumeMl: n(f.volumeMl),
    exciseCategory: f.exciseCategory.trim() || null,
    batchNo: f.batchNo.trim() || null,
    permitNo: f.permitNo.trim(),
    transportPermitNo: f.transportPermitNo.trim() || null,
    permitDate: f.permitDate || null,
    vendorId: f.vendorId || null,
    vendorName: f.vendorId ? (suppliers.data?.find((p) => p.id === f.vendorId)?.name ?? null) : f.vendorName.trim() || null,
    cases: n(f.cases) ?? 0,
    bottlesPerCase: n(f.bottlesPerCase),
    receivedQty: n(f.receivedQty) ?? 0,
    issuedQty: n(f.issuedQty) ?? 0,
    openingQty: opening,
    dutyRate: n(f.dutyRate) ?? 0,
    dutyAmount: n(f.dutyAmount),
    status: f.status,
    notes: f.notes.trim() || null,
    ...(record ? {} : { postStock: f.postStock && Boolean(f.itemId) && received > 0 }),
  });

  const save = async () => {
    const r = await run("save", () => (record ? imsSystem.updateExcise(record.id, payload()) : imsSystem.createExcise(payload())), { success: record ? "Excise entry updated" : "Excise entry recorded" });
    if (r) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={record ? `Excise entry · ${record.permitNo ?? record.itemName}` : "New excise entry"}
      description={record ? `Recorded by ${record.createdByName ?? "—"} · ${stampLabel(record.createdAt)}` : "One permit / transport pass per entry. Leave opening blank to carry forward the item's last closing balance."}
      actionsNote={record && !readOnly ? <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button> : null}
      actions={
        <>
          <Button onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
          {!readOnly ? (
            <Button variant="primary" disabled={!valid || isBusy("save")} onClick={() => void save()}>
              {isBusy("save") ? "Saving…" : record ? "Save changes" : "Record entry"}
            </Button>
          ) : null}
        </>
      }
    >
      <Stack gap={14}>
        {locked ? <Alert tone="blue" title="Stock already posted">The item and received quantity are locked because this entry added stock. Delete the entry and reverse the stock movement to change them.</Alert> : null}
        <FormGrid columns="1fr 1fr 1fr">
          <Field label="Date">{({ id }) => <Input id={id} type="date" value={f.date} max={todayLocal()} disabled={readOnly} onChange={(e) => set("date", e.target.value)} />}</Field>
          <Field label="Permit / TP number *">{({ id }) => <Input id={id} value={f.permitNo} maxLength={64} disabled={readOnly} onChange={(e) => set("permitNo", e.target.value)} />}</Field>
          <Field label="Permit date">{({ id }) => <Input id={id} type="date" value={f.permitDate} disabled={readOnly} onChange={(e) => set("permitDate", e.target.value)} />}</Field>
          <Field label="Transport permit">{({ id }) => <Input id={id} value={f.transportPermitNo} maxLength={64} disabled={readOnly} onChange={(e) => set("transportPermitNo", e.target.value)} />}</Field>
          <Field label="Batch no">{({ id }) => <Input id={id} value={f.batchNo} maxLength={64} disabled={readOnly} onChange={(e) => set("batchNo", e.target.value)} />}</Field>
          <Field label="Status">
            {({ id }) => (
              <Select id={id} value={f.status} disabled={readOnly} onChange={(e) => set("status", e.target.value as ExciseStatus)}>
                {STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {EXCISE_STATUS_LABEL[st]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FormGrid>
        <FormGrid columns="2fr 1fr 1fr">
          <Field label="Item" hint={item ? `In stock: ${qtyText(item.currentStock, item.unit)}` : "Link an IMS item, or type the product below."}>
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} value={f.itemId} disabled={readOnly || locked} onChange={(e) => pickItem(e.target.value)}>
                <option value="">— Not linked —</option>
                {data.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                    {i.volumeMl ? ` · ${i.volumeMl} ml` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Brand">{({ id }) => <Input id={id} value={f.brand} maxLength={80} disabled={readOnly} onChange={(e) => set("brand", e.target.value)} />}</Field>
          <Field label="Volume (ml)">{({ id }) => <Input id={id} type="number" min={0} value={f.volumeMl} disabled={readOnly} onChange={(e) => set("volumeMl", e.target.value)} />}</Field>
          {!f.itemId ? (
            <Field label="Product name *" full>
              {({ id }) => <Input id={id} value={f.itemName} maxLength={200} disabled={readOnly} onChange={(e) => set("itemName", e.target.value)} placeholder="e.g. Royal Stag 750 ml" />}
            </Field>
          ) : null}
          <Field label="Category">{({ id }) => <Input id={id} value={f.exciseCategory} maxLength={40} disabled={readOnly} onChange={(e) => set("exciseCategory", e.target.value)} placeholder="IMFL, Beer, Wine…" />}</Field>
          <Field label="Vendor / distillery">
            {({ id }) => (
              <Select id={id} value={f.vendorId} disabled={readOnly} onChange={(e) => set("vendorId", e.target.value)}>
                <option value="">— Type a name —</option>
                {(suppliers.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {!f.vendorId ? <Field label="Vendor name">{({ id }) => <Input id={id} value={f.vendorName} maxLength={200} disabled={readOnly} onChange={(e) => set("vendorName", e.target.value)} />}</Field> : null}
        </FormGrid>
        <FormGrid columns="repeat(4, minmax(0, 1fr))">
          <Field label="Cases">{({ id }) => <Input id={id} type="number" min={0} step="any" value={f.cases} disabled={readOnly || locked} onChange={(e) => set("cases", e.target.value)} />}</Field>
          <Field label="Bottles / case">{({ id }) => <Input id={id} type="number" min={0} value={f.bottlesPerCase} disabled={readOnly || locked} onChange={(e) => set("bottlesPerCase", e.target.value)} />}</Field>
          <Field label="Bottles received" hint={fromCases && !f.receivedQty ? `= ${qtyText(fromCases)} from cases` : undefined}>
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} step="any" value={f.receivedQty} disabled={readOnly || locked} onChange={(e) => set("receivedQty", e.target.value)} />}
          </Field>
          <Field label="Bottles issued">{({ id }) => <Input id={id} type="number" min={0} step="any" value={f.issuedQty} disabled={readOnly} onChange={(e) => set("issuedQty", e.target.value)} />}</Field>
          <Field label="Opening" hint={opening === null ? "Blank = carried forward" : undefined}>
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" step="any" value={f.openingQty} disabled={readOnly} onChange={(e) => set("openingQty", e.target.value)} />}
          </Field>
          <Field label="Duty rate / bottle">{({ id }) => <Input id={id} type="number" min={0} step="any" value={f.dutyRate} disabled={readOnly} onChange={(e) => set("dutyRate", e.target.value)} />}</Field>
          <Field label="Duty paid" hint={!f.dutyAmount && autoDuty ? `Auto: ${inr(autoDuty)}` : undefined}>
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} step="any" value={f.dutyAmount} disabled={readOnly} onChange={(e) => set("dutyAmount", e.target.value)} />}
          </Field>
          <Field label="Closing">{() => <span className="ims-num ims-strong" style={{ display: "block", paddingTop: 9 }}>{closing === null ? "Opening + received − issued" : qtyText(closing)}</span>}</Field>
        </FormGrid>
        <Field label="Notes">{({ id }) => <Textarea id={id} rows={2} maxLength={500} value={f.notes} disabled={readOnly} onChange={(e) => set("notes", e.target.value)} />}</Field>
        {!record && !readOnly ? (
          <label className="ims-row" style={{ gap: 10 }}>
            <Checkbox checked={f.postStock} disabled={!f.itemId || received <= 0} onChange={(v) => set("postStock", v)} aria-label="Also add received bottles to stock" />
            <span style={{ fontSize: 13 }}>
              Also add the received bottles to {item ? <b>{item.name}</b> : "the linked item"}&apos;s stock (Stock in, with duty recorded)
            </span>
          </label>
        ) : null}
        {record ? (
          <KeyValues
            rows={[
              ["Bulk litres received", qtyText(record.bulkLitres)],
              ["Last updated", stampLabel(record.updatedAt)],
            ]}
          />
        ) : null}
      </Stack>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        destructive
        title="Delete this excise entry?"
        description={record?.stockPosted ? "The stock it added stays — reverse it from Stock Out or an adjustment if needed. Later entries keep their own opening balances." : "Later entries keep their own opening balances."}
        confirmLabel="Delete"
        busy={isBusy("del")}
        onConfirm={async () => {
          if (!record) return;
          const r = await run("del", () => imsSystem.deleteExcise(record.id), { success: "Excise entry deleted" });
          setConfirmDelete(false);
          if (r) onClose();
        }}
      />
    </Dialog>
  );
}

function PrintDialog({ open, onClose, data }: { open: boolean; onClose: () => void; data: ExciseList }) {
  const { session } = useIms();
  const print = usePrint();
  const totals = useMemo(
    () => data.register.reduce((t, r) => ({ received: t.received + r.received, issued: t.issued + r.issued, duty: t.duty + r.duty }), { received: 0, issued: 0, duty: 0 }),
    [data.register],
  );
  const brand = session.brand;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Print excise register"
      actions={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon="printer" onClick={print}>
            Print
          </Button>
        </>
      }
    >
      <div className="bos-inv-paper" style={{ position: "static" }}>
        <div className="ims-between" style={{ alignItems: "flex-start" }}>
          <div>
            <b style={{ fontSize: 16 }}>{brand?.name ?? session.settings.businessName}</b>
            <div className="ims-paper-seller">{[brand?.address, brand?.gstin ? `GSTIN ${brand.gstin}` : null].filter(Boolean).join("\n")}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <b style={{ fontSize: 15 }}>EXCISE STOCK REGISTER</b>
            <div className="ims-paper-sub">{dateRange(data.range.from, data.range.to)}</div>
          </div>
        </div>
        <table className="bos-inv-paper-table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Item</th>
              <th style={{ textAlign: "right" }}>Opening</th>
              <th style={{ textAlign: "right" }}>Received</th>
              <th style={{ textAlign: "right" }}>Issued</th>
              <th style={{ textAlign: "right" }}>Closing</th>
              <th style={{ textAlign: "right" }}>Duty (₹)</th>
            </tr>
          </thead>
          <tbody>
            {data.register.map((r) => (
              <tr key={r.key}>
                <td>
                  {r.itemName}
                  <small>{[r.brand, r.volumeMl ? `${r.volumeMl} ml` : null].filter(Boolean).join(" · ")}</small>
                </td>
                <td style={{ textAlign: "right" }}>{qtyText(r.opening)}</td>
                <td style={{ textAlign: "right" }}>{qtyText(r.received)}</td>
                <td style={{ textAlign: "right" }}>{qtyText(r.issued)}</td>
                <td style={{ textAlign: "right" }}>{qtyText(r.closing)}</td>
                <td style={{ textAlign: "right" }}>{inr(r.duty)}</td>
              </tr>
            ))}
            <tr>
              <td>
                <b>Total</b>
              </td>
              <td />
              <td style={{ textAlign: "right" }}>
                <b>{qtyText(totals.received)}</b>
              </td>
              <td style={{ textAlign: "right" }}>
                <b>{qtyText(totals.issued)}</b>
              </td>
              <td />
              <td style={{ textAlign: "right" }}>
                <b>{inr(totals.duty)}</b>
              </td>
            </tr>
          </tbody>
        </table>
        <table className="bos-inv-paper-table" style={{ marginTop: 18 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Permit / TP</th>
              <th>Item</th>
              <th style={{ textAlign: "right" }}>In</th>
              <th style={{ textAlign: "right" }}>Out</th>
              <th style={{ textAlign: "right" }}>Duty (₹)</th>
            </tr>
          </thead>
          <tbody>
            {[...data.records].reverse().map((r) => (
              <tr key={r.id}>
                <td>{dateLabel(r.date)}</td>
                <td>
                  {r.permitNo}
                  <small>{[r.transportPermitNo ? `TP ${r.transportPermitNo}` : null, r.batchNo ? `Batch ${r.batchNo}` : null].filter(Boolean).join(" · ")}</small>
                </td>
                <td>{r.itemName}</td>
                <td style={{ textAlign: "right" }}>{r.receivedQty ? qtyText(r.receivedQty) : "—"}</td>
                <td style={{ textAlign: "right" }}>{r.issuedQty ? qtyText(r.issuedQty) : "—"}</td>
                <td style={{ textAlign: "right" }}>{inr(r.dutyAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ims-paper-sign">
          <div>
            <div className="ims-paper-sign-line" />
            Prepared by
          </div>
          <div>
            <div className="ims-paper-sign-line" />
            Licensee / authorised signatory
          </div>
        </div>
      </div>
    </Dialog>
  );
}

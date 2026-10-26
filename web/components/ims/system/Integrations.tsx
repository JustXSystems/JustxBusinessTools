"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, Field, FilterChip, FormGrid, Grid, Input, KpiCard, Segmented, Select, StatusLight, Switch, type BosColumn } from "@/components/bos";
import { apiUrl } from "@/lib/api-base";
import type { Period } from "@/lib/ims/api";
import { dateLabel, downloadCsv, inr, PERIOD_OPTIONS, qtyText, stampLabel, timeAgo, todayLocal, type ExportColumn } from "@/lib/ims/format";
import {
  imsSystem,
  saveBlob,
  SYNC_TONE,
  type IntegrationsOverview,
  type PosConfigInput,
  type PosFrequency,
  type PosPayMode,
  type PosSaleResult,
  type PosView,
  type SyncLogEntry,
  type TallyConfig,
  type TallyExportType,
  type TallyFrequency,
  type TallySync,
  type TallySyncResult,
  type TallyTestResult,
  type TallyView,
} from "@/lib/ims/system";
import { Loaded, PageHeader, RequirePerm, Stack, SubTabs, useIms, useImsAction, useImsData } from "../core";
import { ConfirmDialog, KeyValues, ToolHead } from "./shared";

type Tab = "tally" | "pos" | "log";

const FREQ_LABEL: Record<TallyFrequency, string> = { realtime: "After every change", "15m": "Every 15 minutes", hourly: "Hourly", daily: "Daily", manual: "Only when I press Sync now" };
const FREQ_HOURS: Record<TallyFrequency, number | null> = { realtime: 0.25, "15m": 0.25, hourly: 1, daily: 24, manual: null };
const POS_FREQ_LABEL: Record<PosFrequency, string> = { realtime: "Real-time (each bill)", "15m": "Every 15 minutes", hourly: "Hourly", daily: "End of day" };
const PAY_MODES: ReadonlyArray<{ value: PosPayMode; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "credit", label: "Credit (unpaid)" },
];

export function IntegrationsModule() {
  const { takeIntent } = useIms();
  const [intent] = useState(() => takeIntent("integrations"));
  const [tab, setTab] = useState<Tab>(intent === "pos" ? "pos" : intent === "log" ? "log" : "tally");
  const state = useImsData(() => imsSystem.integrations(), []);
  return (
    <RequirePerm perm={["integrations", "audit"]} what="Tally & POS integrations">
      <Stack>
        <PageHeader title="Tally & POS" sub="Push masters and vouchers to Tally, export Tally XML, and pull bills from your point-of-sale counter." />
        <SubTabs
          label="Integrations"
          value={tab}
          onChange={setTab}
          options={[
            { value: "tally", label: "Tally ERP" },
            { value: "pos", label: "POS" },
            { value: "log", label: "Sync log" },
          ]}
        />
        <Loaded state={state}>
          {(d) => (tab === "tally" ? <TallyTab data={d} /> : tab === "pos" ? <PosTab data={d} /> : <LogTab log={d.log} />)}
        </Loaded>
      </Stack>
    </RequirePerm>
  );
}

/* ---------- Tally ---------- */

function syncDue(t: TallyView): string | null {
  const hours = FREQ_HOURS[t.sync.frequency];
  if (!t.enabled || hours === null) return null;
  if (!t.lastSyncAt) return "Never synced — run your first sync.";
  const age = (Date.now() - Date.parse(t.lastSyncAt)) / 3_600_000;
  return age > hours ? `Last sync ${timeAgo(t.lastSyncAt)} — a sync is due (${FREQ_LABEL[t.sync.frequency].toLowerCase()}).` : null;
}

function TallyTab({ data }: { data: IntegrationsOverview }) {
  const { can } = useIms();
  const editable = can("integrations");
  const { run, isBusy } = useImsAction();
  const t = data.tally;
  const [form, setForm] = useState<TallyConfig>(() => t.config ?? { host: "localhost", port: 9000, company: "", product: "prime", syncMode: "export" });
  const [sync, setSync] = useState<TallySync>(t.sync);
  const [test, setTest] = useState<TallyTestResult | null>(null);
  const [result, setResult] = useState<TallySyncResult | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const due = syncDue(t);
  const dirty = JSON.stringify(form) !== JSON.stringify(t.config);
  const syncDirty = JSON.stringify(sync) !== JSON.stringify(t.sync);
  const set = <K extends keyof TallyConfig>(k: K, v: TallyConfig[K]) => setForm((f) => ({ ...f, [k]: v }));

  const runTest = async () => {
    const r = await run("test", () => imsSystem.testTally({ host: form.host.trim(), port: form.port, company: form.company.trim() || undefined }), { refresh: true });
    if (r) setTest(r);
  };

  return (
    <Stack gap={16}>
      <Card interactive={false}>
        <Stack gap={14}>
          <ToolHead
            glyph="🧾"
            title="Tally connection"
            sub="IMS talks to Tally's built-in XML server (Gateway of Tally → F1 Help → Settings → Connectivity → act as Server, port 9000)."
            aside={
              <StatusLight state={t.enabled ? (t.lastStatus === "failed" ? "warn" : "on") : "off"}>
                {t.enabled ? `Connected · ${t.config?.company}` : "Not connected"}
              </StatusLight>
            }
          />
          {t.enabled ? (
            <KeyValues
              rows={[
                ["Server", `${t.config?.host}:${t.config?.port}`],
                ["Product", t.config?.product === "erp9" ? "Tally.ERP 9" : "TallyPrime"],
                ["Last sync", t.lastSyncAt ? `${stampLabel(t.lastSyncAt)} (${timeAgo(t.lastSyncAt)})` : "Never"],
                ["Last result", t.lastStatus ? <Badge tone={SYNC_TONE[t.lastStatus as keyof typeof SYNC_TONE] ?? "neutral"}>{t.lastStatus}</Badge> : "—"],
              ]}
            />
          ) : null}
          {due ? <Alert tone="amber" title="Sync due">{due}</Alert> : null}
          <FormGrid columns="2fr 1fr">
            <Field label="Host / IP" hint="The PC running Tally — e.g. 192.168.1.20, or a public hostname if Tally is in the cloud.">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={form.host} disabled={!editable} onChange={(e) => set("host", e.target.value)} placeholder="localhost" />}
            </Field>
            <Field label="Port">
              {({ id }) => <Input id={id} type="number" min={1} max={65535} value={form.port} disabled={!editable} onChange={(e) => set("port", Number(e.target.value) || 9000)} />}
            </Field>
          </FormGrid>
          <FormGrid columns="2fr 1fr 1fr">
            <Field label="Company name in Tally" hint="Exactly as shown in Tally's company list.">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={form.company} disabled={!editable} onChange={(e) => set("company", e.target.value)} placeholder="My Business Pvt Ltd" />}
            </Field>
            <Field label="Product">
              {({ id }) => (
                <Select id={id} value={form.product} disabled={!editable} onChange={(e) => set("product", e.target.value === "erp9" ? "erp9" : "prime")}>
                  <option value="prime">TallyPrime</option>
                  <option value="erp9">Tally.ERP 9</option>
                </Select>
              )}
            </Field>
            <Field label="Direction">
              {({ id }) => (
                <Select id={id} value={form.syncMode} disabled={!editable} onChange={(e) => set("syncMode", e.target.value === "two_way" ? "two_way" : e.target.value === "import" ? "import" : "export")}>
                  <option value="export">IMS → Tally</option>
                  <option value="two_way">Two-way (IMS is master)</option>
                  <option value="import">Tally → IMS (masters)</option>
                </Select>
              )}
            </Field>
          </FormGrid>
          {editable ? (
            <div className="ims-row" style={{ flexWrap: "wrap" }}>
              <Button icon="refresh" disabled={!form.host.trim() || isBusy("test")} onClick={() => void runTest()}>
                {isBusy("test") ? "Testing…" : "Test connection"}
              </Button>
              <Button
                variant="primary"
                icon="check"
                disabled={!form.host.trim() || !form.company.trim() || (!dirty && t.enabled) || isBusy("save")}
                onClick={() => void run("save", () => imsSystem.saveTally({ ...form, host: form.host.trim(), company: form.company.trim() }), { success: t.enabled ? "Tally settings saved" : "Tally connected" })}
              >
                {t.enabled ? "Save changes" : "Connect Tally"}
              </Button>
              {t.enabled ? (
                <>
                  <Button
                    variant="success"
                    icon="refresh"
                    disabled={isBusy("sync")}
                    onClick={async () => {
                      const r = await run("sync", () => imsSystem.syncTally(), { refresh: true });
                      if (r) setResult(r);
                    }}
                  >
                    {isBusy("sync") ? "Syncing…" : "Sync now"}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmOff(true)}>
                    Disconnect
                  </Button>
                </>
              ) : null}
            </div>
          ) : (
            <Alert tone="blue" title="View only">
              Your role can download Tally XML for audit, but only users with the Tally & POS permission can change the connection.
            </Alert>
          )}
          {test ? <TestResult result={test} onPick={(company) => set("company", company)} /> : null}
          {result ? <SyncResult result={result} /> : null}
        </Stack>
      </Card>

      {t.enabled && editable ? (
        <Card interactive={false}>
          <Stack gap={12}>
            <ToolHead glyph="⚙" title="What to sync" sub="Masters go first so every voucher's ledgers and stock items exist in Tally." />
            <Grid cols={2} min={240}>
              {(
                [
                  ["ledgers", "Party ledgers", "Customers under Sundry Debtors, suppliers under Sundry Creditors, with GSTIN and state."],
                  ["stockItems", "Stock items", "Items with unit, HSN and GST rate, grouped by category."],
                  ["salesVouchers", "Sales vouchers", "Issued invoices with CGST / SGST / IGST split and inventory lines."],
                  ["purchaseVouchers", "Purchase vouchers", "Approved supplier bills with input tax."],
                  ["notes", "Credit / debit notes", "Customer returns as Credit Notes and supplier returns as Debit Notes, reversing GST at each item's rate."],
                  ["receipts", "Receipts & payments", "Customer receipts and supplier payments against Cash (cash) or Bank Account (UPI, card, cheque, transfer)."],
                ] as const
              ).map(([key, label, hint]) => (
                <label key={key} className="ims-row" style={{ alignItems: "flex-start", gap: 10 }}>
                  <Switch checked={sync[key]} onChange={(v) => setSync((s) => ({ ...s, [key]: v }))} aria-label={label} />
                  <span>
                    <b style={{ fontSize: 13 }}>{label}</b>
                    <small className="ims-muted" style={{ display: "block", fontSize: 12 }}>
                      {hint}
                    </small>
                  </span>
                </label>
              ))}
            </Grid>
            <FormGrid>
              <Field label="Sync rhythm" hint="IMS flags here when a sync is due; syncs run when you press Sync now.">
                {({ id, describedBy }) => (
                  <Select id={id} aria-describedby={describedBy} value={sync.frequency} onChange={(e) => setSync((s) => ({ ...s, frequency: e.target.value as TallyFrequency }))}>
                    {(Object.keys(FREQ_LABEL) as TallyFrequency[]).map((f) => (
                      <option key={f} value={f}>
                        {FREQ_LABEL[f]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </FormGrid>
            <div className="ims-row">
              <Button variant="primary" disabled={!syncDirty || isBusy("sync-save")} onClick={() => void run("sync-save", () => imsSystem.saveTallySync(sync), { success: "Sync settings saved" })}>
                Save sync settings
              </Button>
            </div>
          </Stack>
        </Card>
      ) : null}

      <XmlExport counts={data.counts} />

      <ConfirmDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        destructive
        title="Disconnect Tally?"
        description="IMS stops pushing to Tally. Your settings and sync history are kept, and XML export keeps working."
        confirmLabel="Disconnect"
        busy={isBusy("off")}
        onConfirm={async () => {
          await run("off", () => imsSystem.disconnectTally(), { success: "Tally disconnected" });
          setConfirmOff(false);
        }}
      />
    </Stack>
  );
}

function TestResult({ result, onPick }: { result: TallyTestResult; onPick: (company: string) => void }) {
  if (!result.reachable) {
    return (
      <Alert tone="coral" title="Couldn't reach Tally">
        <p style={{ margin: "0 0 6px" }}>{result.message}</p>
        <p style={{ margin: 0 }}>
          Tally must be open with its XML server on, and the IMS server must be able to reach that address. An office PC on a private network (192.168.x.x) usually isn&apos;t reachable from the cloud — use a public IP with port
          forwarding, Tally on Cloud, or download the XML below and import it in Tally.
        </p>
      </Alert>
    );
  }
  return (
    <Alert tone={result.companyFound === false ? "amber" : "emerald"} title={result.companyFound === false ? "Tally is reachable, but the company isn't open" : "Tally is reachable"}>
      <p style={{ margin: "0 0 6px" }}>{result.message}</p>
      {result.companies.length ? (
        <div className="ims-row" style={{ flexWrap: "wrap", gap: 6 }}>
          <span className="ims-muted" style={{ fontSize: 12.5 }}>
            Open companies:
          </span>
          {result.companies.map((c) => (
            <FilterChip key={c} onClick={() => onPick(c)} title="Use this company">
              {c}
            </FilterChip>
          ))}
        </div>
      ) : null}
    </Alert>
  );
}

function SyncResult({ result }: { result: TallySyncResult }) {
  return (
    <Alert tone={SYNC_TONE[result.status]} title={result.status === "success" ? "Sync complete" : result.status === "partial" ? "Sync finished with problems" : "Sync failed"}>
      <ul className="ims-sys-steps" style={{ marginTop: 6 }}>
        {result.steps.map((s) => (
          <li key={s.entity}>
            <Badge tone={SYNC_TONE[s.status]}>{s.entity}</Badge>
            <span>
              {s.records ? <b>{s.records} records · </b> : null}
              {s.message}
            </span>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

function XmlExport({ counts }: { counts: IntegrationsOverview["counts"] }) {
  const { run, isBusy } = useImsAction();
  const [type, setType] = useState<TallyExportType>("sales");
  const [period, setPeriod] = useState<Period>("mtd");
  const [from, setFrom] = useState(() => todayLocal().slice(0, 8) + "01");
  const [to, setTo] = useState(() => todayLocal());
  const customOk = period !== "custom" || (Boolean(from) && Boolean(to) && from <= to);
  return (
    <Card interactive={false}>
      <Stack gap={12}>
        <ToolHead glyph="⬇" title="Export Tally XML" sub="Always works, even without a live connection. In Tally: Gateway of Tally → Import → Masters (or Transactions) → choose this file." />
        <Grid cols={4} min={140}>
          <KpiCard interactive={false} label="Parties" value={counts.parties} />
          <KpiCard interactive={false} label="Items" value={counts.items} />
          <KpiCard interactive={false} label="Issued invoices" value={counts.invoices} />
          <KpiCard interactive={false} label="Supplier bills" value={counts.bills} />
        </Grid>
        <Segmented
          size="sm"
          role="radio"
          aria-label="What to export"
          value={type}
          onChange={setType}
          options={[
            { value: "masters", label: "Masters (ledgers + items)" },
            { value: "sales", label: "Sales vouchers" },
            { value: "purchases", label: "Purchase vouchers" },
            { value: "notes", label: "Credit / debit notes" },
            { value: "receipts", label: "Receipts & payments" },
            { value: "all", label: "Everything" },
          ]}
        />
        {type !== "masters" ? (
          <div className="ims-between" style={{ flexWrap: "wrap", gap: 10 }}>
            <Segmented size="sm" role="radio" scroll aria-label="Period" value={period} onChange={setPeriod} options={[...PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.label })), { value: "custom" as Period, label: "Custom" }]} />
            {period === "custom" ? (
              <span className="ims-row">
                <Field label="From" error={!customOk ? "Start must be before end" : null}>
                  {({ id }) => <Input id={id} size="sm" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
                </Field>
                <Field label="To">{({ id }) => <Input id={id} size="sm" type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="ims-row">
          <Button
            variant="primary"
            icon="download"
            disabled={!customOk || isBusy("xml")}
            onClick={() =>
              void run(
                "xml",
                async () => {
                  const file = await imsSystem.exportTally(type, period === "custom" ? { from, to } : { period });
                  saveBlob(file);
                  return file;
                },
                { success: "Tally XML downloaded", description: "Import it in Tally from Gateway of Tally → Import.", refresh: true },
              )
            }
          >
            {isBusy("xml") ? "Preparing…" : "Download XML"}
          </Button>
          <span className="ims-sys-mini">Import masters before vouchers the first time, so ledgers and stock items exist.</span>
        </div>
      </Stack>
    </Card>
  );
}

/* ---------- POS ---------- */

function PosTab({ data }: { data: IntegrationsOverview }) {
  const { can, navigate } = useIms();
  const editable = can("integrations");
  const { run, isBusy } = useImsAction();
  const p: PosView = data.pos;
  const [form, setForm] = useState<PosConfigInput>(() => ({
    provider: p.config?.provider ?? data.posProviders[0] ?? "Custom API",
    storeId: p.config?.storeId ?? "",
    apiKey: "",
    syncFrequency: p.config?.syncFrequency ?? "realtime",
    ratesIncludeTax: p.config?.ratesIncludeTax ?? true,
    customerName: p.config?.customerName ?? "Walk-in customer",
  }));
  const [last, setLast] = useState<PosSaleResult | null>(null);
  const [manual, setManual] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const set = <K extends keyof PosConfigInput>(k: K, v: PosConfigInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const posLog = data.log.filter((l) => l.provider === "pos");
  const endpoint = apiUrl("/api/ims/integrations/pos/sale");

  return (
    <Stack gap={16}>
      <Grid cols={3} min={180}>
        <KpiCard interactive={false} label="Status" value={p.enabled ? "Connected" : "Off"} valueTone={p.enabled ? "emerald" : undefined} delta={p.config?.provider ?? "No provider"} deltaTone="muted" />
        <KpiCard interactive={false} label="POS bills today" value={data.counts.posToday} delta="Synced into Invoices" deltaTone="info" />
        <KpiCard interactive={false} label="Last sync" value={p.lastSyncAt ? timeAgo(p.lastSyncAt) : "Never"} delta={p.lastStatus ?? "—"} deltaTone={p.lastStatus === "failed" ? "down" : "muted"} />
      </Grid>

      <Card interactive={false}>
        <Stack gap={14}>
          <ToolHead
            glyph="🏪"
            title="Point-of-sale connection"
            sub="Each POS bill reduces stock (refType POS) and becomes a paid invoice in Invoices & Billing. Re-sending the same bill number is ignored."
            aside={
              editable && p.config ? (
                <label className="ims-row" style={{ gap: 8 }}>
                  <span className="ims-muted" style={{ fontSize: 13 }}>
                    Connected
                  </span>
                  <Switch
                    checked={p.enabled}
                    aria-label="POS connected"
                    onChange={(on) => (on ? void run("pos-on", () => imsSystem.savePos({ ...form, apiKey: null, enabled: true }), { success: "POS connected" }) : setConfirmOff(true))}
                  />
                </label>
              ) : null
            }
          />
          <FormGrid>
            <Field label="POS software">
              {({ id }) => (
                <Select id={id} value={form.provider} disabled={!editable} onChange={(e) => set("provider", e.target.value)}>
                  {data.posProviders.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Store / outlet ID">{({ id }) => <Input id={id} value={form.storeId ?? ""} disabled={!editable} onChange={(e) => set("storeId", e.target.value)} placeholder="Optional" />}</Field>
            <Field label="API key" hint={p.config?.hasApiKey ? `Saved (${p.config.apiKeyHint}). Leave blank to keep it.` : "Write-only — IMS never shows a saved key again."}>
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="password" autoComplete="new-password" value={form.apiKey ?? ""} disabled={!editable} onChange={(e) => set("apiKey", e.target.value)} placeholder={p.config?.hasApiKey ? "••••••••" : "Paste the key from your POS"} />}
            </Field>
            <Field label="Sync frequency">
              {({ id }) => (
                <Select id={id} value={form.syncFrequency} disabled={!editable} onChange={(e) => set("syncFrequency", e.target.value as PosFrequency)}>
                  {(Object.keys(POS_FREQ_LABEL) as PosFrequency[]).map((f) => (
                    <option key={f} value={f}>
                      {POS_FREQ_LABEL[f]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Default customer name">{({ id }) => <Input id={id} value={form.customerName} disabled={!editable} onChange={(e) => set("customerName", e.target.value)} />}</Field>
            <Field label="POS prices include GST">
              {({ id }) => (
                <span className="ims-row" style={{ minHeight: 38 }}>
                  <Switch id={id} checked={form.ratesIncludeTax} disabled={!editable} onChange={(v) => set("ratesIncludeTax", v)} aria-label="POS prices include GST" />
                  <span className="ims-muted" style={{ fontSize: 12.5 }}>
                    {form.ratesIncludeTax ? "MRP-style prices; IMS backs out the tax" : "Prices are before tax"}
                  </span>
                </span>
              )}
            </Field>
          </FormGrid>
          {editable ? (
            <div className="ims-row" style={{ flexWrap: "wrap" }}>
              <Button variant="primary" icon="check" disabled={!form.provider || isBusy("pos-save")} onClick={() => void run("pos-save", () => imsSystem.savePos({ ...form, apiKey: form.apiKey?.trim() || null, enabled: true }), { success: p.enabled ? "POS settings saved" : "POS connected" })}>
                {p.enabled ? "Save changes" : "Connect POS"}
              </Button>
              <Button
                icon="sparkle"
                disabled={!p.enabled || isBusy("sim")}
                onClick={async () => {
                  const r = await run("sim", () => imsSystem.simulatePos(), { success: "POS sale simulated" });
                  if (r) setLast(r.sale);
                }}
              >
                {isBusy("sim") ? "Simulating…" : "Simulate a POS sale"}
              </Button>
              <Button icon="receipt" disabled={!p.enabled} onClick={() => setManual(true)}>
                Record a POS bill
              </Button>
            </div>
          ) : null}
          {last ? (
            <Alert tone="emerald" title={`${last.invoiceNo} · ${inr(last.grandTotal)}`} actions={<Button size="sm" onClick={() => navigate("sales", `open:${last.invoiceId}`)}>Open invoice</Button>}>
              {last.lines} line{last.lines === 1 ? "" : "s"}, {qtyText(last.units)} units taken out of stock · {last.paid ? "marked paid" : "on credit"}.
            </Alert>
          ) : null}
        </Stack>
      </Card>

      <Card interactive={false}>
        <Stack gap={10}>
          <ToolHead glyph="⇄" title="Integration endpoint" sub="For Justx-built connectors and your developer. Requests must be signed in as an IMS user with the Tally & POS or Sales invoices permission." />
          <pre className="ims-sys-code">{`POST ${endpoint}
{
  "billNo": "B-1042",
  "paymentMode": "upi",
  "items": [
    { "sku": "SKU-001", "qty": 2, "rate": 118 },
    { "barcode": "8901234567890", "qty": 1 }
  ]
}`}</pre>
          <span className="ims-sys-mini">Rate is optional (falls back to the item&apos;s selling price). The same bill number is never booked twice.</span>
        </Stack>
      </Card>

      <Card interactive={false}>
        <div className="ims-between" style={{ marginBottom: 10 }}>
          <b>Recent POS syncs</b>
          <span className="ims-sys-mini">{posLog.length ? `Last ${timeAgo(posLog[0].createdAt)}` : ""}</span>
        </div>
        <LogTable rows={posLog.slice(0, 20)} />
      </Card>

      <ManualSaleDialog open={manual} onClose={() => setManual(false)} onDone={setLast} />
      <ConfirmDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        destructive
        title="Disconnect the POS?"
        description="New POS bills will be rejected until you reconnect. Bills already synced stay in IMS."
        confirmLabel="Disconnect"
        busy={isBusy("pos-off")}
        onConfirm={async () => {
          await run("pos-off", () => imsSystem.disconnectPos(), { success: "POS disconnected" });
          setConfirmOff(false);
        }}
      />
    </Stack>
  );
}

type ManualLine = { code: string; qty: string; rate: string };

function ManualSaleDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (r: PosSaleResult) => void }) {
  const { run, isBusy } = useImsAction();
  const [billNo, setBillNo] = useState("");
  const [mode, setMode] = useState<PosPayMode>("cash");
  const [lines, setLines] = useState<ManualLine[]>([{ code: "", qty: "1", rate: "" }]);
  const valid = billNo.trim() && lines.some((l) => l.code.trim() && Number(l.qty) > 0);
  const setLine = (i: number, patch: Partial<ManualLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const submit = async () => {
    const items = lines
      .filter((l) => l.code.trim() && Number(l.qty) > 0)
      .map((l) => {
        const code = l.code.trim();
        const rate = l.rate.trim() ? Number(l.rate) : undefined;
        return /^\d{8,14}$/.test(code) ? { barcode: code, qty: Number(l.qty), rate } : { sku: code, qty: Number(l.qty), rate };
      });
    const r = await run("manual", () => imsSystem.posSale({ billNo: billNo.trim(), paymentMode: mode, items }), { success: "POS bill recorded" });
    if (r) {
      onDone(r.sale);
      setBillNo("");
      setLines([{ code: "", qty: "1", rate: "" }]);
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Record a POS bill"
      description="Goes through the same path as a live POS: stock out, invoice, payment. Codes of 8–14 digits are treated as barcodes, anything else as SKU."
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid || isBusy("manual")} onClick={() => void submit()}>
            {isBusy("manual") ? "Recording…" : "Record bill"}
          </Button>
        </>
      }
    >
      <Stack gap={12}>
        <FormGrid>
          <Field label="POS bill number">{({ id }) => <Input id={id} value={billNo} maxLength={40} onChange={(e) => setBillNo(e.target.value)} placeholder="B-1042" />}</Field>
          <Field label="Payment">
            {({ id }) => (
              <Select id={id} value={mode} onChange={(e) => setMode(e.target.value as PosPayMode)}>
                {PAY_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FormGrid>
        {lines.map((l, i) => (
          <FormGrid key={i} columns="2fr 1fr 1fr auto">
            <Field label={i === 0 ? "SKU or barcode" : ""}>{({ id }) => <Input id={id} size="sm" value={l.code} onChange={(e) => setLine(i, { code: e.target.value })} />}</Field>
            <Field label={i === 0 ? "Qty" : ""}>{({ id }) => <Input id={id} size="sm" type="number" min={0} step="any" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />}</Field>
            <Field label={i === 0 ? "Rate (optional)" : ""}>{({ id }) => <Input id={id} size="sm" type="number" min={0} step="any" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />}</Field>
            <Field label={i === 0 ? " " : ""}>{() => <Button size="sm" iconOnly icon="x" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} />}</Field>
          </FormGrid>
        ))}
        <div>
          <Button size="sm" icon="plus" disabled={lines.length >= 50} onClick={() => setLines((ls) => [...ls, { code: "", qty: "1", rate: "" }])}>
            Add line
          </Button>
        </div>
      </Stack>
    </Dialog>
  );
}

/* ---------- Sync log ---------- */

function LogTable({ rows }: { rows: ReadonlyArray<SyncLogEntry> }) {
  const columns: BosColumn<SyncLogEntry>[] = [
    {
      key: "when",
      header: "When",
      cell: (r) => (
        <span className="ims-cell-stack">
          <span>{r.createdAt ? dateLabel(r.createdAt.slice(0, 10)) : "—"}</span>
          <small>{stampLabel(r.createdAt)}</small>
        </span>
      ),
    },
    { key: "provider", header: "System", cell: (r) => (r.provider === "tally" ? "Tally" : "POS") },
    { key: "entity", header: "What", cell: (r) => <span className="ims-cell-stack"><span>{r.entity}</span><small>{r.direction === "export" ? "IMS → out" : "In → IMS"}</small></span> },
    { key: "status", header: "Result", cell: (r) => <Badge tone={SYNC_TONE[r.status] ?? "neutral"}>{r.status}</Badge> },
    { key: "records", header: "Records", align: "right", cell: (r) => <span className="ims-num">{r.records}</span> },
    { key: "message", header: "Details", cell: (r) => <span className="ims-muted" style={{ fontSize: 12.5 }}>{r.message ?? "—"}</span> },
    { key: "by", header: "By", cell: (r) => <span className="ims-muted">{r.actorName ?? "System"}</span> },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.id)} compact caption="Sync log" empty={<EmptyState icon="refresh" title="Nothing synced yet">Tests, syncs, XML downloads and POS bills are logged here.</EmptyState>} />;
}

function LogTab({ log }: { log: SyncLogEntry[] }) {
  const [provider, setProvider] = useState<"" | "tally" | "pos">("");
  const [status, setStatus] = useState<"" | "success" | "partial" | "failed">("");
  const [limit, setLimit] = useState(60);
  const state = useImsData(() => (limit > 60 || provider ? imsSystem.syncLog(provider || undefined, limit).then((r) => r.log) : Promise.resolve(log)), [provider, limit, log]);
  const exportCols: ReadonlyArray<ExportColumn<SyncLogEntry>> = [
    { header: "When", value: (r) => r.createdAt },
    { header: "System", value: (r) => r.provider },
    { header: "Direction", value: (r) => r.direction },
    { header: "What", value: (r) => r.entity },
    { header: "Result", value: (r) => r.status },
    { header: "Records", value: (r) => r.records },
    { header: "Details", value: (r) => r.message },
    { header: "By", value: (r) => r.actorName },
  ];
  return (
    <Card interactive={false}>
      <Stack gap={12}>
        <div className="ims-between" style={{ flexWrap: "wrap", gap: 8 }}>
          <div className="ims-row" style={{ flexWrap: "wrap", gap: 6 }}>
            {(
              [
                ["", "All systems"],
                ["tally", "Tally"],
                ["pos", "POS"],
              ] as const
            ).map(([v, l]) => (
              <FilterChip key={v || "all"} active={provider === v} onClick={() => setProvider(v)}>
                {l}
              </FilterChip>
            ))}
            <span className="ims-faint">|</span>
            {(
              [
                ["", "Any result"],
                ["success", "Success"],
                ["partial", "Partial"],
                ["failed", "Failed"],
              ] as const
            ).map(([v, l]) => (
              <FilterChip key={v || "any"} active={status === v} onClick={() => setStatus(v)}>
                {l}
              </FilterChip>
            ))}
          </div>
          <Button size="sm" icon="download" disabled={!state.data?.length} onClick={() => downloadCsv(`ims-sync-log-${todayLocal()}`, state.data ?? [], exportCols)}>
            CSV
          </Button>
        </div>
        <Loaded state={state}>
          {(rows) => {
            const shown = rows.filter((r) => !status || r.status === status);
            return (
              <>
                <LogTable rows={shown} />
                {rows.length >= limit && limit < 500 ? (
                  <div className="ims-row" style={{ justifyContent: "center" }}>
                    <Button size="sm" onClick={() => setLimit(500)}>
                      Load more
                    </Button>
                  </div>
                ) : null}
              </>
            );
          }}
        </Loaded>
      </Stack>
    </Card>
  );
}

export default IntegrationsModule;

import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { insertImsInvoice } from "./connect.js";
import { actorName, actorOf, isoDate, parse, qint, qstr, recordEvent, requireAnyPerm, requirePerm, type ImsDeps } from "./context.js";
import { exec, isoOf, json, money, one, rows, tsOf, tx, type Queryable } from "./db.js";
import { ImsError, badRequest, conflict, type ImsActor } from "./host.js";
import {
  TALLY_LEDGERS,
  addDaysISO,
  computeTotals,
  isISODate,
  isIntraState,
  isTallyHost,
  parseTallyCompanies,
  parseTallyResponse,
  periodRange,
  posExclusiveRate,
  round2,
  round3,
  tallyEnvelope,
  tallyLedgerXml,
  tallyPingEnvelope,
  tallyStockGroupXml,
  tallyStockItemXml,
  tallyUnitXml,
  tallyVoucherXml,
  todayISO,
  type ImsLineInput,
  type TallyImportResult,
  type TallyVoucher,
} from "./logic.js";
import { getSettings, type ImsSettings } from "./settings.js";
import { postMovement } from "./stock.js";

export type IntegrationProvider = "tally" | "pos";
type SyncStatus = "success" | "failed" | "partial";

const TALLY_FREQUENCIES = ["realtime", "15m", "hourly", "daily", "manual"] as const;
const POS_PROVIDERS = ["Vyapar", "Zoho Invoice", "Petpooja", "Marg ERP", "Gofrugal", "Custom API"] as const;
const POS_PAY_MODES = ["cash", "upi", "card", "bank", "cheque", "credit"] as const;

const TallyConfig = z.object({
  host: z.string().trim().min(1, "Enter the Tally host").max(253).refine(isTallyHost, "Use a hostname or IP address only (no http:// or path)"),
  port: z.coerce.number().int().min(1).max(65535),
  company: z.string().trim().min(1, "Enter the Tally company name").max(200),
  product: z.enum(["prime", "erp9"]).default("prime"),
  syncMode: z.enum(["export", "two_way", "import"]).default("export"),
});

const TallySync = z.object({
  ledgers: z.boolean().default(true),
  stockItems: z.boolean().default(true),
  salesVouchers: z.boolean().default(true),
  purchaseVouchers: z.boolean().default(true),
  receipts: z.boolean().default(false),
  notes: z.boolean().default(false),
  frequency: z.enum(TALLY_FREQUENCIES).default("manual"),
});
type TallySyncT = z.infer<typeof TallySync>;

const PosConfig = z.object({
  provider: z.string().trim().min(1).max(40),
  storeId: z.string().trim().max(80).nullable().optional(),
  /** Write-only. Omit or send blank to keep the stored key. */
  apiKey: z.string().trim().max(200).nullable().optional(),
  syncFrequency: z.enum(["realtime", "15m", "hourly", "daily"]).default("realtime"),
  ratesIncludeTax: z.boolean().default(true),
  customerName: z.string().trim().max(120).default("Walk-in customer"),
});
type PosConfigT = Omit<z.infer<typeof PosConfig>, "apiKey"> & { apiKey?: string | null };

type IntegrationRow = { provider: IntegrationProvider; enabled: number; config: unknown; sync: unknown; last_sync_at: string | null; last_status: string | null; updated_at: string | null };

async function loadIntegration(db: Queryable, tenantId: number, provider: IntegrationProvider): Promise<IntegrationRow | null> {
  return one<IntegrationRow>(db, `SELECT provider, enabled, config, sync, last_sync_at, last_status, updated_at FROM ims_integrations WHERE tenant_id = :tenantId AND provider = :provider`, {
    tenantId,
    provider,
  });
}

const DEFAULT_TALLY_SYNC: TallySyncT = TallySync.parse({});

function tallyView(row: IntegrationRow | null) {
  const cfg = TallyConfig.partial().safeParse(json<Record<string, unknown>>(row?.config, {}));
  const sync = TallySync.safeParse(json<Record<string, unknown>>(row?.sync, {}));
  const config = cfg.success && cfg.data.host && cfg.data.company ? { host: cfg.data.host, port: cfg.data.port ?? 9000, company: cfg.data.company, product: cfg.data.product ?? "prime", syncMode: cfg.data.syncMode ?? "export" } : null;
  return {
    enabled: Boolean(row?.enabled) && config !== null,
    config,
    sync: sync.success ? sync.data : DEFAULT_TALLY_SYNC,
    lastSyncAt: tsOf(row?.last_sync_at),
    lastStatus: row?.last_status ?? null,
  };
}

function posConfigOf(row: IntegrationRow | null): PosConfigT | null {
  const raw = json<Record<string, unknown>>(row?.config, {});
  const parsed = PosConfig.safeParse(raw);
  return parsed.success ? { ...parsed.data, apiKey: typeof raw.apiKey === "string" ? raw.apiKey : null } : null;
}

/** Never returns the stored API key — only whether one is set and its last four characters. */
function posView(row: IntegrationRow | null) {
  const cfg = posConfigOf(row);
  return {
    enabled: Boolean(row?.enabled) && cfg !== null,
    config: cfg
      ? {
          provider: cfg.provider,
          storeId: cfg.storeId ?? null,
          syncFrequency: cfg.syncFrequency,
          ratesIncludeTax: cfg.ratesIncludeTax,
          customerName: cfg.customerName,
          hasApiKey: Boolean(cfg.apiKey),
          apiKeyHint: cfg.apiKey ? `•••• ${cfg.apiKey.slice(-4)}` : null,
        }
      : null,
    lastSyncAt: tsOf(row?.last_sync_at),
    lastStatus: row?.last_status ?? null,
  };
}

async function saveIntegration(db: Queryable, actor: ImsActor, provider: IntegrationProvider, patch: { enabled?: boolean; config?: unknown; sync?: unknown }): Promise<void> {
  await exec(
    db,
    `INSERT INTO ims_integrations (tenant_id, provider, enabled, config, sync, updated_by)
     VALUES (:tenantId, :provider, :enabled, :config, :sync, :userId)
     ON DUPLICATE KEY UPDATE
       enabled = COALESCE(:enabledSet, enabled),
       config = COALESCE(:configSet, config),
       sync = COALESCE(:syncSet, sync),
       updated_by = :userId`,
    {
      tenantId: actor.tenantId,
      provider,
      enabled: patch.enabled ? 1 : 0,
      config: patch.config === undefined ? null : JSON.stringify(patch.config),
      sync: patch.sync === undefined ? null : JSON.stringify(patch.sync),
      enabledSet: patch.enabled === undefined ? null : patch.enabled ? 1 : 0,
      configSet: patch.config === undefined ? null : JSON.stringify(patch.config),
      syncSet: patch.sync === undefined ? null : JSON.stringify(patch.sync),
      userId: actor.userId,
    },
  );
}

async function touchIntegration(db: Queryable, tenantId: number, provider: IntegrationProvider, status: SyncStatus): Promise<void> {
  await exec(
    db,
    `INSERT INTO ims_integrations (tenant_id, provider, enabled, last_sync_at, last_status) VALUES (:tenantId, :provider, 0, CURRENT_TIMESTAMP, :status)
     ON DUPLICATE KEY UPDATE last_sync_at = CURRENT_TIMESTAMP, last_status = :status`,
    { tenantId, provider, status },
  );
}

export async function logSync(
  db: Queryable,
  actor: ImsActor,
  entry: { provider: IntegrationProvider; direction: "export" | "import"; entity: string; status: SyncStatus; records: number; message?: string | null },
): Promise<void> {
  try {
    await exec(
      db,
      `INSERT INTO ims_sync_log (tenant_id, provider, direction, entity, status, records, message, actor_name)
       VALUES (:tenantId, :provider, :direction, :entity, :status, :records, :message, :actorName)`,
      {
        tenantId: actor.tenantId,
        provider: entry.provider,
        direction: entry.direction,
        entity: entry.entity.slice(0, 24),
        status: entry.status,
        records: Math.max(0, Math.round(entry.records)),
        message: entry.message ? entry.message.slice(0, 500) : null,
        actorName: actorName(actor),
      },
    );
  } catch (err) {
    console.warn("[ims] sync log failed", err instanceof Error ? err.message : err);
  }
}

type SyncLogRow = { id: number; provider: string; direction: string; entity: string; status: string; records: number; message: string | null; actor_name: string | null; created_at: string };

export async function syncLog(db: Queryable, tenantId: number, provider: string | null, limit: number) {
  const list = await rows<SyncLogRow>(
    db,
    `SELECT id, provider, direction, entity, status, records, message, actor_name, created_at FROM ims_sync_log
     WHERE tenant_id = :tenantId ${provider ? "AND provider = :provider" : ""} ORDER BY id DESC LIMIT :limit`,
    { tenantId, provider, limit },
  );
  return list.map((r) => ({ id: Number(r.id), provider: r.provider, direction: r.direction, entity: r.entity, status: r.status, records: Number(r.records), message: r.message, actorName: r.actor_name, createdAt: tsOf(r.created_at) }));
}

/* ---------- Tally XML builders (data → logic.ts XML) ---------- */

async function buildMasters(db: Queryable, tenantId: number, settings: ImsSettings, include: { ledgers: boolean; stockItems: boolean }): Promise<{ messages: string[]; counts: Record<string, number> }> {
  const messages: string[] = [];
  const counts = { ledgers: 0, units: 0, groups: 0, stockItems: 0 };
  if (include.ledgers) {
    const fixed = [
      { name: TALLY_LEDGERS.sales, parent: "Sales Accounts" },
      { name: TALLY_LEDGERS.purchase, parent: "Purchase Accounts" },
      { name: TALLY_LEDGERS.outputCgst, parent: "Duties & Taxes", taxType: "CGST" as const },
      { name: TALLY_LEDGERS.outputSgst, parent: "Duties & Taxes", taxType: "SGST" as const },
      { name: TALLY_LEDGERS.outputIgst, parent: "Duties & Taxes", taxType: "IGST" as const },
      { name: TALLY_LEDGERS.inputCgst, parent: "Duties & Taxes", taxType: "CGST" as const },
      { name: TALLY_LEDGERS.inputSgst, parent: "Duties & Taxes", taxType: "SGST" as const },
      { name: TALLY_LEDGERS.inputIgst, parent: "Duties & Taxes", taxType: "IGST" as const },
      { name: TALLY_LEDGERS.roundOff, parent: "Indirect Expenses" },
    ];
    for (const l of fixed) messages.push(tallyLedgerXml(l));
    const parties = await rows<{ name: string; kind: string; gstin: string | null; state: string | null; address: string | null; city: string | null; mobile: string | null; email: string | null; opening_balance: string }>(
      db,
      `SELECT name, kind, gstin, state, address, city, mobile, email, opening_balance FROM ims_parties WHERE tenant_id = :tenantId AND active = 1 ORDER BY name LIMIT 20000`,
      { tenantId },
    );
    const seen = new Set<string>(fixed.map((f) => f.name.toLowerCase()));
    for (const p of parties) {
      const key = p.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      messages.push(
        tallyLedgerXml({
          name: p.name.trim(),
          parent: p.kind === "supplier" ? TALLY_LEDGERS.creditors : TALLY_LEDGERS.debtors,
          gstin: p.gstin,
          state: p.state,
          address: [p.address, p.city].filter(Boolean).join(", ") || null,
          mobile: p.mobile,
          email: p.email,
          openingBalance: money(p.opening_balance),
        }),
      );
    }
    // Walk-in and one-off names on documents still need a ledger for their vouchers to import.
    const loose = await rows<{ name: string; side: string }>(
      db,
      `SELECT DISTINCT customer_name AS name, 'customer' AS side FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND customer_id IS NULL
       UNION SELECT DISTINCT supplier_name AS name, 'supplier' AS side FROM ims_bills WHERE tenant_id = :tenantId AND status <> 'cancelled' AND supplier_id IS NULL
       LIMIT 5000`,
      { tenantId },
    );
    for (const l of loose) {
      const key = l.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      messages.push(tallyLedgerXml({ name: l.name.trim(), parent: l.side === "supplier" ? TALLY_LEDGERS.creditors : TALLY_LEDGERS.debtors }));
    }
    counts.ledgers = seen.size;
  }
  if (include.stockItems) {
    const items = await rows<{ name: string; sku: string | null; unit: string; hsn: string | null; gst_rate: string; category: string | null }>(
      db,
      `SELECT name, sku, unit, hsn, gst_rate, category FROM ims_items WHERE tenant_id = :tenantId AND active = 1 ORDER BY name LIMIT 20000`,
      { tenantId },
    );
    const units = [...new Set(items.map((i) => i.unit || "pcs"))];
    const groups = [...new Set(items.map((i) => i.category?.trim()).filter((c): c is string => Boolean(c)))];
    for (const u of units) messages.push(tallyUnitXml(u));
    for (const g of groups) messages.push(tallyStockGroupXml(g));
    for (const i of items) messages.push(tallyStockItemXml({ name: i.name, sku: i.sku, unit: i.unit || "pcs", hsn: i.hsn, gstRate: money(i.gst_rate) || settings.defaultGstRate, category: i.category }));
    counts.units = units.length;
    counts.groups = groups.length;
    counts.stockItems = items.length;
  }
  return { messages, counts };
}

type VoucherSource = { from: string; to: string; since?: string | null };

async function buildSalesVouchers(db: Queryable, tenantId: number, range: VoucherSource): Promise<TallyVoucher[]> {
  const list = await rows<{
    id: string;
    invoice_no: string;
    invoice_date: string;
    customer_name: string;
    customer_gstin: string | null;
    place_of_supply: string | null;
    intra_state: number;
    lines: unknown;
    cgst: string;
    sgst: string;
    igst: string;
    round_off: string;
    notes: string | null;
    source_tool: string | null;
    source_ref: string | null;
  }>(
    db,
    `SELECT id, invoice_no, invoice_date, customer_name, customer_gstin, place_of_supply, intra_state, \`lines\`, cgst, sgst, igst, round_off, notes, source_tool, source_ref
     FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued' AND invoice_date BETWEEN :from AND :to ${range.since ? "AND updated_at >= :since" : ""}
     ORDER BY invoice_date, invoice_no LIMIT 5000`,
    { tenantId, from: range.from, to: range.to, since: range.since ?? null },
  );
  const names = await itemNames(db, tenantId);
  return list.map((inv) => voucherFrom("Sales", inv.invoice_no, isoOf(inv.invoice_date), inv.customer_name, inv.customer_gstin, inv.place_of_supply, Boolean(inv.intra_state), inv.lines, names, {
    cgst: money(inv.cgst),
    sgst: money(inv.sgst),
    igst: money(inv.igst),
    roundOff: money(inv.round_off),
    reference: inv.source_tool === "pos" ? inv.source_ref : null,
    narration: inv.notes,
  }));
}

async function itemNames(db: Queryable, tenantId: number): Promise<Map<string, { name: string; unit: string }>> {
  const list = await rows<{ id: string; name: string; unit: string }>(db, `SELECT id, name, unit FROM ims_items WHERE tenant_id = :tenantId LIMIT 20000`, { tenantId });
  return new Map(list.map((i) => [i.id, { name: i.name, unit: i.unit }]));
}

/** Lines are re-derived with computeTotals so the voucher always balances against the stored tax heads. */
function voucherFrom(
  kind: TallyVoucher["kind"],
  number: string,
  date: string,
  party: string,
  gstin: string | null,
  placeOfSupply: string | null,
  intraState: boolean,
  rawLines: unknown,
  names: Map<string, { name: string; unit: string }>,
  extra: { cgst: number; sgst: number; igst: number; roundOff: number; reference?: string | null; narration?: string | null; taxable?: number },
): TallyVoucher {
  const lines = json<ImsLineInput[]>(rawLines, []).filter((l) => l && typeof l === "object");
  const totals = computeTotals(lines, intraState);
  const vLines = totals.lines.map((l) => {
    const item = l.itemId ? names.get(l.itemId) : undefined;
    return { name: item?.name ?? l.name, unit: item?.unit ?? l.unit ?? "pcs", qty: l.qty, amount: l.taxable, stock: Boolean(item) };
  });
  const taxable = lines.length ? totals.taxable : round2(extra.taxable ?? 0);
  const total = round2(taxable + extra.cgst + extra.sgst + extra.igst + extra.roundOff);
  return { kind, number, date, partyName: party, partyGstin: gstin, placeOfSupply, reference: extra.reference ?? null, narration: extra.narration ?? null, lines: vLines, taxable, cgst: extra.cgst, sgst: extra.sgst, igst: extra.igst, roundOff: extra.roundOff, total };
}

async function buildPurchaseVouchers(db: Queryable, tenantId: number, settings: ImsSettings, range: VoucherSource): Promise<TallyVoucher[]> {
  const list = await rows<{
    bill_no: string;
    supplier_bill_no: string | null;
    bill_date: string;
    supplier_name: string;
    gstin: string | null;
    state: string | null;
    lines: unknown;
    subtotal: string;
    tax_total: string;
    grand_total: string;
    notes: string | null;
  }>(
    db,
    `SELECT b.bill_no, b.supplier_bill_no, b.bill_date, b.supplier_name, p.gstin, p.state, b.lines, b.subtotal, b.tax_total, b.grand_total, b.notes
     FROM ims_bills b LEFT JOIN ims_parties p ON p.tenant_id = b.tenant_id AND p.id = b.supplier_id
     WHERE b.tenant_id = :tenantId AND b.status <> 'cancelled' AND b.bill_date BETWEEN :from AND :to ${range.since ? "AND b.updated_at >= :since" : ""}
     ORDER BY b.bill_date, b.bill_no LIMIT 5000`,
    { tenantId, from: range.from, to: range.to, since: range.since ?? null },
  );
  const names = await itemNames(db, tenantId);
  return list.map((b) => {
    const intra = isIntraState(settings.state, b.state);
    const lines = json<ImsLineInput[]>(b.lines, []);
    const tax = lines.length ? computeTotals(lines, intra).taxTotal : money(b.tax_total);
    const cgst = intra ? round2(tax / 2) : 0;
    const sgst = intra ? round2(tax - cgst) : 0;
    const igst = intra ? 0 : round2(tax);
    const taxable = lines.length ? computeTotals(lines, intra).taxable : money(b.subtotal);
    const roundOff = round2(money(b.grand_total) - taxable - tax);
    return voucherFrom("Purchase", b.supplier_bill_no || b.bill_no, isoOf(b.bill_date), b.supplier_name, b.gstin, b.state, intra, b.lines, names, {
      cgst,
      sgst,
      igst,
      roundOff: Math.abs(roundOff) < 1 ? roundOff : 0,
      reference: b.bill_no,
      narration: b.notes,
      taxable: money(b.subtotal),
    });
  });
}

/* ---------- Talking to Tally ---------- */

const hostForUrl = (host: string) => (host.includes(":") && !host.startsWith("[") ? `[${host}]` : host);

function networkReason(err: unknown, cfg: { host: string; port: number }, timeoutMs: number): string {
  const e = err as { name?: string; code?: string; cause?: { code?: string; message?: string } };
  const code = e.cause?.code ?? e.code;
  if (e.name === "TimeoutError" || e.name === "AbortError") return `No answer from ${cfg.host}:${cfg.port} within ${Math.round(timeoutMs / 1000)} s`;
  if (code === "ECONNREFUSED") return `Connection refused at ${cfg.host}:${cfg.port} — is Tally open with the XML / ODBC server enabled on that port?`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `Host "${cfg.host}" could not be found`;
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return `${cfg.host} isn't reachable from the IMS server`;
  if (code === "ECONNRESET") return "Tally closed the connection";
  return e.cause?.message ?? (err instanceof Error ? err.message : "Network error");
}

async function postToTally(cfg: { host: string; port: number }, body: string, timeoutMs: number): Promise<{ ok: true; status: number; text: string; ms: number } | { ok: false; reason: string; ms: number }> {
  const started = Date.now();
  try {
    const res = await fetch(`http://${hostForUrl(cfg.host)}:${cfg.port}`, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    const text = (await res.text()).slice(0, 200_000);
    return { ok: true, status: res.status, text, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, reason: networkReason(err, cfg, timeoutMs), ms: Date.now() - started };
  }
}

function summarizeImport(r: TallyImportResult): { status: SyncStatus; message: string } {
  const bad = r.errors + r.exceptions;
  const parts = [`${r.created} created`, `${r.altered} altered`];
  if (r.ignored) parts.push(`${r.ignored} ignored`);
  if (bad) parts.push(`${bad} rejected`);
  const msg = `${parts.join(", ")}${r.lineErrors.length ? ` — ${r.lineErrors.slice(0, 2).join("; ")}` : ""}`;
  return { status: bad ? (r.created + r.altered ? "partial" : "failed") : "success", message: msg };
}

/* ---------- POS ingest ---------- */

const PosSaleInput = z.object({
  billNo: z.string().trim().min(1, "Bill number is required").max(40),
  date: isoDate.optional(),
  paymentMode: z.enum(POS_PAY_MODES).default("cash"),
  customerName: z.string().trim().max(200).optional(),
  customerMobile: z.string().trim().max(40).optional(),
  ratesIncludeTax: z.boolean().optional(),
  items: z
    .array(
      z
        .object({
          sku: z.string().trim().max(64).optional(),
          barcode: z.string().trim().max(64).optional(),
          qty: z.coerce.number().positive("Quantity must be more than zero").max(1e6),
          rate: z.coerce.number().min(0).max(1e9).optional(),
        })
        .refine((l) => Boolean(l.sku || l.barcode), "Each line needs a SKU or barcode"),
    )
    .min(1, "Add at least one item")
    .max(200),
});
type PosSaleInputT = z.infer<typeof PosSaleInput>;

type PosLine = { itemId?: string; code?: string; qty: number; rate?: number };

type PosResult = { invoiceId: string; invoiceNo: string; grandTotal: number; lines: number; units: number; paid: boolean };

async function ingestPosSale(
  deps: ImsDeps,
  actor: ImsActor,
  settings: ImsSettings,
  input: { billNo: string; date: string; paymentMode: (typeof POS_PAY_MODES)[number]; customerName: string; customerMobile: string | null; ratesIncludeTax: boolean; lines: PosLine[] },
): Promise<PosResult> {
  return tx(deps.db, async (conn) => {
    const dup = await one<{ id: string; invoice_no: string }>(conn, `SELECT id, invoice_no FROM ims_invoices WHERE tenant_id = :tenantId AND source_tool = 'pos' AND source_ref = :ref LIMIT 1 FOR UPDATE`, {
      tenantId: actor.tenantId,
      ref: input.billNo,
    });
    if (dup) throw conflict(`POS bill ${input.billNo} was already synced as ${dup.invoice_no}`);
    const closed = await one<{ status: string }>(conn, `SELECT status FROM ims_daily_closings WHERE tenant_id = :tenantId AND closing_date = :date LIMIT 1`, { tenantId: actor.tenantId, date: input.date }).catch(() => null);
    if (closed?.status === "closed") throw conflict(`${input.date} is already closed in Daily Closing — reopen the day to sync this bill`);

    type ItemRow = { id: string; name: string; sku: string | null; barcode: string | null; hsn: string | null; unit: string; gst_rate: string; selling_price: string; mrp: string | null };
    const resolved: Array<{ item: ItemRow; qty: number; rate: number }> = [];
    const unknown: string[] = [];
    for (const l of input.lines) {
      const item = l.itemId
        ? await one<ItemRow>(conn, `SELECT id, name, sku, barcode, hsn, unit, gst_rate, selling_price, mrp FROM ims_items WHERE tenant_id = :tenantId AND id = :id AND active = 1`, { tenantId: actor.tenantId, id: l.itemId })
        : await one<ItemRow>(conn, `SELECT id, name, sku, barcode, hsn, unit, gst_rate, selling_price, mrp FROM ims_items WHERE tenant_id = :tenantId AND active = 1 AND (sku = :code OR barcode = :code) LIMIT 1`, {
            tenantId: actor.tenantId,
            code: l.code,
          });
      if (!item) {
        unknown.push(l.code ?? l.itemId ?? "?");
        continue;
      }
      const priced = l.rate ?? (money(item.mrp) || money(item.selling_price));
      resolved.push({ item, qty: l.qty, rate: posExclusiveRate(priced, money(item.gst_rate), input.ratesIncludeTax) });
    }
    if (unknown.length) throw badRequest(`Unknown SKU / barcode: ${unknown.slice(0, 10).join(", ")}`, unknown.map((c) => `No active IMS item has SKU or barcode "${c}"`));

    const lines: ImsLineInput[] = resolved.map((r) => ({ itemId: r.item.id, name: r.item.name, sku: r.item.sku, hsn: r.item.hsn, unit: r.item.unit, qty: r.qty, rate: r.rate, discountPct: 0, gstRate: money(r.item.gst_rate) }));
    const totals = computeTotals(lines, true, true);
    const invoiceId = randomUUID();
    const invoiceNo = `POS-${input.billNo}`.slice(0, 48);
    const clash = await one<{ id: string }>(conn, `SELECT id FROM ims_invoices WHERE tenant_id = :tenantId AND invoice_no = :no LIMIT 1`, { tenantId: actor.tenantId, no: invoiceNo });
    if (clash) throw conflict(`Invoice number ${invoiceNo} is already used`);

    for (const l of totals.lines) {
      await postMovement(
        conn,
        actor,
        {
          itemId: l.itemId!,
          type: "OUT",
          qty: l.qty,
          unitPrice: l.qty ? round2(l.taxable / l.qty) : l.rate,
          refType: "pos",
          refId: invoiceId,
          refNo: invoiceNo,
          partyName: input.customerName,
          notes: `POS bill ${input.billNo}`,
          date: input.date,
        },
        { allowNegative: settings.allowNegativeStock },
      );
    }
    const paid = input.paymentMode !== "credit";
    await insertImsInvoice(conn, actor, {
      id: invoiceId,
      status: "issued",
      invoiceNo,
      customerId: null,
      customerName: input.customerName,
      customerGstin: null,
      customerAddress: null,
      customerMobile: input.customerMobile,
      placeOfSupply: settings.state,
      intraState: true,
      invoiceDate: input.date,
      dueDate: paid ? input.date : addDaysISO(input.date, settings.paymentTermsDays),
      totals,
      amountPaid: paid ? totals.grandTotal : 0,
      payMode: paid ? input.paymentMode : null,
      stockPosted: true,
      sourceTool: "pos",
      sourceRef: input.billNo,
      notes: `Synced from POS bill ${input.billNo}`,
      terms: null,
    });
    if (paid && totals.grandTotal > 0) {
      await exec(
        conn,
        `INSERT INTO ims_payments (id, tenant_id, direction, party_id, party_name, doc_type, doc_id, doc_no, amount, method, reference, paid_on, notes, created_by, created_by_name)
         VALUES (:id, :tenantId, 'in', NULL, :partyName, 'invoice', :docId, :docNo, :amount, :method, :reference, :paidOn, :notes, :userId, :userName)`,
        {
          id: randomUUID(),
          tenantId: actor.tenantId,
          partyName: input.customerName,
          docId: invoiceId,
          docNo: invoiceNo,
          amount: totals.grandTotal,
          method: input.paymentMode,
          reference: input.billNo,
          paidOn: input.date,
          notes: "POS sale",
          userId: actor.userId,
          userName: actorName(actor),
        },
      );
    }
    return { invoiceId, invoiceNo, grandTotal: totals.grandTotal, lines: totals.lines.length, units: round3(totals.lines.reduce((s, l) => s + l.qty, 0)), paid };
  });
}

async function runPosSale(deps: ImsDeps, actor: ImsActor, input: Parameters<typeof ingestPosSale>[3], ip?: string): Promise<PosResult> {
  const settings = await getSettings(deps, actor.tenantId);
  try {
    const out = await ingestPosSale(deps, actor, settings, input);
    await logSync(deps.db, actor, { provider: "pos", direction: "import", entity: "sale", status: "success", records: out.lines, message: `Bill ${input.billNo} → ${out.invoiceNo} · ₹${out.grandTotal.toLocaleString("en-IN")} · ${out.units} units` });
    await touchIntegration(deps.db, actor.tenantId, "pos", "success");
    await recordEvent(deps, actor, {
      type: "pos.sale",
      entityType: "invoice",
      entityId: out.invoiceId,
      summary: `POS sale ${input.billNo} synced as ${out.invoiceNo} (₹${out.grandTotal.toLocaleString("en-IN")})`,
      payload: { billNo: input.billNo, lines: out.lines },
      ip,
    });
    return out;
  } catch (err) {
    await logSync(deps.db, actor, { provider: "pos", direction: "import", entity: "sale", status: "failed", records: 0, message: `Bill ${input.billNo}: ${err instanceof Error ? err.message : "failed"}` });
    await touchIntegration(deps.db, actor.tenantId, "pos", "failed").catch(() => undefined);
    throw err;
  }
}

/* ---------- Routes ---------- */

const TestInput = TallyConfig.pick({ host: true, port: true, company: true }).partial();
const ExportType = z.enum(["masters", "sales", "purchases", "all"]);

export function registerIntegrations(router: Router, deps: ImsDeps): void {
  router.get("/integrations", async (_req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["integrations", "audit"]);
    const [tally, pos, log, counts] = await Promise.all([
      loadIntegration(deps.db, actor.tenantId, "tally"),
      loadIntegration(deps.db, actor.tenantId, "pos"),
      syncLog(deps.db, actor.tenantId, null, 60),
      one<{ parties: number; items: number; invoices: number; bills: number; pos_today: number }>(
        deps.db,
        `SELECT
           (SELECT COUNT(*) FROM ims_parties WHERE tenant_id = :tenantId AND active = 1) AS parties,
           (SELECT COUNT(*) FROM ims_items WHERE tenant_id = :tenantId AND active = 1) AS items,
           (SELECT COUNT(*) FROM ims_invoices WHERE tenant_id = :tenantId AND status = 'issued') AS invoices,
           (SELECT COUNT(*) FROM ims_bills WHERE tenant_id = :tenantId AND status <> 'cancelled') AS bills,
           (SELECT COUNT(*) FROM ims_invoices WHERE tenant_id = :tenantId AND source_tool = 'pos' AND invoice_date = :today) AS pos_today`,
        { tenantId: actor.tenantId, today: todayISO() },
      ),
    ]);
    res.json({
      tally: tallyView(tally),
      pos: posView(pos),
      log,
      counts: { parties: Number(counts?.parties ?? 0), items: Number(counts?.items ?? 0), invoices: Number(counts?.invoices ?? 0), bills: Number(counts?.bills ?? 0), posToday: Number(counts?.pos_today ?? 0) },
      posProviders: POS_PROVIDERS,
    });
  });

  router.get("/integrations/log", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["integrations", "audit"]);
    const provider = qstr(req.query.provider, 16);
    res.json({ log: await syncLog(deps.db, actor.tenantId, provider === "tally" || provider === "pos" ? provider : null, qint(req.query.limit, 100, 1, 500)) });
  });

  router.put("/integrations/tally", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "integrations");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const config = parse(TallyConfig, body);
    const existing = await loadIntegration(deps.db, actor.tenantId, "tally");
    await saveIntegration(deps.db, actor, "tally", { config, enabled: body.enabled === false ? false : true, sync: existing?.sync ? undefined : DEFAULT_TALLY_SYNC });
    await recordEvent(deps, actor, { type: "integration.tally.saved", entityType: "integration", entityId: "tally", summary: `Connected Tally company “${config.company}” at ${config.host}:${config.port}`, ip: req.ip });
    res.json({ tally: tallyView(await loadIntegration(deps.db, actor.tenantId, "tally")) });
  });

  router.put("/integrations/tally/sync", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "integrations");
    const sync = parse(TallySync, req.body);
    await saveIntegration(deps.db, actor, "tally", { sync });
    await recordEvent(deps, actor, { type: "integration.tally.sync", entityType: "integration", entityId: "tally", summary: `Updated Tally sync setup (${sync.frequency})`, payload: sync, ip: req.ip });
    res.json({ tally: tallyView(await loadIntegration(deps.db, actor.tenantId, "tally")) });
  });

  router.post("/integrations/tally/disconnect", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "integrations");
    await saveIntegration(deps.db, actor, "tally", { enabled: false });
    await recordEvent(deps, actor, { type: "integration.tally.disconnected", entityType: "integration", entityId: "tally", summary: "Disconnected Tally", ip: req.ip });
    res.json({ tally: tallyView(await loadIntegration(deps.db, actor.tenantId, "tally")) });
  });

  /** Real reachability check: POSTs a tiny "list of companies" request to Tally's XML server with a 4 s timeout. */
  router.post("/integrations/tally/test", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "integrations");
    const override = parse(TestInput, req.body);
    const saved = tallyView(await loadIntegration(deps.db, actor.tenantId, "tally")).config;
    const host = override.host ?? saved?.host;
    const port = override.port ?? saved?.port ?? 9000;
    const company = override.company ?? saved?.company ?? "";
    if (!host) throw badRequest("Enter the Tally host first");
    const timeout = 4000;
    const r = await postToTally({ host, port }, tallyPingEnvelope(), timeout);
    if (!r.ok) {
      await logSync(deps.db, actor, { provider: "tally", direction: "export", entity: "connection", status: "failed", records: 0, message: r.reason });
      if (saved) await touchIntegration(deps.db, actor.tenantId, "tally", "failed");
      res.json({ reachable: false, latencyMs: r.ms, message: r.reason, companies: [], companyFound: null });
      return;
    }
    const companies = parseTallyCompanies(r.text);
    const looksLikeTally = /<ENVELOPE|<RESPONSE|TALLY/i.test(r.text);
    const companyFound = companies.length && company ? companies.some((c) => c.toLowerCase() === company.toLowerCase()) : null;
    const message = !looksLikeTally
      ? `${host}:${port} answered (HTTP ${r.status}) but it doesn't look like Tally's XML server`
      : companyFound === false
        ? `Tally is reachable, but “${company}” isn't open. Open companies: ${companies.slice(0, 5).join(", ")}`
        : `Tally answered in ${r.ms} ms${companies.length ? ` · ${companies.length} compan${companies.length === 1 ? "y" : "ies"} open` : ""}`;
    const status: SyncStatus = looksLikeTally && companyFound !== false ? "success" : "partial";
    await logSync(deps.db, actor, { provider: "tally", direction: "export", entity: "connection", status, records: 0, message });
    if (saved) await touchIntegration(deps.db, actor.tenantId, "tally", status);
    res.json({ reachable: true, latencyMs: r.ms, message, companies, companyFound, httpStatus: r.status });
  });

  /** Push masters and vouchers straight into Tally over its XML server, logging each batch. */
  router.post("/integrations/tally/sync-now", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "integrations");
    const view = tallyView(await loadIntegration(deps.db, actor.tenantId, "tally"));
    if (!view.enabled || !view.config) throw badRequest("Connect Tally first (host, port and company)");
    const cfg = view.config;
    const settings = await getSettings(deps, actor.tenantId);
    const today = todayISO();
    const fy = periodRange("fytd", today, settings.fiscalYearStart);
    const since = view.lastSyncAt && view.lastStatus === "success" ? view.lastSyncAt : null;
    const steps: Array<{ entity: string; status: SyncStatus; records: number; message: string }> = [];
    const push = async (entity: string, report: "All Masters" | "Vouchers", messages: string[], records: number) => {
      if (!messages.length) {
        steps.push({ entity, status: "success", records: 0, message: "Nothing new to send" });
        return true;
      }
      const r = await postToTally(cfg, tallyEnvelope(cfg.company, report, messages), 30_000);
      if (!r.ok) {
        steps.push({ entity, status: "failed", records: 0, message: r.reason });
        await logSync(deps.db, actor, { provider: "tally", direction: "export", entity, status: "failed", records: 0, message: r.reason });
        return false;
      }
      const sum = summarizeImport(parseTallyResponse(r.text));
      steps.push({ entity, status: sum.status, records, message: sum.message });
      await logSync(deps.db, actor, { provider: "tally", direction: "export", entity, status: sum.status, records, message: sum.message });
      return true;
    };
    let reachable = true;
    if (view.sync.ledgers || view.sync.stockItems) {
      const m = await buildMasters(deps.db, actor.tenantId, settings, { ledgers: view.sync.ledgers, stockItems: view.sync.stockItems });
      reachable = await push("masters", "All Masters", m.messages, m.counts.ledgers + m.counts.stockItems);
    }
    if (reachable && view.sync.salesVouchers) {
      const v = await buildSalesVouchers(deps.db, actor.tenantId, { ...fy, since });
      reachable = await push("sales", "Vouchers", v.map(tallyVoucherXml), v.length);
    }
    if (reachable && view.sync.purchaseVouchers) {
      const v = await buildPurchaseVouchers(deps.db, actor.tenantId, settings, { ...fy, since });
      await push("purchases", "Vouchers", v.map(tallyVoucherXml), v.length);
    }
    const overall: SyncStatus = steps.every((s) => s.status === "success") ? "success" : steps.some((s) => s.status !== "failed") ? "partial" : "failed";
    await touchIntegration(deps.db, actor.tenantId, "tally", overall);
    await recordEvent(deps, actor, {
      type: "integration.tally.sync",
      entityType: "integration",
      entityId: "tally",
      summary: `Tally sync ${overall}: ${steps.map((s) => `${s.entity} ${s.records}`).join(", ") || "nothing to send"}`,
      payload: { steps },
      ip: req.ip,
    });
    res.json({ status: overall, steps, tally: tallyView(await loadIntegration(deps.db, actor.tenantId, "tally")) });
  });

  /** Always-works fallback: a Tally import file the user loads via Gateway of Tally → Import Data. */
  router.get("/integrations/tally/export", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["integrations", "audit"]);
    const typeParsed = ExportType.safeParse(qstr(req.query.type, 16) || "sales");
    if (!typeParsed.success) throw badRequest("type must be masters, sales, purchases or all");
    const type = typeParsed.data;
    const settings = await getSettings(deps, actor.tenantId);
    const today = todayISO();
    const fromQ = qstr(req.query.from, 10);
    const toQ = qstr(req.query.to, 10);
    const range = isISODate(fromQ) && isISODate(toQ) && fromQ <= toQ ? { from: fromQ, to: toQ } : periodRange(qstr(req.query.period) || "fytd", today, settings.fiscalYearStart);
    const company = tallyView(await loadIntegration(deps.db, actor.tenantId, "tally")).config?.company ?? settings.businessName ?? "";
    const parts: string[] = [];
    let records = 0;
    let report: "All Masters" | "Vouchers" = "Vouchers";
    if (type === "masters" || type === "all") {
      const m = await buildMasters(deps.db, actor.tenantId, settings, { ledgers: true, stockItems: true });
      parts.push(...m.messages);
      records += m.counts.ledgers + m.counts.stockItems;
      if (type === "masters") report = "All Masters";
    }
    if (type === "sales" || type === "all") {
      const v = await buildSalesVouchers(deps.db, actor.tenantId, range);
      parts.push(...v.map(tallyVoucherXml));
      records += v.length;
    }
    if (type === "purchases" || type === "all") {
      const v = await buildPurchaseVouchers(deps.db, actor.tenantId, settings, range);
      parts.push(...v.map(tallyVoucherXml));
      records += v.length;
    }
    const xml = tallyEnvelope(company, report, parts);
    await logSync(deps.db, actor, {
      provider: "tally",
      direction: "export",
      entity: `xml-${type}`,
      status: "success",
      records,
      message: type === "masters" ? "Masters XML downloaded" : `XML downloaded for ${range.from} to ${range.to}`,
    });
    const name = `Tally_${type === "all" ? "Masters_and_Vouchers" : type[0].toUpperCase() + type.slice(1)}_${type === "masters" ? today : `${range.from}_to_${range.to}`}.xml`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("X-Record-Count", String(records));
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, X-Record-Count");
    res.send(xml);
  });

  /* POS */

  router.put("/integrations/pos", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "integrations");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const input = parse(PosConfig, body);
    const existing = posConfigOf(await loadIntegration(deps.db, actor.tenantId, "pos"));
    const apiKey = input.apiKey ? input.apiKey : (existing?.apiKey ?? null);
    await saveIntegration(deps.db, actor, "pos", { config: { ...input, apiKey }, enabled: body.enabled === false ? false : true });
    await recordEvent(deps, actor, { type: "integration.pos.saved", entityType: "integration", entityId: "pos", summary: `Connected POS (${input.provider}${input.storeId ? ` · store ${input.storeId}` : ""})`, ip: req.ip });
    res.json({ pos: posView(await loadIntegration(deps.db, actor.tenantId, "pos")) });
  });

  router.post("/integrations/pos/disconnect", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "integrations");
    await saveIntegration(deps.db, actor, "pos", { enabled: false });
    await recordEvent(deps, actor, { type: "integration.pos.disconnected", entityType: "integration", entityId: "pos", summary: "Disconnected POS", ip: req.ip });
    res.json({ pos: posView(await loadIntegration(deps.db, actor.tenantId, "pos")) });
  });

  /** POS → IMS: one bill becomes OUT movements plus a paid (or credit) invoice. Idempotent per bill number. */
  router.post("/integrations/pos/sale", async (req, res) => {
    const actor = actorOf(res);
    requireAnyPerm(res, ["integrations", "sales"]);
    const input: PosSaleInputT = parse(PosSaleInput, req.body);
    const cfg = posConfigOf(await loadIntegration(deps.db, actor.tenantId, "pos"));
    const out = await runPosSale(
      deps,
      actor,
      {
        billNo: input.billNo,
        date: input.date ?? todayISO(),
        paymentMode: input.paymentMode,
        customerName: input.customerName || cfg?.customerName || "Walk-in customer",
        customerMobile: input.customerMobile || null,
        ratesIncludeTax: input.ratesIncludeTax ?? cfg?.ratesIncludeTax ?? true,
        lines: input.items.map((l) => ({ code: (l.sku || l.barcode)!, qty: l.qty, rate: l.rate })),
      },
      req.ip,
    );
    res.status(201).json({ sale: out });
  });

  /** Demo / smoke test: a random 1–3 item bill from in-stock items, through the same ingest path. */
  router.post("/integrations/pos/simulate", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "integrations");
    const row = await loadIntegration(deps.db, actor.tenantId, "pos");
    const view = posView(row);
    if (!view.enabled) throw badRequest("Connect a POS first, then simulate a sale");
    const cfg = posConfigOf(row);
    const candidates = await rows<{ id: string; current_stock: string }>(
      deps.db,
      `SELECT id, current_stock FROM ims_items WHERE tenant_id = :tenantId AND active = 1 AND current_stock >= 1 AND (selling_price > 0 OR mrp > 0) ORDER BY RAND() LIMIT 3`,
      { tenantId: actor.tenantId },
    );
    if (!candidates.length) throw new ImsError(409, "No items with stock and a selling price to sell — receive some stock first");
    const n = 1 + Math.floor(Math.random() * candidates.length);
    const billNo = `SIM-${Date.now().toString(36).toUpperCase()}`;
    const out = await runPosSale(
      deps,
      actor,
      {
        billNo,
        date: todayISO(),
        paymentMode: (["cash", "upi", "card"] as const)[Math.floor(Math.random() * 3)],
        customerName: cfg?.customerName || "Walk-in customer",
        customerMobile: null,
        ratesIncludeTax: cfg?.ratesIncludeTax ?? true,
        lines: candidates.slice(0, n).map((c) => ({ itemId: c.id, qty: Math.max(1, Math.min(3, Math.floor(money(c.current_stock) / 2) || 1)) })),
      },
      req.ip,
    );
    res.status(201).json({ sale: out, billNo });
  });
}

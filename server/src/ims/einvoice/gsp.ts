import { createHash } from "node:crypto";
import type { ImsLine } from "../logic.js";
import type { ImsSettings } from "../settings.js";

/**
 * Pluggable GSP adapter for IRP e-Invoice. `sandbox` fabricates a realistic IRN / Ack / QR with no HTTP;
 * `live` talks to a ClearTax-shaped REST API. Pure of any DB access so it can be unit-tested.
 */

export type GspMode = "sandbox" | "live";

export type GspConfig = {
  mode: GspMode;
  baseUrl?: string | null;
  apiKey?: string | null;
  gstin?: string | null;
  autoPushOnIssue?: boolean;
};

export const GSP_PATHS = {
  generate: "/einv/v2/Invoice",
  cancel: "/einv/v2/Invoice/Cancel",
} as const;

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const HTTP_TIMEOUT_MS = 30_000;
const PING_TIMEOUT_MS = 5_000;

export const isGstin = (v: string | null | undefined): boolean => GSTIN_RE.test(String(v ?? "").trim().toUpperCase());

export class GspError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
    readonly status = 502,
  ) {
    super(message);
    this.name = "GspError";
  }
}

export type IrnInvoiceInput = {
  invoiceNo: string;
  docKind: string;
  /** YYYY-MM-DD */
  invoiceDate: string;
  customerName: string;
  customerGstin: string | null;
  customerAddress: string | null;
  placeOfSupply: string | null;
  intraState: boolean;
  lines: ReadonlyArray<Pick<ImsLine, "name" | "hsn" | "unit" | "qty" | "rate" | "gstRate" | "gross" | "discount" | "taxable" | "tax">>;
  subtotal: number;
  discountTotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  shippingCharges?: number;
  roundOff: number;
  grandTotal: number;
  againstInvoiceNo?: string | null;
  /** YYYY-MM-DD */
  againstInvoiceDate?: string | null;
};

export type IrnSeller = Pick<ImsSettings, "businessName" | "gstin" | "state" | "stateCode" | "address" | "phone" | "email">;

export type IrnPayload = {
  Version: "1.1";
  TranDtls: { TaxSch: "GST"; SupTyp: "B2B"; RegRev: "N"; IgstOnIntra: "N" };
  DocDtls: { Typ: "INV" | "CRN" | "DBN"; No: string; Dt: string };
  SellerDtls: { Gstin: string; LglNm: string; Addr1: string; Loc: string; Pin?: number; Stcd: string; Ph?: string; Em?: string };
  BuyerDtls: { Gstin: string; LglNm: string; Pos: string; Addr1: string; Loc: string; Pin?: number; Stcd: string };
  PrecDocDtls?: Array<{ InvNo: string; InvDt?: string }>;
  ItemList: Array<{
    SlNo: string;
    PrdDesc: string;
    IsServc: "Y" | "N";
    HsnCd: string;
    Qty: number;
    Unit: string;
    UnitPrice: number;
    TotAmt: number;
    Discount: number;
    AssAmt: number;
    GstRt: number;
    IgstAmt: number;
    CgstAmt: number;
    SgstAmt: number;
    TotItemVal: number;
  }>;
  ValDtls: { AssVal: number; CgstVal: number; SgstVal: number; IgstVal: number; Discount: number; OthChrg: number; RndOffAmt: number; TotInvVal: number };
};

export type IrnResult = {
  irn: string;
  ackNo: string;
  /** ISO-8601 UTC */
  ackAt: string;
  signedQr: string;
  mode: GspMode;
};

export type IrnCancelResult = { irn: string; cancelledAt: string; mode: GspMode };

type Fetch = typeof fetch;
type CallOpts = { now?: Date; fetchImpl?: Fetch };

const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const DOC_TYP: Record<string, IrnPayload["DocDtls"]["Typ"]> = { tax_invoice: "INV", credit_note: "CRN", debit_note: "DBN" };

const UQC: Record<string, string> = {
  pcs: "PCS", piece: "PCS", pieces: "PCS", nos: "NOS", no: "NOS", unit: "UNT", units: "UNT",
  kg: "KGS", kgs: "KGS", g: "GMS", gm: "GMS", gms: "GMS", ltr: "LTR", l: "LTR", litre: "LTR", liter: "LTR", ml: "MLT",
  m: "MTR", mtr: "MTR", meter: "MTR", metre: "MTR", cm: "CMS", box: "BOX", bag: "BAG", set: "SET", pair: "PRS", dozen: "DOZ", doz: "DOZ",
  hr: "OTH", hour: "OTH", hours: "OTH", day: "OTH", days: "OTH", month: "OTH", job: "OTH", service: "OTH",
};

export const uqcOf = (unit: string | null | undefined): string => UQC[String(unit ?? "").trim().toLowerCase()] ?? "OTH";

/** `YYYY-MM-DD` → `DD/MM/YYYY` (IRP date format). */
export const irpDate = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

/** Indian financial year label (`2026-27`) for an ISO date. */
export function fiscalYearOf(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const pinOf = (address: string | null | undefined): number | undefined => {
  const m = String(address ?? "").match(/\b([1-9]\d{5})\b/);
  return m ? Number(m[1]) : undefined;
};

const stateCodeOf = (gstin: string | null | undefined, fallback?: string | null): string => {
  const code = String(gstin ?? "").slice(0, 2);
  if (/^\d{2}$/.test(code)) return code;
  const fb = String(fallback ?? "").trim();
  return /^\d{1,2}$/.test(fb) ? fb.padStart(2, "0") : "";
};

const clip = (s: string | null | undefined, max: number) => String(s ?? "").trim().slice(0, max);

/** NIC e-Invoice schema 1.1 JSON for one issued B2B invoice / credit note / debit note. */
export function buildIrnPayload(invoice: IrnInvoiceInput, seller: IrnSeller, opts: { gstin?: string | null } = {}): IrnPayload {
  const sellerGstin = (opts.gstin || seller.gstin || "").trim().toUpperCase();
  const buyerGstin = (invoice.customerGstin ?? "").trim().toUpperCase();
  const buyerState = stateCodeOf(buyerGstin);
  const pos = stateCodeOf(null, invoice.placeOfSupply) || buyerState;
  const items = invoice.lines.map((l, i) => {
    const tax = r2(l.tax);
    const cgst = invoice.intraState ? r2(tax / 2) : 0;
    const sgst = invoice.intraState ? r2(tax - cgst) : 0;
    const igst = invoice.intraState ? 0 : tax;
    const hsn = clip(l.hsn, 8);
    return {
      SlNo: String(i + 1),
      PrdDesc: clip(l.name, 300),
      IsServc: (hsn.startsWith("99") ? "Y" : "N") as "Y" | "N",
      HsnCd: hsn,
      Qty: l.qty,
      Unit: uqcOf(l.unit),
      UnitPrice: r2(l.rate),
      TotAmt: r2(l.gross),
      Discount: r2(l.discount),
      AssAmt: r2(l.taxable),
      GstRt: l.gstRate,
      IgstAmt: igst,
      CgstAmt: cgst,
      SgstAmt: sgst,
      TotItemVal: r2(l.taxable + tax),
    };
  });
  const payload: IrnPayload = {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: DOC_TYP[invoice.docKind] ?? "INV", No: clip(invoice.invoiceNo, 16), Dt: irpDate(invoice.invoiceDate) },
    SellerDtls: {
      Gstin: sellerGstin,
      LglNm: clip(seller.businessName, 100),
      Addr1: clip(seller.address, 100),
      Loc: clip(seller.state, 50),
      Pin: pinOf(seller.address),
      Stcd: stateCodeOf(sellerGstin, seller.stateCode),
      ...(seller.phone ? { Ph: clip(seller.phone, 12) } : {}),
      ...(seller.email ? { Em: clip(seller.email, 100) } : {}),
    },
    BuyerDtls: {
      Gstin: buyerGstin,
      LglNm: clip(invoice.customerName, 100),
      Pos: pos,
      Addr1: clip(invoice.customerAddress, 100),
      Loc: clip(invoice.placeOfSupply, 50),
      Pin: pinOf(invoice.customerAddress),
      Stcd: buyerState,
    },
    ItemList: items,
    ValDtls: {
      AssVal: r2(invoice.subtotal - invoice.discountTotal),
      CgstVal: r2(invoice.cgst),
      SgstVal: r2(invoice.sgst),
      IgstVal: r2(invoice.igst),
      Discount: 0,
      OthChrg: r2(invoice.shippingCharges ?? 0),
      RndOffAmt: r2(invoice.roundOff),
      TotInvVal: r2(invoice.grandTotal),
    },
  };
  if (payload.DocDtls.Typ !== "INV" && invoice.againstInvoiceNo) {
    payload.PrecDocDtls = [{ InvNo: clip(invoice.againstInvoiceNo, 16), ...(invoice.againstInvoiceDate ? { InvDt: irpDate(invoice.againstInvoiceDate) } : {}) }];
  }
  return payload;
}

/** Problems the IRP would reject outright. Empty array = good to send. */
export function validateIrnPayload(p: IrnPayload, mode: GspMode): string[] {
  const out: string[] = [];
  if (!isGstin(p.SellerDtls.Gstin)) out.push(p.SellerDtls.Gstin ? `Seller GSTIN “${p.SellerDtls.Gstin}” is not valid` : "Seller GSTIN is missing — set it in Settings or Integrations → GSP");
  if (!isGstin(p.BuyerDtls.Gstin)) out.push(`Customer GSTIN “${p.BuyerDtls.Gstin}” is not valid`);
  if (!p.ItemList.length) out.push("The invoice has no line items");
  if (mode === "live") {
    p.ItemList.forEach((it) => {
      if (!/^\d{4,8}$/.test(it.HsnCd)) out.push(`Line ${it.SlNo} (${it.PrdDesc}) needs a 4–8 digit HSN / SAC code`);
    });
  }
  return out;
}

/** The IRN is SHA-256 of `seller GSTIN + doc type + doc no + financial year` — same recipe as the real IRP. */
export function sandboxIrn(sellerGstin: string, docTyp: string, docNo: string, fy: string): string {
  return createHash("sha256").update(`${sellerGstin}${docTyp}${docNo}${fy}`).digest("hex");
}

/** 15-digit acknowledgement number derived from the IRN (stable per document). */
export function sandboxAckNo(irn: string): string {
  const n = parseInt(irn.slice(0, 10), 16);
  return `11${String(n).padStart(13, "0").slice(-13)}`;
}

function sandboxQr(p: IrnPayload, irn: string, ackNo: string, ackAt: Date): string {
  const body = {
    sandbox: true,
    SellerGstin: p.SellerDtls.Gstin,
    BuyerGstin: p.BuyerDtls.Gstin,
    DocNo: p.DocDtls.No,
    DocTyp: p.DocDtls.Typ,
    DocDt: p.DocDtls.Dt,
    TotInvVal: p.ValDtls.TotInvVal,
    ItemCnt: p.ItemList.length,
    MainHsnCode: p.ItemList[0]?.HsnCd ?? "",
    Irn: irn,
    AckNo: ackNo,
    IrnDt: ackAt.toISOString(),
  };
  return `data:application/json;base64,${Buffer.from(JSON.stringify(body)).toString("base64")}`;
}

/** Problems with a config that would stop `live` mode from working. */
export function validateGspConfig(c: GspConfig): string[] {
  if (c.mode !== "live") return [];
  const out: string[] = [];
  const base = String(c.baseUrl ?? "").trim();
  if (!base) out.push("Enter the GSP base URL");
  else if (!liveBase(base)) out.push("Base URL must be https:// (http:// is only allowed for localhost)");
  if (!String(c.apiKey ?? "").trim()) out.push("Enter the GSP API key");
  if (c.gstin && !isGstin(c.gstin)) out.push(`GSTIN “${c.gstin}” is not valid`);
  return out;
}

function liveBase(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function requireLive(c: GspConfig): { base: string; apiKey: string } {
  const problems = validateGspConfig(c);
  if (problems.length) throw new GspError(`GSP live mode isn't set up: ${problems[0]}`, problems, 409);
  return { base: liveBase(c.baseUrl!)!, apiKey: c.apiKey!.trim() };
}

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
};

/** Human-readable errors from the many shapes GSPs / IRP return. */
export function extractGspErrors(body: unknown): string[] {
  const o = asObj(body);
  const out: string[] = [];
  const details = pick(o, "ErrorDetails", "errorDetails", "errors", "Errors", "error_details");
  if (Array.isArray(details)) {
    for (const d of details) {
      if (typeof d === "string") out.push(d);
      else {
        const e = asObj(d);
        const code = pick(e, "ErrorCode", "error_code", "code");
        const msg = pick(e, "ErrorMessage", "error_message", "message", "msg");
        if (msg) out.push(code ? `${code}: ${msg}` : String(msg));
      }
    }
  } else if (typeof details === "string") out.push(details);
  const top = pick(o, "ErrorMessage", "error_message", "message", "Message", "error", "Error");
  if (typeof top === "string" && !out.includes(top)) out.push(top);
  return out;
}

const dateIn = (v: unknown, fallback: Date): string => {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  const t = m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:30`) : Date.parse(s);
  return new Date(Number.isNaN(t) ? fallback.getTime() : t).toISOString();
};

/** Unwraps `{ Data: {...} }` / `{ result: {...} }` wrappers (and JSON-in-a-string) down to the IRP fields. */
function unwrap(body: unknown): Record<string, unknown> {
  let o = asObj(body);
  for (let i = 0; i < 3; i++) {
    const inner = pick(o, "Data", "data", "result", "Result", "response");
    if (typeof inner === "string") {
      try {
        o = { ...o, ...asObj(JSON.parse(inner)) };
        continue;
      } catch {
        break;
      }
    }
    if (inner && typeof inner === "object" && !Array.isArray(inner)) o = { ...o, ...asObj(inner) };
    else break;
  }
  return o;
}

export function parseIrpResponse(body: unknown, now = new Date()): Omit<IrnResult, "mode"> {
  const d = unwrap(body);
  const irn = String(pick(d, "Irn", "irn", "IRN") ?? "").trim();
  if (!irn) {
    const errs = extractGspErrors(body);
    throw new GspError(errs[0] ? `GSP rejected the invoice: ${errs[0]}` : "GSP response did not include an IRN", errs);
  }
  return {
    irn,
    ackNo: String(pick(d, "AckNo", "ackNo", "ack_no") ?? ""),
    ackAt: dateIn(pick(d, "AckDt", "ackDt", "ack_dt", "AckDate"), now),
    signedQr: String(pick(d, "SignedQRCode", "SignedQrCode", "signedQRCode", "signedQr", "signed_qr_code") ?? ""),
  };
}

async function callGsp(c: GspConfig, path: string, body: unknown, f: Fetch): Promise<unknown> {
  const { base, apiKey } = requireLive(c);
  const url = `${base}${path}`;
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await f(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(c.gstin ? { gstin: c.gstin } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      redirect: "manual",
    });
  } catch (err) {
    const e = err as { name?: string; cause?: { code?: string } };
    const reason = e.name === "TimeoutError" || e.name === "AbortError" ? `no answer within ${HTTP_TIMEOUT_MS / 1000} s` : (e.cause?.code ?? (err instanceof Error ? err.message : "network error"));
    throw new GspError(`Could not reach the GSP at ${host}: ${reason}`);
  }
  const text = (await res.text()).slice(0, 500_000);
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body handled below */
  }
  if (res.status === 401 || res.status === 403) throw new GspError(`GSP refused the API key (HTTP ${res.status}) — check the key in Integrations → GSP`, extractGspErrors(parsed), res.status);
  if (res.status >= 300) {
    const errs = extractGspErrors(parsed);
    throw new GspError(`GSP error (HTTP ${res.status})${errs[0] ? `: ${errs[0]}` : text ? `: ${text.slice(0, 160)}` : ""}`, errs);
  }
  if (parsed === null) throw new GspError(`GSP at ${host} answered with something that isn't JSON`);
  return parsed;
}

/** Register the invoice with the IRP and return the IRN, acknowledgement and signed QR. */
export async function pushIrn(config: GspConfig, payload: IrnPayload, opts: CallOpts = {}): Promise<IrnResult> {
  const problems = validateIrnPayload(payload, config.mode);
  if (problems.length) throw new GspError(`Invoice isn't ready for e-Invoice: ${problems[0]}`, problems, 422);
  const now = opts.now ?? new Date();
  if (config.mode !== "live") {
    const irn = sandboxIrn(payload.SellerDtls.Gstin, payload.DocDtls.Typ, payload.DocDtls.No, fiscalYearOf(isoOfIrpDate(payload.DocDtls.Dt)));
    const ackNo = sandboxAckNo(irn);
    return { irn, ackNo, ackAt: now.toISOString(), signedQr: sandboxQr(payload, irn, ackNo, now), mode: "sandbox" };
  }
  const body = await callGsp(config, GSP_PATHS.generate, payload, opts.fetchImpl ?? fetch);
  return { ...parseIrpResponse(body, now), mode: "live" };
}

/** Cancel a registered IRN (IRP allows this within 24 h of generation). */
export async function cancelIrn(config: GspConfig, irn: string, reason: string, opts: CallOpts = {}): Promise<IrnCancelResult> {
  const now = opts.now ?? new Date();
  if (config.mode !== "live") return { irn, cancelledAt: now.toISOString(), mode: "sandbox" };
  const body = await callGsp(config, GSP_PATHS.cancel, { Irn: irn, CnlRsn: "2", CnlRem: clip(reason, 100) || "Cancelled in IMS" }, opts.fetchImpl ?? fetch);
  const d = unwrap(body);
  const errs = extractGspErrors(body);
  const status = pick(d, "Status", "status");
  const failed = status === 0 || status === "0" || String(status).toUpperCase() === "FAILURE" || status === false;
  if (failed || (!pick(d, "Irn", "irn", "CancelDate", "cancelDate") && errs.length)) {
    throw new GspError(errs[0] ? `GSP could not cancel the IRN: ${errs[0]}` : "GSP could not cancel the IRN", errs);
  }
  return { irn, cancelledAt: dateIn(pick(d, "CancelDate", "cancelDate", "CancelDt"), now), mode: "live" };
}

/** Light connectivity check: sandbox is always fine; live validates the config then reaches the base URL. */
export async function pingGsp(config: GspConfig, opts: { fetchImpl?: Fetch } = {}): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  if (config.mode !== "live") return { ok: true, message: "Sandbox mode — invoices get a simulated IRN, no network call is made", latencyMs: 0 };
  const problems = validateGspConfig(config);
  if (problems.length) return { ok: false, message: problems[0], latencyMs: 0 };
  const base = liveBase(config.baseUrl!)!;
  const started = Date.now();
  try {
    const res = await (opts.fetchImpl ?? fetch)(base, { method: "GET", headers: { Authorization: `Bearer ${config.apiKey!.trim()}` }, signal: AbortSignal.timeout(PING_TIMEOUT_MS), redirect: "manual" });
    const ms = Date.now() - started;
    if (res.status >= 500) return { ok: false, message: `GSP answered HTTP ${res.status}`, latencyMs: ms };
    return { ok: true, message: `GSP reachable at ${new URL(base).host} in ${ms} ms (HTTP ${res.status}). The API key is checked on the first push.`, latencyMs: ms };
  } catch (err) {
    const e = err as { name?: string; cause?: { code?: string } };
    const reason = e.name === "TimeoutError" || e.name === "AbortError" ? `no answer within ${PING_TIMEOUT_MS / 1000} s` : (e.cause?.code ?? (err instanceof Error ? err.message : "network error"));
    return { ok: false, message: `Could not reach ${new URL(base).host}: ${reason}`, latencyMs: Date.now() - started };
  }
}

/** `DD/MM/YYYY` → `YYYY-MM-DD`. */
function isoOfIrpDate(dt: string): string {
  const [d, m, y] = dt.split("/");
  return `${y}-${m}-${d}`;
}

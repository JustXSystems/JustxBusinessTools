import { describe, expect, it } from "vitest";
import { GspError, buildIrnPayload, cancelIrn, fiscalYearOf, parseIrpResponse, pingGsp, pushIrn, sandboxAckNo, sandboxIrn, validateGspConfig, type IrnInvoiceInput, type IrnSeller } from "./gsp.js";

const seller: IrnSeller = { businessName: "Acme Traders", gstin: "29ABCDE1234F1Z5", state: "Karnataka", stateCode: "29", address: "12 MG Road, Bengaluru 560001", phone: "9800000000", email: "a@acme.test" };

const invoice = (over: Partial<IrnInvoiceInput> = {}): IrnInvoiceInput => ({
  invoiceNo: "INV/26-27/0001",
  docKind: "tax_invoice",
  invoiceDate: "2026-11-22",
  customerName: "Buyer Pvt Ltd",
  customerGstin: "27AAPFU0939F1ZV",
  customerAddress: "Plot 4, Pune 411001",
  placeOfSupply: "Maharashtra",
  intraState: false,
  lines: [{ name: "Widget", hsn: "8481", unit: "pcs", qty: 10, rate: 100, gstRate: 18, gross: 1000, discount: 0, taxable: 1000, tax: 180 }],
  subtotal: 1000,
  discountTotal: 0,
  cgst: 0,
  sgst: 0,
  igst: 180,
  roundOff: 0,
  grandTotal: 1180,
  ...over,
});

const sandbox = { mode: "sandbox" as const };

describe("buildIrnPayload", () => {
  it("maps an inter-state invoice to IGST", () => {
    const p = buildIrnPayload(invoice(), seller);
    expect(p.DocDtls).toEqual({ Typ: "INV", No: "INV/26-27/0001", Dt: "22/11/2026" });
    expect(p.SellerDtls).toMatchObject({ Gstin: "29ABCDE1234F1Z5", Stcd: "29", Pin: 560001 });
    expect(p.BuyerDtls).toMatchObject({ Gstin: "27AAPFU0939F1ZV", Stcd: "27", Pin: 411001 });
    expect(p.ItemList[0]).toMatchObject({ Unit: "PCS", IgstAmt: 180, CgstAmt: 0, SgstAmt: 0, TotItemVal: 1180 });
    expect(p.ValDtls).toMatchObject({ AssVal: 1000, IgstVal: 180, TotInvVal: 1180 });
  });

  it("splits intra-state tax into CGST + SGST and links credit notes to the original", () => {
    const p = buildIrnPayload(invoice({ docKind: "credit_note", intraState: true, cgst: 90, sgst: 90, igst: 0, againstInvoiceNo: "INV/26-27/0001", againstInvoiceDate: "2026-11-01" }), seller);
    expect(p.DocDtls.Typ).toBe("CRN");
    expect(p.ItemList[0]).toMatchObject({ CgstAmt: 90, SgstAmt: 90, IgstAmt: 0 });
    expect(p.PrecDocDtls).toEqual([{ InvNo: "INV/26-27/0001", InvDt: "01/11/2026" }]);
  });

  it("prefers the GSP-configured GSTIN over the business one", () => {
    expect(buildIrnPayload(invoice(), seller, { gstin: "07AAACG1234H1Z2" }).SellerDtls.Gstin).toBe("07AAACG1234H1Z2");
  });
});

describe("sandbox IRN", () => {
  it("is 64 hex chars, deterministic, and varies with the document", () => {
    const a = sandboxIrn("29ABCDE1234F1Z5", "INV", "INV/1", "2026-27");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(sandboxIrn("29ABCDE1234F1Z5", "INV", "INV/1", "2026-27")).toBe(a);
    expect(sandboxIrn("29ABCDE1234F1Z5", "INV", "INV/2", "2026-27")).not.toBe(a);
    expect(sandboxAckNo(a)).toMatch(/^\d{15}$/);
  });

  it("derives the Indian financial year", () => {
    expect(fiscalYearOf("2026-03-31")).toBe("2025-26");
    expect(fiscalYearOf("2026-04-01")).toBe("2026-27");
    expect(fiscalYearOf("2099-12-01")).toBe("2099-00");
  });
});

describe("pushIrn", () => {
  const now = new Date("2026-11-22T08:30:00.000Z");

  it("sandbox returns IRN, ack and a QR data URL without any HTTP", async () => {
    const payload = buildIrnPayload(invoice(), seller);
    const res = await pushIrn(sandbox, payload, { now, fetchImpl: (() => Promise.reject(new Error("no http expected"))) as typeof fetch });
    expect(res.mode).toBe("sandbox");
    expect(res.irn.length).toBeGreaterThanOrEqual(8);
    expect(res.irn).toBe(sandboxIrn("29ABCDE1234F1Z5", "INV", "INV/26-27/0001", "2026-27"));
    expect(res.ackNo).toMatch(/^\d{15}$/);
    expect(res.ackAt).toBe(now.toISOString());
    expect(res.signedQr.startsWith("data:application/json;base64,")).toBe(true);
    const qr = JSON.parse(Buffer.from(res.signedQr.split(",")[1], "base64").toString());
    expect(qr).toMatchObject({ Irn: res.irn, DocNo: "INV/26-27/0001", TotInvVal: 1180 });
  });

  it("refuses an invoice with a bad buyer GSTIN", async () => {
    const payload = buildIrnPayload(invoice({ customerGstin: "NOPE" }), seller);
    await expect(pushIrn(sandbox, payload)).rejects.toBeInstanceOf(GspError);
  });

  it("refuses when no seller GSTIN is available", async () => {
    const payload = buildIrnPayload(invoice(), { ...seller, gstin: null });
    await expect(pushIrn(sandbox, payload)).rejects.toThrow(/Seller GSTIN is missing/);
  });

  it("live POSTs with the API key and parses the IRP response", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ Status: 1, Data: { Irn: "a".repeat(64), AckNo: 112310012345678, AckDt: "2026-11-22 14:00:00", SignedQRCode: "eyJhbGciOi" } }), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await pushIrn({ mode: "live", baseUrl: "https://gsp.example.com/", apiKey: "secret-key" }, buildIrnPayload(invoice(), seller), { fetchImpl });
    expect(seen!.url).toBe("https://gsp.example.com/einv/v2/Invoice");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    expect(res).toMatchObject({ irn: "a".repeat(64), ackNo: "112310012345678", ackAt: "2026-11-22T08:30:00.000Z", signedQr: "eyJhbGciOi", mode: "live" });
  });

  it("live surfaces GSP error details", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ Status: 0, ErrorDetails: [{ ErrorCode: "2150", ErrorMessage: "Duplicate IRN" }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(pushIrn({ mode: "live", baseUrl: "https://gsp.example.com", apiKey: "k" }, buildIrnPayload(invoice(), seller), { fetchImpl })).rejects.toThrow(/2150: Duplicate IRN/);
  });

  it("live reports a rejected key clearly", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    await expect(pushIrn({ mode: "live", baseUrl: "https://gsp.example.com", apiKey: "bad" }, buildIrnPayload(invoice(), seller), { fetchImpl })).rejects.toThrow(/refused the API key/);
  });

  it("live without a key fails before any request", async () => {
    await expect(pushIrn({ mode: "live", baseUrl: "https://gsp.example.com" }, buildIrnPayload(invoice(), seller))).rejects.toThrow(/API key/);
  });
});

describe("cancelIrn / pingGsp / config", () => {
  it("sandbox cancel succeeds locally", async () => {
    const out = await cancelIrn(sandbox, "a".repeat(64), "Wrong customer", { now: new Date("2026-11-22T00:00:00Z") });
    expect(out).toEqual({ irn: "a".repeat(64), cancelledAt: "2026-11-22T00:00:00.000Z", mode: "sandbox" });
  });

  it("live cancel posts the IRN and reason", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ Irn: "x".repeat(64), CancelDate: "2026-11-22 15:00:00" }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await cancelIrn({ mode: "live", baseUrl: "https://gsp.example.com", apiKey: "k" }, "x".repeat(64), "Data entry mistake", { fetchImpl });
    expect(body).toMatchObject({ Irn: "x".repeat(64), CnlRem: "Data entry mistake" });
    expect(out.cancelledAt).toBe("2026-11-22T09:30:00.000Z");
  });

  it("ping: sandbox ok, live validates config first", async () => {
    expect((await pingGsp(sandbox)).ok).toBe(true);
    const bad = await pingGsp({ mode: "live", baseUrl: "http://gsp.example.com", apiKey: "k" });
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/https/);
  });

  it("validates live config", () => {
    expect(validateGspConfig(sandbox)).toEqual([]);
    expect(validateGspConfig({ mode: "live" }).length).toBe(2);
    expect(validateGspConfig({ mode: "live", baseUrl: "http://localhost:4000", apiKey: "k" })).toEqual([]);
  });

  it("parses wrapped / camelCase responses", () => {
    const r = parseIrpResponse({ data: { irn: "b".repeat(64), ackNo: "99", ackDt: "2026-01-01 00:00:00" } });
    expect(r).toMatchObject({ irn: "b".repeat(64), ackNo: "99", ackAt: "2025-12-31T18:30:00.000Z" });
  });
});

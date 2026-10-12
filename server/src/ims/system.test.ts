import { describe, expect, it } from "vitest";
import {
  TALLY_LEDGERS,
  appendThread,
  auditHealth,
  autoMatchBank,
  editsAfterApproval,
  exciseBottles,
  exciseBulkLitres,
  exciseClosing,
  findDuplicateGroups,
  invoiceGstIssues,
  isTallyHost,
  mobileKey,
  normalizeBankRows,
  parseBankAmount,
  parseBankDate,
  parseTallyCompanies,
  parseTallyResponse,
  posExclusiveRate,
  scoreBankMatch,
  stockLedgerGap,
  suggestBankMatches,
  tallyCashLedger,
  tallyCashVoucherXml,
  tallyDate,
  tallyEnvelope,
  tallyLedgerXml,
  tallyStockItemXml,
  tallyVoucherBalance,
  tallyVoucherXml,
  xmlEscape,
  type AuditInvoice,
  type BankCandidate,
  type BankTxnInput,
  type TallyVoucher,
} from "./logic.js";

describe("Tally XML", () => {
  const sale: TallyVoucher = {
    kind: "Sales",
    number: "INV-0001",
    date: "2026-04-05",
    partyName: "Acme & Sons",
    partyGstin: "27abcde1234f1z5",
    placeOfSupply: "Maharashtra",
    lines: [
      { name: "Widget <XL>", unit: "pcs", qty: 2, amount: 1000, stock: true },
      { name: "Freight", unit: "", qty: 0, amount: 100, stock: false },
    ],
    taxable: 1100,
    cgst: 99,
    sgst: 99,
    igst: 0,
    roundOff: 0,
    total: 1298,
  };

  it("escapes XML and formats dates", () => {
    expect(xmlEscape(`A&B <"x">'`)).toBe("A&amp;B &lt;&quot;x&quot;&gt;&apos;");
    expect(xmlEscape("bad\u0001char")).toBe("badchar");
    expect(tallyDate("2026-04-05")).toBe("20260405");
  });

  it("builds a balanced sales voucher with party debit and inventory credit", () => {
    expect(tallyVoucherBalance(sale)).toBe(0);
    const xml = tallyVoucherXml(sale);
    expect(xml).toContain('VCHTYPE="Sales"');
    expect(xml).toContain("<PARTYLEDGERNAME>Acme &amp; Sons</PARTYLEDGERNAME>");
    expect(xml).toContain("<PARTYGSTIN>27ABCDE1234F1Z5</PARTYGSTIN>");
    expect(xml).toContain("<LEDGERNAME>Acme &amp; Sons</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-1298.00</AMOUNT>");
    expect(xml).toContain(`<LEDGERNAME>${TALLY_LEDGERS.sales}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>100.00</AMOUNT>`);
    expect(xml).toContain(`<LEDGERNAME>${TALLY_LEDGERS.outputCgst}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>99.00</AMOUNT>`);
    expect(xml).toContain("<STOCKITEMNAME>Widget &lt;XL&gt;</STOCKITEMNAME>");
    expect(xml).toContain("<RATE>500.00/pcs</RATE>");
    expect(xml).toContain("Invoice Voucher View");
    expect(xml).not.toContain(TALLY_LEDGERS.outputIgst);
  });

  it("flips signs for purchases and flags an unbalanced voucher", () => {
    const purchase: TallyVoucher = { ...sale, kind: "Purchase", lines: [], taxable: 1000, cgst: 0, sgst: 0, igst: 180, total: 1180 };
    const xml = tallyVoucherXml(purchase);
    expect(xml).toContain("<ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>1180.00</AMOUNT>");
    expect(xml).toContain(`<LEDGERNAME>${TALLY_LEDGERS.purchase}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-1000.00</AMOUNT>`);
    expect(xml).toContain(`<LEDGERNAME>${TALLY_LEDGERS.inputIgst}</LEDGERNAME>`);
    expect(xml).toContain("Accounting Voucher View");
    expect(tallyVoucherBalance({ ...purchase, total: 1190 })).toBe(-10);
  });

  it("reverses a sale as a Credit Note and a purchase as a Debit Note", () => {
    const credit = tallyVoucherXml({ ...sale, kind: "Credit Note", number: "RET-0001" });
    expect(credit).toContain('VCHTYPE="Credit Note"');
    expect(credit).toContain("<VOUCHERTYPENAME>Credit Note</VOUCHERTYPENAME>");
    expect(credit).toContain("<LEDGERNAME>Acme &amp; Sons</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>1298.00</AMOUNT>");
    expect(credit).toContain(`<LEDGERNAME>${TALLY_LEDGERS.sales}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-100.00</AMOUNT>`);
    expect(credit).toContain(`<LEDGERNAME>${TALLY_LEDGERS.outputCgst}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-99.00</AMOUNT>`);
    expect(credit).toContain("<STOCKITEMNAME>Widget &lt;XL&gt;</STOCKITEMNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>");

    const debit = tallyVoucherXml({ ...sale, kind: "Debit Note", lines: [], taxable: 1000, cgst: 0, sgst: 0, igst: 180, total: 1180 });
    expect(debit).toContain('VCHTYPE="Debit Note"');
    expect(debit).toContain("<ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-1180.00</AMOUNT>");
    expect(debit).toContain(`<LEDGERNAME>${TALLY_LEDGERS.purchase}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>1000.00</AMOUNT>`);
    expect(debit).toContain(`<LEDGERNAME>${TALLY_LEDGERS.inputIgst}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>180.00</AMOUNT>`);
  });

  it("builds receipts and payments against cash or bank", () => {
    const receipt = tallyCashVoucherXml({ kind: "Receipt", number: "R-1A2B3C4D", date: "2026-04-05", partyName: "Acme", amount: 500, method: "upi", reference: "UTR123", narration: "Against INV-0001" });
    expect(receipt).toContain('VCHTYPE="Receipt"');
    expect(receipt).toContain("<LEDGERNAME>Acme</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>500.00</AMOUNT>");
    expect(receipt).toContain(`<LEDGERNAME>${TALLY_LEDGERS.bank}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-500.00</AMOUNT>`);
    expect(receipt).toContain("<REFERENCE>UTR123</REFERENCE>");

    const payment = tallyCashVoucherXml({ kind: "Payment", number: "P-1", date: "2026-04-05", partyName: "Supplier Co", amount: -250, method: "cash" });
    expect(payment).toContain("<ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-250.00</AMOUNT>");
    expect(payment).toContain(`<LEDGERNAME>${TALLY_LEDGERS.cash}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>250.00</AMOUNT>`);
    expect(payment).not.toContain("<REFERENCE>");
    expect(tallyCashLedger("cheque")).toBe(TALLY_LEDGERS.bank);
  });

  it("builds masters and the import envelope", () => {
    const ledger = tallyLedgerXml({ name: "Acme", parent: TALLY_LEDGERS.debtors, gstin: "27abcde1234f1z5", state: "Maharashtra", openingBalance: 500 });
    expect(ledger).toContain("<PARENT>Sundry Debtors</PARENT>");
    expect(ledger).toContain("<ISBILLWISEON>Yes</ISBILLWISEON>");
    expect(ledger).toContain("<PARTYGSTIN>27ABCDE1234F1Z5</PARTYGSTIN>");
    const item = tallyStockItemXml({ name: "Widget", unit: "pcs", hsn: "8471", gstRate: 18, sku: "W-1", category: "Hardware" });
    expect(item).toContain("<HSNCODE>8471</HSNCODE>");
    expect(item).toContain("<GSTRATEDUTYHEAD>Central Tax</GSTRATEDUTYHEAD><GSTRATE>9</GSTRATE>");
    expect(item).toContain("<GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD><GSTRATE>18</GSTRATE>");
    const env = tallyEnvelope("My Co & Partners", "Vouchers", ["<A/>", "<B/>"]);
    expect(env.startsWith('<?xml version="1.0"')).toBe(true);
    expect(env).toContain("<REPORTNAME>Vouchers</REPORTNAME>");
    expect(env).toContain("<SVCURRENTCOMPANY>My Co &amp; Partners</SVCURRENTCOMPANY>");
    expect(env).toContain("<A/>\n<B/>");
  });

  it("parses Tally responses and company lists", () => {
    const res = parseTallyResponse("<RESPONSE><CREATED>3</CREATED><ALTERED>1</ALTERED><ERRORS>1</ERRORS><LINEERROR>Ledger 'X' does not exist!</LINEERROR></RESPONSE>");
    expect(res).toMatchObject({ created: 3, altered: 1, errors: 1, exceptions: 0, ignored: 0 });
    expect(res.lineErrors).toEqual(["Ledger 'X' does not exist!"]);
    expect(parseTallyCompanies('<ENVELOPE><COMPANY NAME="Alpha Traders"></COMPANY><COMPANY><NAME>Beta Ltd</NAME></COMPANY></ENVELOPE>')).toEqual(["Alpha Traders", "Beta Ltd"]);
  });

  it("accepts only bare hosts", () => {
    expect(isTallyHost("localhost")).toBe(true);
    expect(isTallyHost("192.168.1.20")).toBe(true);
    expect(isTallyHost("tally.example.in")).toBe(true);
    expect(isTallyHost("::1")).toBe(true);
    expect(isTallyHost("http://localhost")).toBe(false);
    expect(isTallyHost("user@host")).toBe(false);
    expect(isTallyHost("host/path")).toBe(false);
    expect(isTallyHost("")).toBe(false);
  });
});

describe("POS and excise helpers", () => {
  it("strips tax from inclusive POS prices", () => {
    expect(posExclusiveRate(118, 18, true)).toBe(100);
    expect(posExclusiveRate(118, 18, false)).toBe(118);
    expect(posExclusiveRate(-5, 18, true)).toBe(0);
  });

  it("computes bottles, closing balance and bulk litres", () => {
    expect(exciseBottles(10, 12, 3)).toBe(123);
    expect(exciseBottles(-1, 12, 0)).toBe(0);
    expect(exciseClosing(50, 120, 30)).toBe(140);
    expect(exciseBulkLitres(12, 750)).toBe(9);
    expect(exciseBulkLitres(12, null)).toBe(0);
  });
});

describe("bank statement parsing", () => {
  it("reads common date and amount formats", () => {
    expect(parseBankDate("01/04/26")).toBe("2026-04-01");
    expect(parseBankDate("05-Apr-2026")).toBe("2026-04-05");
    expect(parseBankDate("2026-04-07 10:00")).toBe("2026-04-07");
    expect(parseBankDate(46113)).toBe("2026-04-01");
    expect(parseBankDate("31/02/2026")).toBeNull();
    expect(parseBankDate("")).toBeNull();
    expect(parseBankAmount("1,23,456.50")).toBe(123456.5);
    expect(parseBankAmount("(500)")).toBe(-500);
    expect(parseBankAmount("500 Dr")).toBe(-500);
    expect(parseBankAmount("₹ 750")).toBe(750);
    expect(parseBankAmount("")).toBe(0);
  });

  it("normalizes withdrawal / deposit statements", () => {
    const out = normalizeBankRows([
      { Date: "01/04/26", Narration: "NEFT-ACME TRADERS", "Chq./Ref.No.": "UTR123", "Withdrawal Amt.": "", "Deposit Amt.": "5,000.00", "Closing Balance": "10000" },
      { Date: "02/04/26", Narration: "RENT APRIL", "Chq./Ref.No.": "0", "Withdrawal Amt.": "1,200.50", "Deposit Amt.": "", "Closing Balance": "8799.50" },
      { Date: "", Narration: "", "Chq./Ref.No.": "", "Withdrawal Amt.": "", "Deposit Amt.": "", "Closing Balance": "" },
    ]);
    expect(out.errors).toEqual([]);
    expect(out.skipped).toBe(1);
    expect(out.txns).toEqual([
      { date: "2026-04-01", description: "NEFT-ACME TRADERS", amount: 5000, direction: "in", reference: "UTR123" },
      { date: "2026-04-02", description: "RENT APRIL", amount: 1200.5, direction: "out", reference: null },
    ]);
  });

  it("normalizes amount + Dr/Cr statements and reports missing columns", () => {
    const out = normalizeBankRows([{ "Txn Date": "2026-04-03", Description: "UPI", Amount: "250", "Dr/Cr": "DR" }]);
    expect(out.txns[0]).toMatchObject({ amount: 250, direction: "out" });
    expect(normalizeBankRows([{ Foo: "1" }]).errors.length).toBe(2);
  });
});

describe("bank matching", () => {
  const txn: BankTxnInput & { id: string } = { id: "t1", date: "2026-04-01", description: "NEFT-ACME TRADERS", amount: 5000, direction: "in", reference: "UTR123" };
  const cand: BankCandidate = { id: "p1", type: "payment", direction: "in", amount: 5000, date: "2026-04-02", label: "Receipt from Acme Traders", reference: "UTR123", partyName: "Acme Traders" };

  it("scores amount, date, reference and party", () => {
    const s = scoreBankMatch(txn, cand);
    expect(s?.score).toBe(100);
    expect(s?.reasons).toEqual(expect.arrayContaining(["Amount matches", "1 day apart", "Reference matches", "Party name in narration"]));
    expect(scoreBankMatch(txn, { ...cand, direction: "out" })).toBeNull();
    expect(scoreBankMatch(txn, { ...cand, amount: 5010 })).toBeNull();
    expect(scoreBankMatch(txn, { ...cand, date: "2026-04-20" })).toBeNull();
    expect(scoreBankMatch(txn, { ...cand, reference: null, partyName: null, date: "2026-04-01" })?.score).toBe(80);
  });

  it("suggests best first and auto-matches one-to-one, skipping ties", () => {
    const weaker: BankCandidate = { ...cand, id: "p2", reference: null, partyName: "Other", date: "2026-04-05" };
    expect(suggestBankMatches(txn, [weaker, cand]).map((s) => s.candidate.id)).toEqual(["p1", "p2"]);
    const t2 = { ...txn, id: "t2" };
    const matches = autoMatchBank([txn, t2], [cand]);
    expect(matches).toEqual([{ txnId: "t1", candidateId: "p1", type: "payment", score: 100 }]);
    const twin: BankCandidate = { ...cand, id: "p3" };
    expect(autoMatchBank([txn], [cand, twin])).toEqual([]);
  });
});

describe("audit rules", () => {
  const inv: AuditInvoice = {
    id: "i1",
    invoiceNo: "INV-1",
    date: "2026-04-10",
    customerName: "Buyer",
    customerGstin: null,
    partyGstin: null,
    intraState: true,
    lines: [{ name: "Widget", qty: 1, rate: 1000, gstRate: 18, hsn: "8471" }],
    taxTotal: 180,
    cgst: 90,
    sgst: 90,
    igst: 0,
    grandTotal: 1180,
  };

  it("passes a correct invoice and catches GST problems", () => {
    expect(invoiceGstIssues(inv)).toEqual([]);
    const keys = (i: AuditInvoice) => invoiceGstIssues(i).map((x) => x.key.split(":")[0]);
    expect(keys({ ...inv, taxTotal: 120 })).toContain("gst-tax");
    expect(keys({ ...inv, cgst: 0, sgst: 0, igst: 180 })).toContain("gst-head");
    expect(keys({ ...inv, intraState: false })).toContain("gst-head");
    expect(keys({ ...inv, customerGstin: "BADGSTIN" })).toContain("gst-gstin");
    expect(keys({ ...inv, partyGstin: "27ABCDE1234F1Z5" })).toContain("gst-b2b");
    expect(keys({ ...inv, intraState: false, cgst: 0, sgst: 0, igst: 180, grandTotal: 150000, lines: [] })).toEqual(["gst-b2cl"]);
    expect(keys({ ...inv, lines: [{ name: "Widget", qty: 1, rate: 1000, gstRate: 18 }] })).toEqual(["gst-hsn"]);
  });

  it("groups duplicates by party, amount and date", () => {
    const groups = findDuplicateGroups([
      { id: "a", partyKey: "Acme ", amount: 100, date: "2026-04-01" },
      { id: "b", partyKey: "acme", amount: 100.001, date: "2026-04-01" },
      { id: "c", partyKey: "acme", amount: 100, date: "2026-04-02" },
      { id: "d", partyKey: "zero", amount: 0, date: "2026-04-01" },
      { id: "e", partyKey: "zero", amount: 0, date: "2026-04-01" },
    ]);
    expect(groups.map((g) => g.map((x) => x.id))).toEqual([["a", "b"]]);
  });

  it("measures stock ledger gaps and post-approval edits", () => {
    expect(stockLedgerGap(10, 10)).toBe(0);
    expect(stockLedgerGap(10, 7.5)).toBe(2.5);
    const events = [
      { type: "bill.updated", at: "2026-04-01T09:00:00Z" },
      { type: "bill.approved", at: "2026-04-01T10:00:00Z" },
      { type: "bill.updated", at: "2026-04-02T10:00:00Z" },
      { type: "bill.paid", at: "2026-04-03T10:00:00Z" },
    ];
    expect(editsAfterApproval("2026-04-01T10:00:00Z", events)).toEqual([events[2]]);
    expect(editsAfterApproval(null, events)).toEqual([]);
  });

  it("scores books health with diminishing penalties", () => {
    expect(auditHealth([])).toEqual({ score: 100, grade: "A", bySeverity: { low: 0, medium: 0, high: 0, critical: 0 } });
    const one = auditHealth([{ severity: "high" }]);
    expect(one.score).toBe(76);
    expect(one.grade).toBe("B");
    const many = auditHealth(Array.from({ length: 50 }, () => ({ severity: "critical" as const })));
    expect(many.score).toBe(0);
    expect(many.grade).toBe("E");
  });
});

describe("threads and keys", () => {
  it("appends entries, drops junk and caps length", () => {
    const e = (id: string) => ({ id, authorId: 1, author: "A", role: null, at: "2026-04-01T00:00:00Z", text: id });
    expect(appendThread([{ bogus: true }, e("1")], e("2")).map((t) => t.id)).toEqual(["1", "2"]);
    expect(appendThread(null, e("x"))).toHaveLength(1);
    expect(appendThread([e("1"), e("2"), e("3")], e("4"), 2).map((t) => t.id)).toEqual(["3", "4"]);
  });

  it("normalizes mobile numbers", () => {
    expect(mobileKey("+91 98765-43210")).toBe("9876543210");
    expect(mobileKey("12345")).toBeNull();
  });
});

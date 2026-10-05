import { describe, expect, it } from "vitest";
import { detectDateOrder, findHeaderRow, guessMapping, mappingReady, parseCsv, parseStatementAmount, parseStatementDate, toStatementLines } from "./statement";

const read = (csv: string) => {
  const rows = parseCsv(csv);
  const header = findHeaderRow(rows);
  return { rows, header, mapping: guessMapping(rows[header] ?? []), ...toStatementLines(rows, header, guessMapping(rows[header] ?? [])) };
};

describe("parseCsv", () => {
  it("handles quotes, embedded commas and newlines, CRLF and a BOM", () => {
    expect(parseCsv('\uFEFFa,"b, c","say ""hi"""\r\n1,"two\nlines",3\r\n\r\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "two\nlines", "3"],
    ]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(parseCsv("a;b;c\n1;2;3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("parseStatementDate", () => {
  it.each([
    ["01/10/2026", "2026-10-01"],
    ["1-10-26", "2026-10-01"],
    ["01.10.2026", "2026-10-01"],
    ["2026-10-01", "2026-10-01"],
    ["01-Oct-2026", "2026-10-01"],
    ["1 Sept 2026", "2026-09-01"],
    ["05-June-26", "2026-06-05"],
    ["Oct 1, 2026", "2026-10-01"],
    ["01/10/2026 14:05:00", "2026-10-01"],
  ])("reads %s", (raw, expected) => {
    expect(parseStatementDate(raw)).toBe(expected);
  });

  it("rejects impossible or non-dates", () => {
    expect(parseStatementDate("31/02/2026")).toBeNull();
    expect(parseStatementDate("Opening Balance")).toBeNull();
    expect(parseStatementDate("")).toBeNull();
  });

  it("reads month-first only when the file proves it", () => {
    expect(detectDateOrder(["01/10/2026", "13/10/2026"])).toBe("dmy");
    expect(detectDateOrder(["10/01/2026", "10/25/2026"])).toBe("mdy");
    expect(detectDateOrder(["01/02/2026"])).toBe("dmy");
    expect(parseStatementDate("10/25/2026", "mdy")).toBe("2026-10-25");
  });
});

describe("parseStatementAmount", () => {
  it.each([
    ["₹1,18,000.00", 118000],
    ["(250.00)", -250],
    ["1,234.50 Cr", 1234.5],
    ["1,234.50 Dr", -1234.5],
    ["-15", -15],
    ["INR 99.9", 99.9],
  ])("reads %s", (raw, expected) => {
    expect(parseStatementAmount(raw)).toBe(expected);
  });

  it("treats blanks and dashes as no amount", () => {
    expect(parseStatementAmount("")).toBeNull();
    expect(parseStatementAmount(" - ")).toBeNull();
    expect(parseStatementAmount("abc")).toBeNull();
  });
});

describe("toStatementLines", () => {
  it("reads an HDFC export with a preamble, footer and newest-first order", () => {
    const csv = [
      "HDFC BANK Ltd.,,,,,,",
      "Account No : XXXXXX4821,,,,,,",
      "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
      "02/10/26,UPI-OFFICE WORKS,0000412345,02/10/26,18400.00,,599600.00",
      '01/10/26,"NEFT CR-MERIDIAN SOLAR, EPC",N123,01/10/26,,"1,18,000.00","6,18,000.00"',
      "********,,,,,,",
      "STATEMENT SUMMARY :-,,,,,,",
    ].join("\n");
    const r = read(csv);
    expect(r.header).toBe(2);
    expect(mappingReady(r.mapping)).toBe(true);
    expect(r.reversed).toBe(true);
    expect(r.skipped).toBe(2);
    expect(r.lines).toEqual([
      { date: "2026-10-01", description: "NEFT CR-MERIDIAN SOLAR, EPC", reference: "N123", amount: 118000, balance: 618000 },
      { date: "2026-10-02", description: "UPI-OFFICE WORKS", reference: "0000412345", amount: -18400, balance: 599600 },
    ]);
  });

  it("reads SBI and ICICI column names", () => {
    const sbi = read("Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance\n1 Oct 2026,1 Oct 2026,BY TRANSFER,TRF1,,500,1500\n2 Oct 2026,2 Oct 2026,ATM WDL,,200,,1300");
    expect(sbi.lines.map((l) => [l.date, l.amount])).toEqual([
      ["2026-10-01", 500],
      ["2026-10-02", -200],
    ]);
    const icici = read("S No.,Value Date,Transaction Date,Cheque Number,Transaction Remarks,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )\n1,01/10/2026,01/10/2026,,SALARY OCT,50000.00,0.00,10000.00");
    expect(icici.lines[0]).toMatchObject({ date: "2026-10-01", description: "SALARY OCT", amount: -50000, balance: 10000 });
  });

  it("reads a single amount column with a Dr/Cr indicator", () => {
    const r = read("Transaction Date,Description,Amount,Dr / Cr,Balance\n01-10-2026,GST PAYMENT,9000,DR,1000\n02-10-2026,INTEREST,12.5,CR,1012.5");
    expect(r.mapping.drCr).toBe(3);
    expect(r.lines.map((l) => l.amount)).toEqual([-9000, 12.5]);
  });

  it("reads a signed amount column", () => {
    const r = read("Date,Details,Amount\n2026-10-01,Card spend,-450.00\n2026-10-02,Refund,450.00");
    expect(r.lines.map((l) => l.amount)).toEqual([-450, 450]);
    expect(r.reversed).toBe(false);
  });

  it("finds no header in a file that isn't a statement", () => {
    expect(findHeaderRow(parseCsv("name,email\nAsha,a@example.com"))).toBe(-1);
  });
});

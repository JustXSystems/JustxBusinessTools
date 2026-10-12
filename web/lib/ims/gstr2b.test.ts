import { describe, expect, it } from "vitest";
import { isoDateOf, parseGstr2bJson, parseGstr2bTable } from "./gstr2b";

describe("GSTR-2B parsing", () => {
  it("reads the portal JSON and sums item rates", () => {
    const rows = parseGstr2bJson({
      data: {
        docdata: {
          b2b: [
            {
              ctin: "29abcde1234f1z5",
              trdnm: "Acme",
              inv: [
                {
                  inum: "S-1",
                  dt: "10-09-2026",
                  val: 1300,
                  items: [
                    { txval: 1000, cgst: 90, sgst: 90 },
                    { txval: 100, cgst: 10, sgst: 10 },
                  ],
                },
              ],
            },
            { ctin: "bad", inv: [{ inum: "X" }] },
          ],
        },
      },
    });
    expect(rows).toEqual([{ gstin: "29ABCDE1234F1Z5", supplier: "Acme", invoiceNo: "S-1", date: "2026-09-10", value: 1300, taxable: 1100, igst: 0, cgst: 100, sgst: 100 }]);
  });

  it("reads the portal Excel layout with a two-row header and one line per rate", () => {
    const rows = parseGstr2bTable([
      ["Goods and Services Tax - GSTR-2B"],
      [],
      ["GSTIN of supplier", "Trade/Legal name", "Invoice Details", "", "", "", "Taxable Value (₹)", "Tax Amount", "", ""],
      ["", "", "Invoice number", "Invoice type", "Invoice Date", "Invoice Value(₹)", "", "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)"],
      ["29ABCDE1234F1Z5", "Acme", "S-1", "Regular", "10/09/2026", "1,300.00", "1000", "0", "90", "90"],
      ["29ABCDE1234F1Z5", "Acme", "S-1", "Regular", "10/09/2026", "1,300.00", "100", "0", "10", "10"],
      ["Total", "", "", "", "", "", "", "", "", ""],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ invoiceNo: "S-1", date: "2026-09-10", value: 1300, taxable: 1100, cgst: 100, sgst: 100, igst: 0, supplier: "Acme" });
  });

  it("reads a simple one-row-header CSV", () => {
    const rows = parseGstr2bTable([
      ["GSTIN", "Invoice No", "Date", "IGST"],
      ["07ABCDE1234F1Z5", "A/9", "2026-09-01", 180],
    ]);
    expect(rows).toMatchObject([{ gstin: "07ABCDE1234F1Z5", invoiceNo: "A/9", date: "2026-09-01", igst: 180 }]);
  });

  it("converts Excel serial dates", () => {
    expect(isoDateOf(46275)).toBe("2026-09-10");
  });
});

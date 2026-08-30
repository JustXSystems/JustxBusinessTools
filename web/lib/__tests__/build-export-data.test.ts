import { describe, expect, it } from "vitest";
import { BUILTIN_TRACKER_FIELDS, validateTrackerData, ValidationError } from "@jbt/shared";
import { buildDocumentExport, buildTrackerExport } from "@/lib/export/build-export-data";

describe("build-export-data", () => {
  it("builds tracker export with field columns", () => {
    const dataset = buildTrackerExport("vendors", {
      key: "vendors",
      title: "Vendors",
      icon: "🏭",
      subtitle: "",
      addLabel: "Add",
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "phone", label: "Phone", type: "text", required: false },
      ],
      titleField: "name",
      subtitleFields: [],
      metaFields: [],
      statusField: null,
    }, [
      { id: "v1", name: "Acme", phone: "999" },
    ]);

    expect(dataset.headers).toEqual(["id", "name", "phone"]);
    expect(dataset.rows[0]).toMatchObject({ id: "v1", name: "Acme", phone: "999" });
    expect(dataset.filenameBase.startsWith("vendors-")).toBe(true);
  });

  it("builds document list export", () => {
    const dataset = buildDocumentExport("invoice", ["docNo", "partyName"], [
      { docNo: "INV/1", partyName: "Client" },
    ]);
    expect(dataset.headers).toEqual(["docNo", "partyName"]);
    expect(dataset.rows).toHaveLength(1);
    expect(dataset.filenameBase.startsWith("invoice-")).toBe(true);
  });
});

describe("ToolRecordForm validation integration", () => {
  it("rejects missing required vendor name", () => {
    expect(() =>
      validateTrackerData(BUILTIN_TRACKER_FIELDS.vendors, {
        name: "",
        category: "General",
      }),
    ).toThrow(ValidationError);
  });

  it("accepts valid payment tracker row", () => {
    const data = validateTrackerData(BUILTIN_TRACKER_FIELDS.paymenttracker, {
      kind: "Receivable",
      party: "Client A",
      ref: "INV-1",
      date: "2026-08-19",
      amount: 5000,
      status: "Pending",
    });
    expect(data.party).toBe("Client A");
  });
});

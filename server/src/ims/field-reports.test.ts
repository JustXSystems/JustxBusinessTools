import { describe, expect, it } from "vitest";
import {
  addMonthsISO,
  average,
  canMoveFieldTask,
  cleanTrack,
  daysOverdue,
  durationLabel,
  effectiveFieldStatus,
  fillRatePct,
  gstinStateCode,
  isB2CLarge,
  isFieldStatus,
  isReportType,
  isValidGstin,
  itemGstIssues,
  marginPct,
  minutesBetween,
  netGstPayable,
  nextReportRun,
  normalizeDocLine,
  rateWiseSummary,
  splitTax,
  trackKm,
} from "./logic.js";

const MIN = 60_000;

describe("field status", () => {
  it("recognises statuses", () => {
    expect(isFieldStatus("at_site")).toBe(true);
    expect(isFieldStatus("busy")).toBe(false);
  });

  it("an open visit always means at site", () => {
    expect(effectiveFieldStatus({ status: "travelling", date: "2026-10-12" }, "2026-10-12", true)).toBe("at_site");
  });

  it("a status set on an earlier day doesn't carry over", () => {
    expect(effectiveFieldStatus({ status: "active", date: "2026-10-11" }, "2026-10-12", false)).toBe("offline");
    expect(effectiveFieldStatus(null, "2026-10-12", false)).toBe("offline");
    expect(effectiveFieldStatus({ status: "on_leave", date: "2026-10-12" }, "2026-10-12", false)).toBe("on_leave");
    expect(effectiveFieldStatus({ status: "weird", date: "2026-10-12" }, "2026-10-12", false)).toBe("active");
  });
});

describe("field task transitions", () => {
  it("lets managers move a task anywhere except to the same status", () => {
    expect(canMoveFieldTask("done", "open", true)).toBe(true);
    expect(canMoveFieldTask("open", "cancelled", true)).toBe(true);
    expect(canMoveFieldTask("open", "open", true)).toBe(false);
  });

  it("restricts assignees to working the task", () => {
    expect(canMoveFieldTask("open", "in_progress", false)).toBe(true);
    expect(canMoveFieldTask("in_progress", "done", false)).toBe(true);
    expect(canMoveFieldTask("done", "in_progress", false)).toBe(true);
    expect(canMoveFieldTask("open", "cancelled", false)).toBe(false);
    expect(canMoveFieldTask("cancelled", "open", false)).toBe(false);
  });
});

describe("GPS trail", () => {
  const t0 = Date.UTC(2026, 9, 12, 4, 0);
  // ~1.11 km per 0.01° of latitude
  const walk = [
    { lat: 12.97, lng: 77.59, accuracy: 10, at: t0 },
    { lat: 12.98, lng: 77.59, accuracy: 15, at: t0 + 5 * MIN },
    { lat: 12.99, lng: 77.59, accuracy: 12, at: t0 + 10 * MIN },
  ];

  it("measures a clean trail", () => {
    expect(trackKm(walk)).toBeCloseTo(2.22, 1);
  });

  it("ignores standing-still jitter", () => {
    const jitter = [
      { lat: 12.97, lng: 77.59, accuracy: 10, at: t0 },
      { lat: 12.9701, lng: 77.5901, accuracy: 10, at: t0 + MIN },
      { lat: 12.97, lng: 77.5899, accuracy: 10, at: t0 + 2 * MIN },
      { lat: 12.9702, lng: 77.59, accuracy: 10, at: t0 + 3 * MIN },
    ];
    expect(trackKm(jitter)).toBe(0);
  });

  it("drops inaccurate fixes and impossible jumps", () => {
    const noisy = [
      walk[0],
      { lat: 13.5, lng: 77.59, accuracy: 900, at: t0 + 2 * MIN },
      { lat: 14.5, lng: 77.59, accuracy: 10, at: t0 + 3 * MIN },
      walk[1],
      walk[2],
    ];
    expect(cleanTrack(noisy)).toHaveLength(3);
    expect(trackKm(noisy)).toBeCloseTo(2.22, 1);
  });

  it("sorts by time and skips missing coordinates", () => {
    const shuffled = [walk[2], { lat: null, lng: null, at: t0 + MIN }, walk[0], walk[1]];
    expect(cleanTrack(shuffled).map((p) => p.at)).toEqual([t0, t0 + 5 * MIN, t0 + 10 * MIN]);
  });
});

describe("durations", () => {
  it("never goes negative", () => {
    expect(minutesBetween(10 * MIN, 5 * MIN)).toBe(0);
    expect(minutesBetween(0, 95 * MIN)).toBe(95);
    expect(minutesBetween(Number.NaN, 5)).toBe(0);
  });

  it("formats hours and minutes", () => {
    expect(durationLabel(45)).toBe("45m");
    expect(durationLabel(125)).toBe("2h 05m");
  });
});

describe("GSTIN", () => {
  it("validates format and reads the state code", () => {
    expect(isValidGstin("29AABCA1234B1Z5")).toBe(true);
    expect(isValidGstin("29aabca1234b1z5")).toBe(true);
    expect(isValidGstin("29OMCPC5566P1Z")).toBe(false);
    expect(isValidGstin(null)).toBe(false);
    expect(gstinStateCode("27AAFCM9087K1Z4")).toBe("27");
    expect(gstinStateCode("bad")).toBeNull();
  });
});

describe("GST maths", () => {
  it("splits tax intra vs inter state", () => {
    expect(splitTax(18.01, true)).toEqual({ cgst: 9.01, sgst: 9, igst: 0 });
    expect(splitTax(18, false)).toEqual({ cgst: 0, sgst: 0, igst: 18 });
  });

  it("normalises stored lines in either casing", () => {
    expect(normalizeDocLine({ itemId: "a", name: "Fan", hsn: "8414", qty: 2, rate: 1000, gstRate: 18, taxable: 2000, tax: 360 })).toMatchObject({ itemId: "a", taxable: 2000, tax: 360, gstRate: 18 });
    expect(normalizeDocLine({ item_id: "b", name: "Cable", qty: "3", rate: "100", gst_rate: "12", discount_pct: 10 })).toMatchObject({ itemId: "b", taxable: 270, tax: 32.4, gstRate: 12 });
    expect(normalizeDocLine(null)).toMatchObject({ name: "Item", qty: 0, taxable: 0, tax: 0 });
  });

  it("rolls up rate-wise with the split decided per line", () => {
    const rows = rateWiseSummary([
      { gstRate: 18, taxable: 1000, tax: 180, intraState: true },
      { gstRate: 18, taxable: 500, tax: 90, intraState: false },
      { gstRate: 5, taxable: 200, tax: 10, intraState: true },
    ]);
    expect(rows).toEqual([
      { rate: 5, taxable: 200, cgst: 5, sgst: 5, igst: 0, tax: 10 },
      { rate: 18, taxable: 1500, cgst: 90, sgst: 90, igst: 90, tax: 270 },
    ]);
  });

  it("classifies B2C large only for inter-state unregistered supplies above ₹1 lakh", () => {
    expect(isB2CLarge(150_000, false, false)).toBe(true);
    expect(isB2CLarge(150_000, true, false)).toBe(false);
    expect(isB2CLarge(100_000, false, false)).toBe(false);
    expect(isB2CLarge(500_000, false, true)).toBe(false);
  });

  it("flags item master gaps", () => {
    expect(itemGstIssues({ hsn: "8536", gstRate: 18 })).toEqual([]);
    expect(itemGstIssues({ hsn: null, gstRate: 18 })).toEqual(["Missing HSN / SAC"]);
    expect(itemGstIssues({ hsn: "85361", gstRate: 17 })).toEqual(["HSN should be 4, 6 or 8 digits", "GST 17% isn't a standard rate"]);
    expect(itemGstIssues({ hsn: "10063010", gstRate: 0 })).toEqual(["GST 0% — confirm the item is exempt or nil-rated"]);
  });
});

describe("ITC set-off", () => {
  it("uses IGST credit across heads before CGST / SGST credit", () => {
    const r = netGstPayable({ cgst: 500, sgst: 500, igst: 200 }, { cgst: 100, sgst: 100, igst: 600 });
    // IGST credit: 200 vs IGST, 400 vs CGST. Then CGST 100 vs CGST, SGST 100 vs SGST.
    expect(r.payable).toEqual({ cgst: 0, sgst: 400, igst: 0, total: 400 });
    expect(r.carryForward).toEqual({ cgst: 0, sgst: 0, igst: 0, total: 0 });
  });

  it("never crosses CGST and SGST credit and carries the excess forward", () => {
    const r = netGstPayable({ cgst: 100, sgst: 300, igst: 0 }, { cgst: 250, sgst: 0, igst: 0 });
    expect(r.payable).toEqual({ cgst: 0, sgst: 300, igst: 0, total: 300 });
    expect(r.carryForward).toEqual({ cgst: 150, sgst: 0, igst: 0, total: 150 });
  });

  it("applies CGST credit to IGST once CGST is cleared", () => {
    const r = netGstPayable({ cgst: 100, sgst: 0, igst: 100 }, { cgst: 150, sgst: 0, igst: 0 });
    expect(r.payable.total).toBe(50);
    expect(r.payable.igst).toBe(50);
  });
});

describe("reports", () => {
  it("knows its report types", () => {
    expect(isReportType("deadstock")).toBe(true);
    expect(isReportType("nope")).toBe(false);
  });

  it("schedules the next run, never in the past", () => {
    expect(nextReportRun("none", "2026-10-01", "2026-10-12")).toBeNull();
    expect(nextReportRun("daily", null, "2026-10-12")).toBe("2026-10-12");
    expect(nextReportRun("daily", "2026-10-12", "2026-10-12")).toBe("2026-10-13");
    expect(nextReportRun("weekly", "2026-10-10", "2026-10-12")).toBe("2026-10-17");
    expect(nextReportRun("weekly", "2026-09-01", "2026-10-12")).toBe("2026-10-12");
    expect(nextReportRun("monthly", "2026-10-12", "2026-10-12")).toBe("2026-11-12");
  });

  it("adds months clamped to month end", () => {
    expect(addMonthsISO("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsISO("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsISO("2026-12-15", 1)).toBe("2027-01-15");
  });

  it("computes fill rate, margin, overdue days and averages", () => {
    expect(fillRatePct(100, 80)).toBe(80);
    expect(fillRatePct(100, 120)).toBe(100);
    expect(fillRatePct(0, 5)).toBe(0);
    expect(marginPct(1000, 750)).toBe(25);
    expect(marginPct(0, 10)).toBe(0);
    expect(daysOverdue("2026-10-01", "2026-09-01", "2026-10-12")).toBe(11);
    expect(daysOverdue(null, "2026-10-02", "2026-10-12")).toBe(10);
    expect(daysOverdue("2026-10-20", "2026-10-01", "2026-10-12")).toBe(0);
    expect(average([2, 4, 9])).toBe(5);
    expect(average([])).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  accountTypeBadge,
  addDaysISO,
  assetBadge,
  drCr,
  normalBalance,
  onboardingBadge,
  openingBadge,
  priorityBadge,
  stageBadge,
  taskBadge,
  certificateBadge,
  durationLabel,
  kraBadge,
  promotionBadge,
  heldAssetBadge,
  tripBadge,
  serviceBadge,
  resolutionLabel,
  budgetBadge,
  computeGstTotals,
  dateLabel,
  depreciationLabel,
  defaultPayrollPeriod,
  dateRange,
  initialsOf,
  inr,
  inrCompact,
  inrExact,
  invoiceBadge,
  isIntraState,
  monthLabel,
  reportRange,
  rupeesInWords,
  spreadEvenly,
  timeAgo,
  toneFor,
  agreementBadge,
  complianceBadge,
  policyBadge,
  posChange,
  SALES_KIND_TAG,
  salesBadge,
} from "./format";

describe("spreadEvenly", () => {
  const sum = (a: number[]) => Math.round(a.reduce((s, v) => s + v, 0) * 100) / 100;

  it("splits into whole-rupee months that add back to the annual amount", () => {
    const months = spreadEvenly(100000);
    expect(months).toHaveLength(12);
    expect(months.slice(0, 4)).toEqual([8334, 8334, 8334, 8334]);
    expect(months[11]).toBe(8333);
    expect(sum(months)).toBe(100000);
  });

  it("keeps paise in the last month and never goes negative", () => {
    expect(sum(spreadEvenly(1200.5))).toBe(1200.5);
    expect(spreadEvenly(1200.5)[11]).toBe(100.5);
    expect(spreadEvenly(-50)).toEqual(Array.from({ length: 12 }, () => 0));
  });

  it("labels budget status", () => {
    expect(budgetBadge("over").text).toBe("OVER BUDGET");
    expect(budgetBadge("watch").tone).toBe("amber");
  });
});

describe("asset labels", () => {
  it("names the depreciation method the way the register shows it", () => {
    expect(depreciationLabel("wdv", 15)).toBe("WDV 15%");
    expect(depreciationLabel("slm", 31.67)).toBe("SLM 31.67%");
    expect(depreciationLabel("none", 0)).toBe("No depreciation");
  });

  it("badges asset status", () => {
    expect(assetBadge("in_use").text).toBe("IN USE");
    expect(assetBadge("maintenance").tone).toBe("amber");
    expect(assetBadge("disposed").tone).toBe("neutral");
  });
});

describe("performance display", () => {
  it("writes training durations like the catalog", () => {
    expect(durationLabel(3)).toBe("3 Days");
    expect(durationLabel(1)).toBe("1 Day");
    expect(durationLabel(0.5)).toBe("½ Day");
    expect(durationLabel(1.5)).toBe("1½ Days");
    expect(durationLabel(null)).toBe("Ongoing");
  });

  it("badges certificates, KRAs and promotions like the design", () => {
    expect(certificateBadge("expiring")).toEqual({ text: "EXPIRING SOON", tone: "amber" });
    expect(kraBadge("at_risk")).toEqual({ text: "AT RISK", tone: "amber" });
    expect(promotionBadge("pending")).toEqual({ text: "PENDING SIGN-OFF", tone: "amber" });
  });
});

describe("expenses & assets display", () => {
  it("puts a pending return ahead of the asset's own state", () => {
    expect(heldAssetBadge({ employeeId: "e1", status: "maintenance", returnState: "overdue" })).toEqual({ text: "OVERDUE RETURN", tone: "coral" });
    expect(heldAssetBadge({ employeeId: "e1", status: "in_use", returnState: "due" }).text).toBe("RETURN DUE");
    expect(heldAssetBadge({ employeeId: "e1", status: "maintenance", returnState: null }).text).toBe("IN MAINTENANCE");
    expect(heldAssetBadge({ employeeId: "e1", status: "in_use", returnState: null })).toEqual({ text: "ACTIVE", tone: "emerald" });
    expect(heldAssetBadge({ employeeId: null, status: "in_use", returnState: null }).text).toBe("IN STORE");
  });

  it("badges trips by where they stand", () => {
    expect(tripBadge("pending")).toEqual({ text: "PENDING APPROVAL", tone: "amber" });
    expect(tripBadge("on_trip").text).toBe("ON TRIP");
    expect(tripBadge("completed").tone).toBe("emerald");
  });
});

describe("employee services display", () => {
  it("badges requests like the design and writes resolution times compactly", () => {
    expect(serviceBadge("open")).toEqual({ text: "UNASSIGNED", tone: "coral" });
    expect(serviceBadge("in_progress").text).toBe("IN PROGRESS");
    expect(resolutionLabel(1.43)).toBe("1.4d");
    expect(resolutionLabel(0.25)).toBe("6h");
    expect(resolutionLabel(0)).toBe("1h");
    expect(resolutionLabel(null)).toBe("—");
  });
});

describe("policies & compliance display", () => {
  it("badges filings and agreements by urgency", () => {
    expect(complianceBadge("overdue")).toEqual({ text: "OVERDUE", tone: "coral" });
    expect(complianceBadge("due_soon").tone).toBe("amber");
    expect(agreementBadge("unsigned").text).toBe("AWAITING SIGNATURE");
    expect(agreementBadge("expired").tone).toBe("coral");
    expect(policyBadge("published").tone).toBe("emerald");
  });
});

describe("sales billing display", () => {
  it("badges documents the way the design does", () => {
    expect(salesBadge("in_transit")).toEqual({ text: "IN TRANSIT", tone: "amber" });
    expect(salesBadge("delivered").tone).toBe("emerald");
    expect(salesBadge("sent").tone).toBe("blue");
    expect(SALES_KIND_TAG.order).toEqual({ text: "SALES ORDER", tag: "blue" });
  });

  it("works out change only once enough cash is tendered", () => {
    expect(posChange(1180, "2000")).toBe(820);
    expect(posChange(1180, "1180")).toBe(0);
    expect(posChange(1180, "1000")).toBeNull();
    expect(posChange(1180, " ")).toBeNull();
    expect(posChange(99.5, "100")).toBe(0.5);
  });
});

describe("recruitment display", () => {
  it("badges roles, priorities and stages like the design", () => {
    expect(openingBadge("open")).toEqual({ text: "PUBLISHED", tone: "emerald" });
    expect(openingBadge("draft").tone).toBe("amber");
    expect(priorityBadge("high")).toEqual({ text: "HIGH", tone: "coral" });
    expect(priorityBadge("low").tone).toBe("blue");
    expect(stageBadge("applied").text).toBe("REVIEW");
    expect(stageBadge("shortlisted").tone).toBe("emerald");
    expect(onboardingBadge("delayed")).toEqual({ text: "DELAYED", tone: "coral" });
  });

  it("labels onboarding tasks, including a scheduled induction", () => {
    expect(taskBadge("documents", { done: true, date: "2026-10-01" }).text).toBe("SUBMITTED");
    expect(taskBadge("kyc", { done: true, date: "2026-10-01" }).text).toBe("VERIFIED");
    expect(taskBadge("it", undefined)).toEqual({ text: "PENDING", tone: "amber" });
    expect(taskBadge("induction", { done: false, date: "2026-08-11" })).toEqual({ text: "SCHEDULED — 11 Aug", tone: "blue" });
    expect(taskBadge("induction", undefined).text).toBe("NOT SCHEDULED");
  });
});

describe("accounting display", () => {
  it("badges account types in the design colours", () => {
    expect(accountTypeBadge("asset")).toEqual({ text: "ASSET", tone: "blue" });
    expect(accountTypeBadge("liability").tone).toBe("amber");
    expect(accountTypeBadge("equity").tone).toBe("lavender");
    expect(accountTypeBadge("income").tone).toBe("emerald");
    expect(accountTypeBadge("expense").tone).toBe("coral");
  });

  it("reads balances from the account's normal side", () => {
    expect(normalBalance(1200, "asset")).toBe(1200);
    expect(normalBalance(-1200, "liability")).toBe(1200);
    expect(normalBalance(-500, "income")).toBe(500);
    expect(normalBalance(300, "income")).toBe(-300);
    expect(Object.is(normalBalance(0, "equity"), -0)).toBe(false);
  });

  it("labels debit and credit balances", () => {
    expect(drCr(1200)).toBe("₹1,200 Dr");
    expect(drCr(-500.4)).toBe("₹500 Cr");
    expect(drCr(0.2)).toBe("₹0");
  });
});

describe("defaultPayrollPeriod", () => {
  it("defaults to last month until the 25th, across a year boundary", () => {
    expect(defaultPayrollPeriod("2026-10-05")).toBe("2026-09");
    expect(defaultPayrollPeriod("2026-10-25")).toBe("2026-10");
    expect(defaultPayrollPeriod("2027-01-03")).toBe("2026-12");
  });
});

describe("rupeesInWords", () => {
  it("spells whole rupees in the Indian system", () => {
    expect(rupeesInWords(0)).toBe("Rupees Zero only");
    expect(rupeesInWords(23300)).toBe("Rupees Twenty Three Thousand Three Hundred only");
    expect(rupeesInWords(1205019)).toBe("Rupees Twelve Lakh Five Thousand Nineteen only");
    expect(rupeesInWords(250000000)).toBe("Rupees Twenty Five Crore only");
    expect(rupeesInWords(47100.4)).toBe("Rupees Forty Seven Thousand One Hundred only");
  });
});

describe("report periods", () => {
  it("resolves presets up to today, with quarters on the financial year", () => {
    expect(reportRange("month", "2026-10-05")).toEqual({ from: "2026-10-01", to: "2026-10-05" });
    expect(reportRange("lastMonth", "2026-10-05")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(reportRange("lastMonth", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(reportRange("quarter", "2026-10-05")).toEqual({ from: "2026-10-01", to: "2026-10-05" });
    expect(reportRange("quarter", "2026-09-20")).toEqual({ from: "2026-07-01", to: "2026-09-20" });
    expect(reportRange("fy", "2026-10-05")).toEqual({ from: "2026-04-01", to: "2026-10-05" });
    expect(reportRange("fy", "2027-02-10")).toEqual({ from: "2026-04-01", to: "2027-02-10" });
    expect(reportRange("fy", "2026-10-05", 1)).toEqual({ from: "2026-01-01", to: "2026-10-05" });
  });

  it("labels months", () => {
    expect(monthLabel("2026-08")).toBe("Aug 2026");
  });
});

describe("money", () => {
  it("formats rupees with Indian grouping", () => {
    expect(inr(157000)).toBe("₹1,57,000");
    expect(inr(-4200)).toBe("−₹4,200");
    expect(inrExact(176560)).toBe("₹1,76,560.00");
  });

  it("compacts dashboard figures", () => {
    expect(inrCompact(19_400_000)).toBe("₹1.94Cr");
    expect(inrCompact(7_340_000)).toBe("₹73.4L");
    expect(inrCompact(42_500)).toBe("₹42.5K");
    expect(inrCompact(950)).toBe("₹950");
    expect(inrCompact(0)).toBe("₹0");
  });

  it("computes GST like the API (intra-state splits, inter-state IGST)", () => {
    const lines = [
      { description: "Solar panel installation", quantity: 1, rate: 145000, taxRate: 12 },
      { description: "AMC", quantity: 1, rate: 12000, taxRate: 18 },
    ];
    const intra = computeGstTotals(lines, true);
    expect(intra.subtotal).toBe(157000);
    expect(intra.taxTotal).toBe(19560);
    expect(intra.cgst + intra.sgst).toBe(19560);
    expect(intra.igst).toBe(0);
    expect(intra.grandTotal).toBe(176560);

    const inter = computeGstTotals([{ description: "x", quantity: 2, rate: 1000, discountPct: 10, taxRate: 18 }], false);
    expect(inter.lines[0]).toMatchObject({ gross: 2000, discount: 200, taxable: 1800, tax: 324, amount: 2124 });
    expect(inter.igst).toBe(324);
    expect(inter.cgst).toBe(0);
  });

  it("treats unknown states as intra-state", () => {
    expect(isIntraState("Karnataka", "karnataka")).toBe(true);
    expect(isIntraState("Karnataka", "")).toBe(true);
    expect(isIntraState("Karnataka", "Kerala")).toBe(false);
  });
});

describe("dates & people", () => {
  it("formats dates and ranges", () => {
    expect(dateLabel("2026-08-14")).toBe("14 Aug 2026");
    expect(dateLabel(null)).toBe("—");
    expect(dateRange("2026-07-29", "2026-07-31")).toBe("29 Jul – 31 Jul");
    expect(dateRange("2026-07-29", "2026-07-29")).toBe("29 Jul");
    expect(addDaysISO("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("renders relative time", () => {
    const now = new Date("2026-10-04T12:00:00");
    expect(timeAgo("2026-10-04 11:58:00", now)).toBe("2m ago");
    expect(timeAgo("2026-10-04 09:00:00", now)).toBe("3h ago");
    expect(timeAgo("2026-10-02 12:00:00", now)).toBe("2d ago");
  });

  it("derives initials and stable tones", () => {
    expect(initialsOf("Anita Desai")).toBe("AD");
    expect(initialsOf("Rahul")).toBe("RA");
    expect(initialsOf("")).toBe("?");
    expect(toneFor("Meridian Solar")).toBe(toneFor("Meridian Solar"));
  });

  it("maps invoice states to badges", () => {
    expect(invoiceBadge("overdue")).toEqual({ text: "OVERDUE", tone: "coral" });
    expect(invoiceBadge("paid").tone).toBe("emerald");
  });
});

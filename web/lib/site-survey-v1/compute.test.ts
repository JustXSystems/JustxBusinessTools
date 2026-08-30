import { describe, expect, it } from "vitest";
import { computeLoadSummary, seedAppliances } from "@/lib/site-survey-v1/appliances";
import { calcEstimate, previewReportId, uid } from "@/lib/site-survey-v1/compute";

describe("site-survey-v1 compute", () => {
  it("formats preview report ids", () => {
    expect(previewReportId("ZSS", 1)).toMatch(/^ZSS-ID-\d{2}\/\d{2}:00001$/);
  });

  it("computes residential load from appliances", () => {
    const apps = seedAppliances(uid).map((a) =>
      a.name === "Ceiling Fans" ? { ...a, on: true, qty: 2, watt: 75, hours: 8 } : { ...a, on: false },
    );
    const load = computeLoadSummary(apps);
    expect(load.connLoad).toBeCloseTo(0.15, 5);
    expect(load.dailyUnits).toBeCloseTo(1.2, 5);
    expect(load.monthlyUnits).toBeCloseTo(36, 5);
  });

  it("estimates residential size from bill", () => {
    const est = calcEstimate(
      "Residential Rooftop",
      { f_bill: "3000", systemtype: "On-Grid", f_modulesize: "" },
      { connLoad: 2, dailyUnits: 10, monthlyUnits: 300 },
    );
    expect(est.systemKW).toBeGreaterThan(0);
    expect(est.panels).toBeGreaterThanOrEqual(2);
    expect(est.totalCost).toBeGreaterThan(0);
    expect(est.flow).toBe("residential");
  });

  it("estimates EPC commercial from capacity", () => {
    const est = calcEstimate(
      "Commercial Rooftop",
      { c_capacity: "50" },
      { connLoad: 0, dailyUnits: 0, monthlyUnits: 0 },
    );
    expect(est.systemKW).toBe(50);
    expect(est.costPerKW).toBe(48000);
    expect(est.totalCost).toBe(50 * 48000);
    expect(est.flow).toBe("epc");
  });
});

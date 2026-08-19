import { describe, expect, it } from "vitest";
import { resolveGstRates, resolveTdsSections } from "../calculator-config";
import {
  resolveCommissionParams,
  resolveEmiParams,
  resolveLoanParams,
  resolveProfitParams,
  resolveSolarRoiParams,
} from "../calculator-config";

describe("calculator-config", () => {
  it("uses default GST rates without override", () => {
    expect(resolveGstRates(undefined)).toContain(18);
  });

  it("merges admin GST rates", () => {
    const rates = resolveGstRates({
      id: "gstcalc",
      toolType: "calculator",
      definition: { gstRates: [5, 12, 18] },
    });
    expect(rates).toEqual([5, 12, 18]);
  });

  it("merges admin TDS sections", () => {
    const sections = resolveTdsSections({
      id: "tdscalc",
      toolType: "calculator",
      definition: {
        tdsSections: [{ code: "Test", rate: 7 }],
      },
    });
    expect(sections[0].code).toBe("Test");
    expect(sections[0].rate).toBe(7);
  });

  it("merges EMI defaults from admin config", () => {
    const params = resolveEmiParams({
      id: "emicalc",
      toolType: "calculator",
      definition: { defaultPrincipal: 750000, defaultMonths: 48 },
    });
    expect(params.defaultPrincipal).toBe(750000);
    expect(params.defaultMonths).toBe(48);
  });

  it("merges profit calculator defaults", () => {
    const params = resolveProfitParams({
      id: "profitcalc",
      toolType: "calculator",
      definition: { defaultCost: 2000, defaultSell: 2500, defaultQty: 3 },
    });
    expect(params.defaultCost).toBe(2000);
    expect(params.defaultSell).toBe(2500);
    expect(params.defaultQty).toBe(3);
  });

  it("merges loan and solar ROI defaults", () => {
    const loan = resolveLoanParams({
      id: "loancalc",
      toolType: "calculator",
      definition: { defaultYears: 7 },
    });
    expect(loan.defaultYears).toBe(7);

    const solar = resolveSolarRoiParams({
      id: "solarroi",
      toolType: "calculator",
      definition: { defaultLifeYears: 20 },
    });
    expect(solar.defaultLifeYears).toBe(20);
  });

  it("merges commission defaults", () => {
    const params = resolveCommissionParams({
      id: "dealercommission",
      toolType: "calculator",
      definition: { defaultTdsPct: 10 },
    });
    expect(params.defaultTdsPct).toBe(10);
  });
});

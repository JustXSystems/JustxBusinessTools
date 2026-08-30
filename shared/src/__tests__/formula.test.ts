import { describe, expect, it } from "vitest";
import { applyComputedFields, evaluateFormula, validateFormula } from "../formula";

describe("evaluateFormula", () => {
  it("evaluates arithmetic with field refs", () => {
    const r = evaluateFormula("qty * rate * (1 + gst / 100)", { qty: 2, rate: 100, gst: 18 });
    expect(r).toEqual({ ok: true, value: 236 });
  });

  it("supports functions", () => {
    expect(evaluateFormula("round(total, 2)", { total: 10.456 }).ok).toBe(true);
    expect(evaluateFormula("min(a, b)", { a: 3, b: 1 })).toEqual({ ok: true, value: 1 });
    expect(evaluateFormula("abs(x)", { x: -4 })).toEqual({ ok: true, value: 4 });
  });

  it("rejects unknown fields and division by zero", () => {
    expect(evaluateFormula("foo + 1", {}).ok).toBe(false);
    expect(evaluateFormula("a / b", { a: 1, b: 0 }).ok).toBe(false);
  });
});

describe("validateFormula", () => {
  it("checks allowed keys", () => {
    expect(validateFormula("qty * rate", ["qty", "rate"])).toBeNull();
    expect(validateFormula("qty * price", ["qty", "rate"])).toMatch(/Unknown/);
  });
});

describe("applyComputedFields", () => {
  it("writes computed values", () => {
    const out = applyComputedFields(
      [
        { key: "qty", type: "number" },
        { key: "rate", type: "number" },
        { key: "amount", type: "computed", formula: "qty * rate" },
      ],
      { qty: 3, rate: 50 },
    );
    expect(out.amount).toBe(150);
  });
});

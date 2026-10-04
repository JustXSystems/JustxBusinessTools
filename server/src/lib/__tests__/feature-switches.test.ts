import { describe, expect, it } from "vitest";
import { FEATURE_SWITCHES, isFeatureSwitchKey, resolveFeatureSwitches } from "../feature-switches.js";

describe("feature switches", () => {
  it("are all off when nothing is stored", () => {
    const state = resolveFeatureSwitches([]);
    expect(Object.keys(state).sort()).toEqual(FEATURE_SWITCHES.map((s) => s.key).sort());
    expect(Object.values(state).every((v) => v === false)).toBe(true);
  });

  it("turn on only from an enabled row and ignore unknown keys", () => {
    const state = resolveFeatureSwitches([
      { switch_key: "bos.handoff.quotationv1", enabled: 1 },
      { switch_key: "bos.handoff.sitesurveyv1", enabled: 0 },
      { switch_key: "retired.switch", enabled: 1 },
    ]);
    expect(state["bos.handoff.quotationv1"]).toBe(true);
    expect(state["bos.handoff.sitesurveyv1"]).toBe(false);
    expect("retired.switch" in state).toBe(false);
  });

  it("validate keys against the registry", () => {
    expect(isFeatureSwitchKey("bos.handoff.quotationv1")).toBe(true);
    expect(isFeatureSwitchKey("anything.else")).toBe(false);
  });

  it("have unique keys that fit the column", () => {
    const keys = FEATURE_SWITCHES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.length <= 64)).toBe(true);
  });
});

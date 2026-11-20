import { describe, expect, it } from "vitest";
import {
  IMS_ALWAYS_ON_MODULES,
  moduleAllowed,
  normalizeEnabledModules,
  parseImsModules,
  pathAllowedForModules,
} from "./ims-profile-modules.js";

describe("ims-profile-modules", () => {
  it("keeps always-on modules when normalizing", () => {
    const keys = normalizeEnabledModules(["sales", "bom"]);
    for (const k of IMS_ALWAYS_ON_MODULES) expect(keys).toContain(k);
    expect(keys).toContain("sales");
    expect(keys).toContain("bom");
    expect(keys).toContain("bomDc");
    expect(keys).not.toContain("field");
  });

  it("auto-includes DC & Returns when BOM Create / Maintain is enabled", () => {
    const keys = normalizeEnabledModules(["bom"]);
    expect(keys).toContain("bom");
    expect(keys).toContain("bomDc");
  });

  it("allows /bom API when only bomDc is enabled", () => {
    const enabled = normalizeEnabledModules(["bomDc"]);
    expect(pathAllowedForModules("/bom/dcs", enabled)).toBe(true);
    expect(pathAllowedForModules("/bom/docs", enabled)).toBe(true);
  });

  it("treats null / missing JSON as unrestricted", () => {
    expect(parseImsModules(null)).toBeNull();
    expect(parseImsModules(undefined)).toBeNull();
    expect(moduleAllowed(null, "field")).toBe(true);
  });

  it("parses stored JSON allowlists", () => {
    const keys = parseImsModules(JSON.stringify(["sales", "bogus"]));
    expect(keys).toContain("sales");
    expect(keys).toContain("dashboard");
    expect(keys).not.toContain("bogus" as never);
  });

  it("blocks module-specific API paths when disabled", () => {
    const enabled = normalizeEnabledModules(["sales"]);
    expect(pathAllowedForModules("/session", enabled)).toBe(true);
    expect(pathAllowedForModules("/invoices", enabled)).toBe(true);
    expect(pathAllowedForModules("/bom/docs", enabled)).toBe(false);
    expect(pathAllowedForModules("/field/overview", enabled)).toBe(false);
    expect(pathAllowedForModules("/settings", enabled)).toBe(true);
  });
});

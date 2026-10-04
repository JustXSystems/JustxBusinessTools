import { describe, expect, it } from "vitest";
import { getToolDefinition, toolsByCategory } from "@/config/tools.config";
import {
  catalogEnabledOptInTools,
  filterHomeToolsByCatalog,
  filterHomeToolsBySelection,
  mergedHomeTools,
  resolveToolDefinition,
} from "@/lib/dynamic-tools";

function homeIds(catalog: Array<{ id: string; available: boolean }>, selection: string[] | null): string[] {
  const merged = filterHomeToolsByCatalog(mergedHomeTools([]), catalog);
  return [...filterHomeToolsBySelection(merged, selection), ...catalogEnabledOptInTools(catalog)].map((t) => t.id);
}

describe("opt-in tools (bosdesign)", () => {
  it("resolves as a subscription-exempt utility route", () => {
    const def = resolveToolDefinition("bosdesign", []);
    expect(def?.type).toBe("utility");
    expect(def?.subscriptionExempt).toBe(true);
    expect(def?.route).toBe("/tools/bosdesign");
  });

  it("never enters the home list, picker or default selections on its own", () => {
    expect(mergedHomeTools([]).some((t) => t.id === "bosdesign")).toBe(false);
    expect(toolsByCategory().flatMap((g) => g.tools).some((t) => t.id === "bosdesign")).toBe(false);
  });

  it("stays hidden with no catalog, a missing row, or an unavailable row", () => {
    expect(homeIds([], null)).not.toContain("bosdesign");
    expect(homeIds([{ id: "invoice", available: true }], null)).not.toContain("bosdesign");
    expect(homeIds([{ id: "bosdesign", available: false }], null)).not.toContain("bosdesign");
  });

  it("appears once an admin enables it, regardless of saved home selections", () => {
    const catalog = [{ id: "bosdesign", available: true }];
    expect(homeIds(catalog, null).filter((id) => id === "bosdesign")).toHaveLength(1);
    expect(homeIds(catalog, ["invoice"])).toEqual(["invoice", "bosdesign"]);
  });

  it("leaves existing tools untouched", () => {
    expect(getToolDefinition("qrgenerator")?.showOnHome).toBe(true);
    expect(homeIds([], null)).toContain("qrgenerator");
  });
});

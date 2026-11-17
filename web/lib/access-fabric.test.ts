import { describe, expect, it } from "vitest";
import { computeAccessReadiness, type FabricToolNode } from "@/lib/access-fabric";

function tool(partial: Partial<FabricToolNode> & Pick<FabricToolNode, "toolId" | "name">): FabricToolNode {
  return {
    category: "General",
    includedFree: false,
    licensed: false,
    periodEnd: null,
    hardLock: false,
    onHome: false,
    hasSku: true,
    priceInr: 499,
    trialDays: 14,
    ...partial,
  };
}

describe("computeAccessReadiness", () => {
  it("scores a fully entitled approved profile highly", () => {
    const readiness = computeAccessReadiness({
      identityCompleteness: 100,
      approvalStatus: "approved",
      peopleGranted: 3,
      peopleTotal: 3,
      homeToolIds: ["quotation", "invoice"],
      tools: [
        tool({ toolId: "quotation", name: "Quotation", licensed: true, onHome: true }),
        tool({ toolId: "invoice", name: "Invoice", includedFree: true, onHome: true }),
      ],
      packs: [
        {
          id: "sales_pack",
          name: "Sales Pack",
          tagline: null,
          toolIds: ["quotation", "invoice"],
          priceInr: 0,
          listPriceInr: 0,
          available: true,
          highlighted: true,
        },
      ],
    });
    expect(readiness.score).toBeGreaterThanOrEqual(80);
    expect(readiness.grade).toMatch(/A|B/);
    expect(readiness.packs[0]?.coveragePct).toBe(100);
  });

  it("recommends packs when commercial tools are missing", () => {
    const readiness = computeAccessReadiness({
      identityCompleteness: 50,
      approvalStatus: "pending",
      peopleGranted: 0,
      peopleTotal: 2,
      homeToolIds: ["quotation"],
      tools: [
        tool({ toolId: "quotation", name: "Quotation", hardLock: true, onHome: true }),
        tool({ toolId: "invoice", name: "Invoice", hardLock: true }),
      ],
      packs: [
        {
          id: "sales_pack",
          name: "Sales Pack",
          tagline: "Quote to invoice",
          toolIds: ["quotation", "invoice"],
          priceInr: 999,
          listPriceInr: 1200,
          available: true,
          highlighted: true,
        },
      ],
    });
    expect(readiness.dimCount + readiness.orphanHomeCount).toBeGreaterThan(0);
    expect(readiness.actions.some((a) => a.action === "grant-pack")).toBe(true);
    expect(readiness.packs[0]?.recommended).toBe(true);
  });
});

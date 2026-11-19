import { describe, expect, it } from "vitest";
import {
  capabilityCoverageScore,
  computeAccessReadiness,
  computePackMatches,
  signalFor,
  type FabricToolNode,
} from "@/lib/access-fabric";

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

describe("signalFor", () => {
  it("marks hard-lock on home as orphan, not locked", () => {
    expect(
      signalFor(tool({ toolId: "quotation", name: "Quotation", hardLock: true, onHome: true })),
    ).toBe("orphan");
  });

  it("marks hard-lock off home as locked", () => {
    expect(signalFor(tool({ toolId: "invoice", name: "Invoice", hardLock: true }))).toBe("locked");
  });

  it("marks soft-cap on home without license as orphan", () => {
    expect(signalFor(tool({ toolId: "amc", name: "AMC", onHome: true }))).toBe("orphan");
  });
});

describe("computePackMatches", () => {
  const tools = [
    tool({ toolId: "quotation", name: "Quotation" }),
    tool({ toolId: "invoice", name: "Invoice" }),
  ];

  it("expands empty toolIds only for all_tools", () => {
    const matches = computePackMatches(tools, [
      {
        id: "all_tools",
        name: "All Tools",
        tagline: null,
        toolIds: [],
        priceInr: 0,
        listPriceInr: 0,
        available: true,
        highlighted: true,
      },
      {
        id: "empty_other",
        name: "Broken Pack",
        tagline: null,
        toolIds: [],
        priceInr: 0,
        listPriceInr: 0,
        available: true,
        highlighted: false,
      },
    ]);
    expect(matches.find((m) => m.pack.id === "all_tools")?.resolvedToolIds).toEqual([
      "quotation",
      "invoice",
    ]);
    expect(matches.find((m) => m.pack.id === "empty_other")?.resolvedToolIds).toEqual([]);
    expect(matches.find((m) => m.pack.id === "empty_other")?.total).toBe(0);
  });
});

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
    expect(readiness.orphanHomeCount).toBe(0);
  });

  it("counts hard-lock home tools as orphans and recommends packs", () => {
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
    expect(readiness.orphanHomeCount).toBe(1);
    expect(readiness.actions.some((a) => a.action === "grant-pack")).toBe(true);
    expect(readiness.actions.some((a) => a.id === "surface-orphan")).toBe(true);
    expect(readiness.packs[0]?.recommended).toBe(true);
    expect(readiness.packs[0]?.resolvedToolIds).toEqual(["quotation", "invoice"]);
  });

  it("adds a capabilities layer and open-capabilities action when ceilings exist", () => {
    const readiness = computeAccessReadiness({
      identityCompleteness: 100,
      approvalStatus: "approved",
      peopleGranted: 2,
      peopleTotal: 2,
      homeToolIds: ["imsdealer"],
      tools: [tool({ toolId: "imsdealer", name: "IMS", licensed: true, onHome: true })],
      packs: [],
      capabilityTools: [
        {
          toolId: "imsdealer",
          name: "IMS",
          entitled: true,
          hasCeiling: true,
          unrestricted: false,
          coveragePct: 40,
        },
      ],
    });
    expect(readiness.layers.some((l) => l.id === "capabilities")).toBe(true);
    expect(readiness.actions.some((a) => a.action === "open-capabilities")).toBe(true);
  });
});

describe("capabilityCoverageScore", () => {
  it("scores unrestricted assigned ceilings at 100", () => {
    const result = capabilityCoverageScore([
      {
        toolId: "imsdealer",
        name: "IMS",
        entitled: true,
        hasCeiling: true,
        unrestricted: true,
        coveragePct: 100,
      },
    ]);
    expect(result.score).toBe(100);
    expect(result.curatedGaps).toBe(0);
  });

  it("penalizes unassigned ceiling tools", () => {
    const result = capabilityCoverageScore([
      {
        toolId: "imsdealer",
        name: "IMS",
        entitled: false,
        hasCeiling: true,
        unrestricted: null,
        coveragePct: null,
      },
    ]);
    expect(result.score).toBe(25);
    expect(result.unassignedCeilings).toBe(1);
  });
});

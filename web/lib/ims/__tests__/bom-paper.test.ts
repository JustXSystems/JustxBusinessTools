import { describe, expect, it } from "vitest";
import {
  BOM_PAPER_TEMPLATES,
  BOM_PAPER_TEMPLATE_META,
  bomCostComposition,
  bomPaperTemplateMeta,
  groupBomSections,
  lineKindCode,
  normalizeBomPaperTemplate,
  sampleBomPaperModel,
} from "../bom-paper";

describe("bom-paper templates", () => {
  it("normalizes known and unknown ids", () => {
    expect(normalizeBomPaperTemplate("tiered")).toBe("tiered");
    expect(normalizeBomPaperTemplate("AURORA")).toBe("aurora");
    expect(normalizeBomPaperTemplate("prism")).toBe("prism");
    expect(normalizeBomPaperTemplate("nope")).toBe("classic");
    expect(normalizeBomPaperTemplate(null)).toBe("classic");
  });

  it("exposes nine marketplace layouts with meta", () => {
    expect(BOM_PAPER_TEMPLATES).toEqual([
      "classic",
      "tiered",
      "epc",
      "executive",
      "field",
      "aurora",
      "ledger",
      "atelier",
      "prism",
    ]);
    expect(BOM_PAPER_TEMPLATE_META).toHaveLength(9);
    for (const id of BOM_PAPER_TEMPLATES) {
      const meta = bomPaperTemplateMeta(id);
      expect(meta.id).toBe(id);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.era.length).toBeGreaterThan(0);
      expect(meta.features.length).toBeGreaterThan(0);
    }
  });

  it("groups lines into roman sections with share percentages", () => {
    const model = sampleBomPaperModel();
    const sections = groupBomSections(model.lines, model.totals.materialsTotal);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.roman).toBe("I");
    expect(sections[0]!.name).toBe("Main Items");
    expect(sections[0]!.materials).toBe(103000);
    expect(sections[0]!.sharePct).toBe(87.9);
    expect(sections[1]!.roman).toBe("II");
    expect(sections[1]!.materials).toBe(14200);
    expect(sections[1]!.sharePct).toBe(12.1);
  });

  it("builds cost composition ribbons from totals", () => {
    const model = sampleBomPaperModel();
    const c = bomCostComposition(model.totals);
    expect(c.materials + c.margin + c.tax).toBeCloseTo(c.grand, 1);
    expect(c.materialsPct + c.marginPctOfGrand + c.taxPctOfGrand).toBeCloseTo(100, 0);
  });

  it("maps line kinds to compact ledger codes", () => {
    expect(lineKindCode("stock")).toBe("STK");
    expect(lineKindCode("service")).toBe("SRV");
    expect(lineKindCode("overhead")).toBe("OVH");
    expect(lineKindCode("scaled")).toBe("SCL");
    expect(lineKindCode(null)).toBe("—");
  });

  it("sample model totals stay internally consistent", () => {
    const model = sampleBomPaperModel();
    const materials = model.lines.reduce((s, l) => s + Number(l.amount || 0), 0);
    expect(model.totals.materialsTotal).toBe(materials);
    expect(model.totals.grandTotal).toBeGreaterThan(model.totals.materialsTotal);
  });
});

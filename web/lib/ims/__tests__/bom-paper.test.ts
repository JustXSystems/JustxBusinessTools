import { describe, expect, it } from "vitest";
import {
  BOM_PAPER_TEMPLATES,
  bomPaperTemplateMeta,
  groupBomSections,
  normalizeBomPaperTemplate,
  sampleBomPaperModel,
} from "../bom-paper";

describe("bom-paper templates", () => {
  it("normalizes known and unknown ids", () => {
    expect(normalizeBomPaperTemplate("tiered")).toBe("tiered");
    expect(normalizeBomPaperTemplate("FIELD")).toBe("field");
    expect(normalizeBomPaperTemplate("nope")).toBe("classic");
    expect(normalizeBomPaperTemplate(null)).toBe("classic");
  });

  it("exposes five marketplace layouts", () => {
    expect(BOM_PAPER_TEMPLATES).toEqual(["classic", "tiered", "epc", "executive", "field"]);
    for (const id of BOM_PAPER_TEMPLATES) {
      expect(bomPaperTemplateMeta(id).id).toBe(id);
      expect(bomPaperTemplateMeta(id).label.length).toBeGreaterThan(0);
    }
  });

  it("groups lines into roman sections with material roll-ups", () => {
    const model = sampleBomPaperModel();
    const sections = groupBomSections(model.lines);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.roman).toBe("I");
    expect(sections[0]!.name).toBe("Main Items");
    expect(sections[0]!.materials).toBe(103000);
    expect(sections[1]!.roman).toBe("II");
    expect(sections[1]!.materials).toBe(14200);
  });

  it("sample model totals stay internally consistent", () => {
    const model = sampleBomPaperModel();
    const materials = model.lines.reduce((s, l) => s + Number(l.amount || 0), 0);
    expect(model.totals.materialsTotal).toBe(materials);
    expect(model.totals.grandTotal).toBeGreaterThan(model.totals.materialsTotal);
  });
});

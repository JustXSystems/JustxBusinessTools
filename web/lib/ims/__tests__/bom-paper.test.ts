import { describe, expect, it } from "vitest";
import {
  BOM_INDUSTRY_PACKS,
  BOM_PAPER_PURPOSE_META,
  BOM_PAPER_PURPOSES,
  bomCostComposition,
  bomCustomerComposition,
  bomIndustryPackMeta,
  bomPaperPurposeMeta,
  bomTaxBreakup,
  groupBomSections,
  lineKindCode,
  normalizeBomIndustryPack,
  normalizeBomPaperPurpose,
  normalizeBomPaperTemplate,
  sampleBomPaperModel,
  scheduleColumnsFor,
} from "../bom-paper";

describe("bom-paper purposes", () => {
  it("normalizes legacy skins and purpose ids", () => {
    expect(normalizeBomPaperTemplate("aether")).toBe("proposal");
    expect(normalizeBomPaperTemplate("classic")).toBe("proposal");
    expect(normalizeBomPaperTemplate("epc")).toBe("technical");
    expect(normalizeBomPaperTemplate("orbit")).toBe("executive");
    expect(normalizeBomPaperTemplate("folio")).toBe("share");
    expect(normalizeBomPaperTemplate("proposal")).toBe("proposal");
    expect(normalizeBomPaperTemplate("ORBIT")).toBe("executive");
    expect(normalizeBomPaperTemplate("nope")).toBe("proposal");
    expect(normalizeBomPaperTemplate(null)).toBe("proposal");
    expect(normalizeBomPaperPurpose("field")).toBe("field");
  });

  it("exposes five document purposes with meta", () => {
    expect(BOM_PAPER_PURPOSES).toHaveLength(5);
    expect(BOM_PAPER_PURPOSE_META).toHaveLength(5);
    for (const id of BOM_PAPER_PURPOSES) {
      const meta = bomPaperPurposeMeta(id);
      expect(meta.id).toBe(id);
      expect(meta.short.length).toBeGreaterThan(0);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.features.length).toBeGreaterThan(0);
    }
  });

  it("exposes industry packs with schedule columns", () => {
    expect(BOM_INDUSTRY_PACKS).toHaveLength(6);
    for (const id of BOM_INDUSTRY_PACKS) {
      const meta = bomIndustryPackMeta(id);
      expect(meta.columns.length).toBeGreaterThan(3);
      expect(meta.fieldColumns.includes("rate")).toBe(false);
      expect(meta.fieldColumns.includes("amount")).toBe(false);
    }
    expect(normalizeBomIndustryPack("solar")).toBe("solar");
    expect(normalizeBomIndustryPack("nope")).toBe("general");
    expect(scheduleColumnsFor("field", "epc")).not.toContain("rate");
    expect(scheduleColumnsFor("technical", "epc")).toContain("remarks");
  });

  it("groups lines into roman sections with share percentages", () => {
    const model = sampleBomPaperModel("Biz", "solar");
    const sections = groupBomSections(model.lines, model.totals.materialsTotal);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.roman).toBe("I");
    expect(sections[0]!.name).toBe("Main Items");
    expect(sections[0]!.materials).toBe(103000);
    expect(sections[0]!.sharePct).toBe(90);
    expect(sections[1]!.roman).toBe("II");
    expect(sections[1]!.materials).toBe(11500);
    expect(sections[1]!.sharePct).toBe(10);
  });

  it("builds cost composition and customer hide-margin view", () => {
    const model = sampleBomPaperModel();
    const c = bomCostComposition(model.totals);
    expect(c.materials + c.margin + c.tax).toBeCloseTo(c.grand, 1);
    const hidden = bomCustomerComposition(model.totals, true);
    expect(hidden.margin).toBe(0);
    expect(hidden.materials).toBe(c.subtotal);
    expect(hidden.grand).toBe(c.grand);
  });

  it("splits tax into CGST/SGST or IGST from place of supply", () => {
    const intra = bomTaxBreakup(1800, 18, "Karnataka", "Karnataka");
    expect(intra.intraState).toBe(true);
    expect(intra.cgst).toBe(900);
    expect(intra.sgst).toBe(900);
    expect(intra.igst).toBe(0);
    const inter = bomTaxBreakup(1800, 18, "Karnataka", "Maharashtra");
    expect(inter.intraState).toBe(false);
    expect(inter.igst).toBe(1800);
    expect(inter.cgst).toBe(0);
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

  it("sample model carries commercial proposal fields and line identity", () => {
    const model = sampleBomPaperModel("Biz", "solar");
    expect(model.projectRef).toBeTruthy();
    expect(model.validUntil).toBeTruthy();
    expect(model.paymentTerms).toBeTruthy();
    expect(model.lines[0]!.sku).toBeTruthy();
    expect(model.lines[0]!.hsn).toBeTruthy();
    expect(model.industryPack).toBe("solar");
  });

  it("exposes pack size labels for builder field copy", () => {
    expect(bomIndustryPackMeta("solar").sizeLabel).toBe("Capacity");
    expect(bomIndustryPackMeta("general").sizeLabel).toBe("Package");
    expect(bomIndustryPackMeta("epc").sizeLabel).toBe("Scope");
  });

  it("gives each industry pack default section shells", () => {
    expect(bomIndustryPackMeta("epc").defaultSections).toEqual(["Supply", "Installation", "Civil & Misc"]);
    expect(bomIndustryPackMeta("manufacturing").defaultSections[0]).toBe("Raw materials");
    expect(bomIndustryPackMeta("services").defaultSections).toContain("Labour");
  });
});

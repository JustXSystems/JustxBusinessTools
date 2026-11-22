import { describe, expect, it } from "vitest";
import { PREFIX_FIELDS, withOpsSettingsDefaults } from "../settings";

describe("withOpsSettingsDefaults", () => {
  it("fills BOM/DC/RTN prefixes and print/attachment knobs when missing", () => {
    const filled = withOpsSettingsDefaults({});
    expect(filled.bomPrefix).toBe("BOM");
    expect(filled.bomDcPrefix).toBe("DC");
    expect(filled.bomDcReturnPrefix).toBe("RTN");
    expect(filled.printPackMax).toBe(25);
    expect(filled.attachmentMaxBytes).toBe(2 * 1024 * 1024);
    expect(filled.agingBreaks).toEqual([15, 30, 60, 90]);
    expect(filled.arPriority).toEqual({ critical: 91, high: 61, medium: 31 });
    expect(filled.apDueSoonDays).toBe(7);
  });

  it("clamps print pack and attachment size", () => {
    expect(withOpsSettingsDefaults({ printPackMax: 0 }).printPackMax).toBe(25);
    expect(withOpsSettingsDefaults({ printPackMax: 999 }).printPackMax).toBe(200);
    expect(withOpsSettingsDefaults({ attachmentMaxBytes: 100 }).attachmentMaxBytes).toBe(256 * 1024);
    expect(withOpsSettingsDefaults({ attachmentMaxBytes: 50 * 1024 * 1024 }).attachmentMaxBytes).toBe(20 * 1024 * 1024);
  });

  it("preserves explicit values", () => {
    const filled = withOpsSettingsDefaults({
      bomPrefix: "BOQ",
      bomDcPrefix: "CHLN",
      bomDcReturnPrefix: "BRET",
      printPackMax: 10,
      attachmentMaxBytes: 5 * 1024 * 1024,
    });
    expect(filled.bomPrefix).toBe("BOQ");
    expect(filled.bomDcPrefix).toBe("CHLN");
    expect(filled.bomDcReturnPrefix).toBe("BRET");
    expect(filled.printPackMax).toBe(10);
    expect(filled.attachmentMaxBytes).toBe(5 * 1024 * 1024);
  });
});

describe("PREFIX_FIELDS", () => {
  it("includes BOM / DC / return numbering keys", () => {
    const keys = PREFIX_FIELDS.map((f) => f.key);
    expect(keys).toContain("bomPrefix");
    expect(keys).toContain("bomDcPrefix");
    expect(keys).toContain("bomDcReturnPrefix");
  });
});

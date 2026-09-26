import { describe, expect, it } from "vitest";
import {
  DEFAULT_QR_CONFIG,
  eclAtLeast,
  maxEcl,
  qrConfigToDefinition,
  resolveQrGeneratorConfig,
} from "@/lib/qr-generator/config";
import { applyUtm, buildQrPayload } from "@/lib/qr-generator/payloads";
import { batchTemplateCsv, parseBatch, parseDelimited } from "@/lib/qr-generator/batch";
import { addHistoryEntry, historyLabel } from "@/lib/qr-generator/history";

describe("resolveQrGeneratorConfig", () => {
  it("returns defaults for missing or junk definitions", () => {
    expect(resolveQrGeneratorConfig(undefined)).toEqual(DEFAULT_QR_CONFIG);
    expect(resolveQrGeneratorConfig("nope")).toEqual(DEFAULT_QR_CONFIG);
  });

  it("round-trips a published definition", () => {
    const cfg = resolveQrGeneratorConfig({
      ...DEFAULT_QR_CONFIG,
      enabledTypes: ["upi", "url"],
      defaultType: "upi",
      minEcl: "Q",
    });
    const again = resolveQrGeneratorConfig(qrConfigToDefinition(cfg));
    expect(again).toEqual(cfg);
    expect(qrConfigToDefinition(cfg).type).toBe("utility");
  });

  it("keeps type order, drops unknown types and repairs a disabled default", () => {
    const cfg = resolveQrGeneratorConfig({ enabledTypes: ["wifi", "bogus", "url", "wifi"], defaultType: "upi" });
    expect(cfg.enabledTypes).toEqual(["wifi", "url"]);
    expect(cfg.defaultType).toBe("wifi");
    expect(resolveQrGeneratorConfig({ enabledTypes: [] }).enabledTypes).toEqual(DEFAULT_QR_CONFIG.enabledTypes);
  });

  it("sanitises brand design, logo and presets", () => {
    const cfg = resolveQrGeneratorConfig({
      brand: {
        design: { fg: "#ABC", bg: "red", margin: 99, moduleStyle: "stars", logoScale: 5 },
        logoSource: "custom",
        logoDataUrl: "javascript:alert(1)",
        lockDesign: true,
        presets: [{ name: "Brand", fg: "#112233" }, { name: "Bad", fg: "blue" }],
      },
    });
    expect(cfg.brand.design.fg).toBe("#aabbcc");
    expect(cfg.brand.design.bg).toBe("#ffffff");
    expect(cfg.brand.design.margin).toBe(8);
    expect(cfg.brand.design.moduleStyle).toBe("square");
    expect(cfg.brand.design.logoScale).toBeLessThanOrEqual(0.28);
    expect(cfg.brand.logoSource).toBe("none");
    expect(cfg.brand.logoDataUrl).toBeNull();
    expect(cfg.brand.lockDesign).toBe(true);
    expect(cfg.brand.presets).toEqual([{ name: "Brand", fg: "#112233" }]);
  });

  it("filters export formats/sizes and normalises the filename prefix", () => {
    const cfg = resolveQrGeneratorConfig({
      exports: { formats: ["svg", "exe"], sizes: [2048, 333], defaultSize: 512, filenamePrefix: "Acme QR!" },
    });
    expect(cfg.exports.formats).toEqual(["svg"]);
    expect(cfg.exports.sizes).toEqual([2048]);
    expect(cfg.exports.defaultSize).toBe(2048);
    expect(cfg.exports.filenamePrefix).toBe("acme-qr");
  });

  it("falls back for blank copy and keeps per-type field defaults and captions", () => {
    const cfg = resolveQrGeneratorConfig({
      title: "   ",
      fieldDefaults: { upi: { pa: "shop@okaxis", pn: "Acme" }, nope: { x: "1" } },
      captions: { upi: "Pay Acme" },
    });
    expect(cfg.title).toBe(DEFAULT_QR_CONFIG.title);
    expect(cfg.fieldDefaults).toEqual({ upi: { pa: "shop@okaxis", pn: "Acme" } });
    expect(cfg.captions.upi).toBe("Pay Acme");
    expect(cfg.captions.wifi).toBe(DEFAULT_QR_CONFIG.captions.wifi);
  });

  it("orders error-correction levels", () => {
    expect(maxEcl("M", "Q")).toBe("Q");
    expect(maxEcl("H", "Q")).toBe("H");
    expect(eclAtLeast("M", "Q")).toBe(false);
    expect(eclAtLeast("H", "Q")).toBe(true);
  });
});

describe("UTM tagging", () => {
  it("adds missing utm params without overwriting existing ones", () => {
    expect(applyUtm("https://a.com/p?x=1", { source: "qr", medium: "print", campaign: "diwali" })).toBe(
      "https://a.com/p?x=1&utm_source=qr&utm_medium=print&utm_campaign=diwali",
    );
    expect(applyUtm("https://a.com/?utm_source=ig", { source: "qr" })).toBe("https://a.com/?utm_source=ig");
  });

  it("is applied to URL payloads only when switched on", () => {
    const base = { url: "a.com", utmSource: "qr", utmMedium: "flyer" };
    const off = buildQrPayload("url", base);
    const on = buildQrPayload("url", { ...base, utmOn: "1" });
    expect(off.ok && off.payload).toBe("https://a.com");
    expect(on.ok && on.payload).toBe("https://a.com/?utm_source=qr&utm_medium=flyer");
  });
});

describe("batch parsing", () => {
  it("parses quoted CSV and tab-separated Excel pastes", () => {
    expect(parseDelimited('a,b\r\n"x, y","say ""hi"""\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
    expect(parseDelimited("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("maps headers by key or label and validates each row", () => {
    const csv = "UPI ID (VPA),pn,Amount (₹),filename,caption,notes\nshop@okaxis,Shop A,100,Counter 1,Pay here,x\nbad,Shop B,,,,\nshop@okaxis,Shop C,5,Counter 1,,";
    const res = parseBatch("upi", csv, { maxRows: 10, filenamePrefix: "acme" });
    expect(res.unknownColumns).toEqual(["notes"]);
    expect(res.missingRequired).toEqual([]);
    expect(res.items).toHaveLength(3);
    expect(res.items[0].name).toBe("counter-1");
    expect(res.items[0].caption).toBe("Pay here");
    expect(res.items[0].result.ok && res.items[0].result.payload).toContain("am=100.00");
    expect(res.items[1].result.ok).toBe(false);
    expect(res.items[1].name).toBe("acme-upi-002");
    expect(res.items[2].name).toBe("counter-1-2");
  });

  it("reports missing required columns and truncates to maxRows", () => {
    const res = parseBatch("wifi", "security,password\nWPA,12345678\nWPA,12345678", { maxRows: 1 });
    expect(res.missingRequired).toEqual(["Network name (SSID)"]);
    expect(res.truncated).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].result.ok).toBe(false);
  });

  it("builds a template whose header round-trips through the parser", () => {
    const tpl = batchTemplateCsv("vcard");
    const res = parseBatch("vcard", tpl, { maxRows: 5 });
    expect(res.unknownColumns).toEqual([]);
    expect(res.items).toHaveLength(1);
  });
});

describe("history", () => {
  it("dedupes, caps and never stores secrets", () => {
    let list = addHistoryEntry([], "wifi", { ssid: "Office", password: "secret123" }, 2, 1);
    expect(list[0].fields).toEqual({ ssid: "Office" });
    list = addHistoryEntry(list, "url", { url: "a.com" }, 2, 2);
    list = addHistoryEntry(list, "wifi", { ssid: "Office", password: "other" }, 2, 3);
    expect(list.map((e) => e.type)).toEqual(["wifi", "url"]);
    list = addHistoryEntry(list, "text", { text: "hi" }, 2, 4);
    expect(list).toHaveLength(2);
    expect(historyLabel("url", { url: "https://example.com/path" })).toBe("example.com/path");
  });
});

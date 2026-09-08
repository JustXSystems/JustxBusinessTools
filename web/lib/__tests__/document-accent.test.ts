import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCUMENT_ACCENT_COLOR,
  documentAccentCssVars,
  documentAccentPdfPalette,
  hexToRgbTuple,
  normalizeDocumentAccentColor,
} from "../document-accent";

describe("document accent color", () => {
  it("normalizes hex and falls back to default teal", () => {
    expect(normalizeDocumentAccentColor("#0F3D3E")).toBe("#0f3d3e");
    expect(normalizeDocumentAccentColor("abc")).toBe("#aabbcc");
    expect(normalizeDocumentAccentColor("not-a-color")).toBe(DEFAULT_DOCUMENT_ACCENT_COLOR);
    expect(normalizeDocumentAccentColor(null)).toBe(DEFAULT_DOCUMENT_ACCENT_COLOR);
  });

  it("exposes CSS vars for quote-sheet and doc preview", () => {
    const vars = documentAccentCssVars("#123456");
    expect(vars["--q-teal-800"]).toBe("#123456");
    expect(vars["--doc-accent"]).toBe("#123456");
    expect(vars["--doc-accent-rgb"]).toBe("18, 52, 86");
  });

  it("builds a PDF palette from accent", () => {
    const rgb = hexToRgbTuple("#0f3d3e");
    expect(rgb).toEqual([15, 61, 62]);
    const palette = documentAccentPdfPalette("#0f3d3e");
    expect(palette.tealDeep).toEqual([15, 61, 62]);
    expect(palette.tealHead[0]).toBeGreaterThan(15);
  });
});

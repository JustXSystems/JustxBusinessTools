import { describe, expect, it } from "vitest";
import { rowsToCsv } from "@/lib/export/csv";

describe("rowsToCsv", () => {
  it("escapes commas and quotes", () => {
    const csv = rowsToCsv(["name", "note"], [{ name: "A,B", note: 'say "hi"' }]);
    expect(csv).toContain('"A,B"');
    expect(csv).toContain('"say ""hi"""');
  });

  it("includes UTF-8 BOM for Excel", () => {
    const csv = rowsToCsv(["x"], [{ x: "1" }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
});

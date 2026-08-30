import { describe, expect, it } from "vitest";
import {
  normalizeConflictPolicy,
  sanitizeFilename,
  validateDownloadFolderPath,
} from "../artifact-delivery.js";

describe("download folder validation", () => {
  it("accepts UNC and drive paths", () => {
    expect(validateDownloadFolderPath("\\\\fileserver\\shared\\business-artifacts")).toBe(
      "\\\\fileserver\\shared\\business-artifacts",
    );
    expect(validateDownloadFolderPath("C:\\Artifacts")).toBe("C:\\Artifacts");
    expect(validateDownloadFolderPath("/mnt/share/out")).toBe("/mnt/share/out");
  });

  it("rejects traversal and relative paths", () => {
    expect(() => validateDownloadFolderPath("..\\secrets")).toThrow();
    expect(() => validateDownloadFolderPath("relative/folder")).toThrow();
    expect(validateDownloadFolderPath("")).toBeNull();
    expect(validateDownloadFolderPath(null)).toBeNull();
  });

  it("normalizes conflict policy and filenames", () => {
    expect(normalizeConflictPolicy("overwrite")).toBe("overwrite");
    expect(normalizeConflictPolicy("nope")).toBe("rename");
    expect(sanitizeFilename("report?.pdf")).toBe("report_.pdf");
    expect(sanitizeFilename("a/b/c.pdf")).toBe("c.pdf");
  });
});

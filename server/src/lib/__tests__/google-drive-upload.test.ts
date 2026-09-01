import { describe, expect, it } from "vitest";
import {
  conflictFilename,
  escapeDriveQueryValue,
  pickNewestDriveFile,
  planDriveConflict,
} from "../google-drive-upload.js";

describe("google-drive conflict helpers", () => {
  it("escapes Drive query values", () => {
    expect(escapeDriveQueryValue("Q-001.pdf")).toBe("Q-001.pdf");
    expect(escapeDriveQueryValue("O'Brien.pdf")).toBe("O\\'Brien.pdf");
    expect(escapeDriveQueryValue("a\\b.pdf")).toBe("a\\\\b.pdf");
  });

  it("builds rename candidates like FSA/agent", () => {
    expect(conflictFilename("quote.pdf", 1)).toBe("quote (1).pdf");
    expect(conflictFilename("quote.pdf", 2)).toBe("quote (2).pdf");
    expect(conflictFilename("noext", 1)).toBe("noext (1)");
  });

  it("picks the newest Drive file", () => {
    const newest = pickNewestDriveFile([
      {
        id: "old",
        name: "a.pdf",
        webViewLink: null,
        modifiedTime: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "new",
        name: "a.pdf",
        webViewLink: "https://drive.google.com/file/d/new",
        modifiedTime: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(newest?.id).toBe("new");
  });

  it("plans overwrite as update of existing file", () => {
    const plan = planDriveConflict({
      policy: "overwrite",
      filename: "Q-1.pdf",
      existingSameName: [
        {
          id: "file1",
          name: "Q-1.pdf",
          webViewLink: "https://drive.google.com/file/d/file1",
          modifiedTime: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(plan).toEqual({ action: "update", fileId: "file1", filename: "Q-1.pdf" });
  });

  it("plans skip when file exists", () => {
    const plan = planDriveConflict({
      policy: "skip",
      filename: "Q-1.pdf",
      existingSameName: [
        {
          id: "file1",
          name: "Q-1.pdf",
          webViewLink: null,
          modifiedTime: null,
        },
      ],
    });
    expect(plan.action).toBe("skip");
    if (plan.action === "skip") expect(plan.fileId).toBe("file1");
  });

  it("plans rename to next free (n) name", () => {
    const plan = planDriveConflict({
      policy: "rename",
      filename: "Q-1.pdf",
      existingSameName: [
        { id: "a", name: "Q-1.pdf", webViewLink: null, modifiedTime: null },
      ],
      takenNames: new Set(["Q-1.pdf", "Q-1 (1).pdf"]),
    });
    expect(plan).toEqual({ action: "create", filename: "Q-1 (2).pdf" });
  });

  it("plans create when name is free", () => {
    expect(
      planDriveConflict({
        policy: "overwrite",
        filename: "Q-1.pdf",
        existingSameName: [],
      }),
    ).toEqual({ action: "create", filename: "Q-1.pdf" });
  });
});

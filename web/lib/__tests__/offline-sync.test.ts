/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createDocument, createToolRecord } from "@/lib/api";
import { enqueueOfflineMutation } from "@/lib/offline/queue-store";
import { flushOfflineQueue } from "@/lib/offline/sync-engine";

vi.mock("@/lib/api", () => ({
  createToolRecord: vi.fn(),
  updateToolRecord: vi.fn(),
  deleteToolRecord: vi.fn(),
  createDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));

describe("flushOfflineQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("replays tracker.create mutations", async () => {
    enqueueOfflineMutation({
      id: "mut_1",
      kind: "tracker.create",
      toolId: "vendors",
      recordId: "v_test",
      payload: { name: "Synced Vendor" },
    });

    vi.mocked(createToolRecord).mockResolvedValue({
      id: "v_test",
      toolId: "vendors",
      data: { name: "Synced Vendor" },
      createdAt: "",
      updatedAt: "",
    });

    const result = await flushOfflineQueue();

    expect(result.processed).toBe(1);
    expect(createToolRecord).toHaveBeenCalledWith("vendors", { name: "Synced Vendor" }, "v_test");
  });

  it("replays document.create mutations", async () => {
    enqueueOfflineMutation({
      id: "mut_doc",
      kind: "document.create",
      toolId: "quotation",
      recordId: "quotation_1",
      payload: { id: "quotation_1", party: { name: "A" }, items: [] },
    });

    vi.mocked(createDocument).mockResolvedValue({ id: "quotation_1" });

    const result = await flushOfflineQueue();

    expect(result.processed).toBe(1);
    expect(createDocument).toHaveBeenCalledWith("quotation", {
      id: "quotation_1",
      party: { name: "A" },
      items: [],
    });
  });
});

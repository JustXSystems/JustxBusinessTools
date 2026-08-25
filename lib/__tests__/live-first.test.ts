import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { liveFirstFetch } from "@/lib/live-first";

describe("liveFirstFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("prefers live data over contingency", async () => {
    const result = await liveFirstFetch({
      fetchLive: async () => "live",
      readContingency: () => "stale",
      defaults: "default",
      timeoutMs: 0,
    });
    expect(result).toEqual({ data: "live", source: "live" });
  });

  it("uses contingency only when live fails", async () => {
    const result = await liveFirstFetch({
      fetchLive: async () => {
        throw new Error("network");
      },
      readContingency: () => "contingency",
      defaults: "default",
      timeoutMs: 0,
    });
    expect(result).toEqual({ data: "contingency", source: "contingency" });
  });

  it("uses contingency immediately when offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchLive = vi.fn(async () => "live");
    const result = await liveFirstFetch({
      fetchLive,
      readContingency: () => "offline-cache",
      defaults: "default",
      timeoutMs: 0,
    });
    expect(fetchLive).not.toHaveBeenCalled();
    expect(result).toEqual({ data: "offline-cache", source: "contingency" });
  });
});

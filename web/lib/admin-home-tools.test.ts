import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...args: unknown[]) => api(...args) }));

describe("admin-home-tools", () => {
  beforeEach(() => {
    api.mockReset();
  });

  it("reads homeToolIds from nested profile GET response", async () => {
    api.mockResolvedValueOnce({
      profile: { homeToolIds: ["invoice", "bos"] },
      people: [],
    });
    const { fetchHomeToolIds } = await import("./admin-home-tools");
    await expect(fetchHomeToolIds(12)).resolves.toEqual(["invoice", "bos"]);
  });

  it("ensureToolsOnHome merges without wiping existing allowlist", async () => {
    api.mockResolvedValueOnce({
      profile: { homeToolIds: ["invoice"] },
      people: [],
    });
    api.mockResolvedValueOnce({ ok: true });
    const { ensureToolsOnHome } = await import("./admin-home-tools");
    await expect(ensureToolsOnHome(12, ["bos"])).resolves.toEqual(["invoice", "bos"]);
    expect(api).toHaveBeenLastCalledWith("/admin/profiles/12", {
      method: "PUT",
      body: JSON.stringify({ homeToolIds: ["invoice", "bos"] }),
    });
  });
});

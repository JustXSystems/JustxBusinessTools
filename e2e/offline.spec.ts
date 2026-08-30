import { test, expect } from "@playwright/test";
import { clearToolRecords } from "./helpers/api";

const API_BASE = process.env.E2E_API_URL ?? "http://localhost:4100";

test.describe("offline sync", () => {
  test.beforeEach(async ({ request }) => {
    await clearToolRecords(request, "stock");
  });

  test("queues tracker create and syncs when online", async ({ page, request }) => {
    const itemName = `Offline Stock ${Date.now()}`;

    await page.goto("/tools/stock");
    await expect(page.getByRole("button", { name: /Add Entry/i })).toBeVisible();

    await page.route("**/api/tools/stock/records", async (route) => {
      if (route.request().method() === "POST") {
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });

    await page.getByRole("button", { name: /Add Entry/i }).click();
    await page.getByLabel("Item Name").fill(itemName);
    await page.getByLabel("Quantity").fill("5");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.locator(".toast.show")).toContainText(/offline/i, { timeout: 10000 });

    const queued = await page.evaluate(() => {
      const raw = localStorage.getItem("jbt:offline-queue:v1");
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as unknown[];
      return Array.isArray(parsed) ? parsed.length : 0;
    });
    expect(queued).toBeGreaterThan(0);

    await page.unroute("**/api/tools/stock/records");

    const syncResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/tools/stock/records") &&
        res.request().method() === "POST" &&
        res.status() === 201,
      { timeout: 15000 },
    );

    await page.reload();
    await syncResponse;

    await expect.poll(async () => {
      const res = await request.get(`${API_BASE}/api/tools/stock/records`);
      const list = (await res.json()) as Array<{ data?: { item?: string } }>;
      return list.some((r) => r.data?.item === itemName);
    }, { timeout: 15000 }).toBe(true);

    await expect(page.getByText(itemName)).toBeVisible({ timeout: 10000 });
  });
});

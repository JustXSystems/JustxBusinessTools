import { test, expect } from "@playwright/test";
import {
  clearToolRecords,
  seedVendorRecords,
} from "./helpers/api";

const API_BASE = process.env.E2E_API_URL ?? "http://localhost:4100";

test.describe.configure({ mode: "serial" });

test.describe("subscription limits", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${API_BASE}/api/subscription/cancel`).catch(() => {});
    await clearToolRecords(request, "vendors");
  });

  test("L1 — free plan blocks create at 28 records", async ({ page, request }) => {
    await seedVendorRecords(request, 28);

    const usageRes = await request.get(`${API_BASE}/api/tools/vendors/usage`);
    const usage = await usageRes.json();
    expect(usage.recordCount).toBe(28);
    expect(usage.atLimit).toBe(true);

    await page.goto("/tools/vendors");
    await expect(page.getByText(/28 \/ 28 records/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Add Vendor/i })).toBeDisabled();

    await expect(page.getByRole("button", { name: /Subscribe to this tool/i })).toBeVisible();
    await page.getByRole("button", { name: /Subscribe to this tool/i }).click();
    await expect(page).toHaveURL(/\/subscription/);
    await expect(page.getByRole("heading", { name: /Subscribe to tools|Tool catalog/i })).toBeVisible();
  });

  test("L2 — UPI QR checkout submits a claim for verification", async ({ page }) => {
    await page.goto("/subscription");
    await page.getByRole("button", { name: /^Add to cart$/i }).first().click();
    await page.getByRole("link", { name: /^Checkout$/i }).click();
    await expect(page).toHaveURL(/\/subscription\/checkout/);
    await expect(page.getByRole("heading", { name: /Checkout|How would you like to pay/i })).toBeVisible();
    await page.getByLabel("Your name").fill("E2E Payer");
    await page.getByLabel("Email").fill("e2e@justx.local");
    await page.getByLabel(/UPI \/ UTR/i).fill("123456789012");
    await page.getByRole("button", { name: /Submit payment confirmation/i }).click();
    await expect(page.locator(".toast.show")).toContainText(/verif/i, {
      timeout: 10000,
    });
  });

  test("L3 — delete frees quota on free plan", async ({ page, request }) => {
    await clearToolRecords(request, "vendors");
    await seedVendorRecords(request, 28);

    const records = await request.get(`${API_BASE}/api/tools/vendors/records`);
    const list = (await records.json()) as Array<{ id: string }>;
    await request.delete(`${API_BASE}/api/tools/vendors/records/${list[0].id}`);

    await page.goto("/tools/vendors");
    await page.getByRole("button", { name: /Add Vendor/i }).click();
    await expect(page.getByLabel("Vendor Name")).toBeVisible();
    await page.getByLabel("Vendor Name").fill("Quota Freed Vendor");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".toast.show")).toContainText(/Saved/i, { timeout: 10000 });
    await expect(page.getByText("Quota Freed Vendor")).toBeVisible();
  });
});

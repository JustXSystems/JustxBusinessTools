import { test, expect } from "@playwright/test";

test.describe("documents", () => {
  test("quotation create and list", async ({ page }) => {
    const customer = `E2E Customer ${Date.now()}`;

    await page.goto("/profile");
    await page.getByLabel("Business Name").fill("E2E Test Business");
    await page.getByRole("button", { name: "Save Business Profile" }).click();
    await expect(page.getByText("Business profile saved.")).toBeVisible({ timeout: 10000 });

    await page.goto("/tools/quotation");
    await expect(page.locator(".tool-header-title")).toContainText("Quotation");
    await expect(page.getByText("Loading…")).toBeHidden({ timeout: 10000 });

    await page.getByLabel("Customer Name").fill(customer);
    await page.getByPlaceholder("e.g. Solar Panel 540W").fill("Test Panel");
    await page.getByLabel("Rate (₹)").fill("5000");

    await page.getByRole("button", { name: /Save QUOTATION/i }).click();
    await expect(page.locator(".toast.show")).toContainText(/QUOTATION saved/i, { timeout: 10000 });

    await page.getByRole("button", { name: /Saved/i }).click();
    await expect(page).toHaveURL(/view=list/);
    await expect(page.getByText(customer).first()).toBeVisible();
  });

  test("invoice editor loads with tax fields", async ({ page }) => {
    await page.goto("/tools/invoice");
    await expect(page.getByLabel("Customer Name")).toBeVisible();
    await expect(page.getByText("Item / Service Name")).toBeVisible();
    await expect(page.getByRole("button", { name: /Save TAX INVOICE/i })).toBeVisible();
  });

  test("D2 — invoice save syncs to payment tracker", async ({ page, request }) => {
    await page.goto("/profile");
    await page.getByLabel("Business Name").fill("E2E Invoice Business");
    await page.getByRole("button", { name: "Save Business Profile" }).click();
    await expect(page.getByText("Business profile saved.")).toBeVisible({ timeout: 10000 });

    const customer = `Invoice Customer ${Date.now()}`;

    await page.goto("/tools/invoice");
    await expect(page.getByText("Loading…")).toBeHidden({ timeout: 10000 });
    await page.getByLabel("Customer Name").fill(customer);
    await page.getByPlaceholder("e.g. Solar Panel 540W").fill("Service Fee");
    await page.getByLabel("Rate (₹)").fill("10000");
    await page.getByRole("button", { name: /Save TAX INVOICE/i }).click();
    await expect(page.locator(".toast.show")).toContainText(/saved/i, { timeout: 10000 });

    await page.goto("/tools/paymenttracker");
    await expect(page.getByText(customer)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Receivable")).toBeVisible();
  });
});

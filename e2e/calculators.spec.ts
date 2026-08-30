import { test, expect } from "@playwright/test";

test.describe("calculators", () => {
  test("C1 — GST add mode 18% on 1000", async ({ page }) => {
    await page.goto("/tools/gstcalc");
    await page.getByLabel("Amount (₹)").fill("1000");
    await page.getByLabel("GST Rate").selectOption("18");
    await page.getByLabel("Calculation Type").selectOption("add");

    await expect(page.locator(".result-value")).toContainText("1,180.00");
    await expect(page.locator(".rg-val").first()).toContainText("1,000.00");
    await expect(page.getByText("GST Amount (18%)").locator("..").locator(".rg-val")).toContainText(
      "180",
    );
  });
});

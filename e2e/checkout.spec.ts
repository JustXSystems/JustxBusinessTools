import { expect, test } from "@playwright/test";

/**
 * Checkout / billing UI smoke — does not complete a live payment.
 */
test.describe("subscription UI", () => {
  test("subscription page loads without server error", async ({ page }) => {
    const res = await page.goto("/subscription");
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });
});

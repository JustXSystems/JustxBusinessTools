import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test.describe("public quotation page", () => {
  test("unknown share token returns not found (no crash)", async ({ page }) => {
    const res = await page.goto("/q/00000000-0000-4000-8000-000000000000");
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("authenticated smoke extras", () => {
  test("profile loads for admin", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/profile");
    await expect(page.getByText(/Business Profile/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test("status page is public", async ({ page }) => {
    await page.goto("/status");
    await expect(page.getByRole("heading", { name: /status/i })).toBeVisible({ timeout: 15_000 });
  });
});

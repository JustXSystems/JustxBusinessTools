import { expect, test } from "@playwright/test";

/**
 * Drive OAuth UI smoke — does not complete Google consent (needs live credentials).
 * Asserts Profile delivery panel renders when authenticated.
 */
test.describe("drive delivery panel", () => {
  test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, "Set E2E_EMAIL and E2E_PASSWORD");

  test("company document delivery section visible", async ({ page }) => {
    const { loginAsAdmin } = await import("./helpers/auth");
    await loginAsAdmin(page);
    await page.goto("/profile");
    await expect(page.getByText(/Company document delivery/i).first()).toBeVisible({
      timeout: 25_000,
    });
  });
});

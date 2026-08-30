import { test, expect } from "@playwright/test";

test.describe("smoke", () => {
  test("home page loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".brand-name")).toHaveText("JustXSystems");
  });

  test("settings page loads", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator(".tool-header-title")).toContainText("Settings");
    await expect(page.locator(".card-label", { hasText: "Account" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("profile page loads", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.locator(".tool-header-title")).toHaveText("Business Profile");
  });

  test("notifications page loads", async ({ page }) => {
    await page.goto("/notifications");
    await expect(page.locator(".tool-header-title")).toContainText("Notifications");
  });

  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("GST calculator tool opens", async ({ page }) => {
    await page.goto("/tools/gstcalc");
    await expect(page.locator(".tool-header-title")).toContainText("GST Calculator");
  });

  test("vendor tracker loads list UI", async ({ page }) => {
    await page.goto("/tools/vendors");
    await expect(page.locator(".tool-header-title")).toContainText("Vendor Directory");
    await expect(page.getByRole("button", { name: /Add Vendor/i })).toBeVisible();
  });

  test("login page is username and password only", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /OTP/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Create account" })).toHaveCount(0);
  });

  test("invoice tool saved list link", async ({ page }) => {
    await page.goto("/tools/invoice?view=list");
    await expect(page.locator(".tool-header-title")).toContainText("Invoice");
  });
});

test.describe("admin", () => {
  const email = process.env.E2E_ADMIN_EMAIL ?? "admin@justx.local";
  const password = process.env.E2E_ADMIN_PASSWORD ?? "admin123";

  test("admin login and dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.locator("form.login-form button[type='submit']").click();

    await page.waitForURL(/\/admin/);
    await expect(page.getByText("Usage (30d)")).toBeVisible();
  });
});

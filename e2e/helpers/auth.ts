import type { Page } from "@playwright/test";

/** Log in via password form. Requires E2E_EMAIL / E2E_PASSWORD. */
export async function loginAsAdmin(page: Page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_EMAIL and E2E_PASSWORD must be set");
  }
  await page.goto("/login");
  await page.getByLabel("Username").click();
  await page.getByLabel("Username").fill(email);
  await page.getByLabel("Password").click();
  await page.getByLabel("Password").fill(password);
  await page.locator("form.login-form button[type='submit']").click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
}

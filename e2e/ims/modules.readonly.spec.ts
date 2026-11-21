import { test, expect, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import { IMS_MODULE_SCENARIOS } from "./modules.catalog";
import { annotateScenario, smokeModule } from "./helpers";
import { imsAuthStatePath, playwrightBaseURL } from "./env";

/**
 * Shared page for the whole matrix so production only authenticates once
 * (avoids mid-suite re-login + 429 Too many requests).
 */
test.describe.serial("IMS read-only module matrix (JustTestX)", () => {
  let page: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext({
      storageState: path.join(process.cwd(), imsAuthStatePath()),
      baseURL: playwrightBaseURL(),
    });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  for (const scenario of IMS_MODULE_SCENARIOS) {
    test(`${scenario.id} — ${scenario.label} loads`, async ({}, testInfo) => {
      annotateScenario(testInfo, scenario.id, `${scenario.section}: ${scenario.label}`, {
        moduleKey: scenario.key,
        path: scenario.path,
        mutates: "false",
        manualChecks: scenario.manualChecks.join(" | "),
      });
      await smokeModule(page, scenario);
      if (scenario.key === "dashboard") return;
      const navBtn = page.locator(`nav[aria-label="IMS modules"] button[title="${scenario.label}"]`);
      if ((await navBtn.count()) === 0) return;
      await expect(navBtn).toHaveAttribute("aria-current", "page");
    });
  }
});

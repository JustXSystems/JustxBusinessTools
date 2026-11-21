import { test, expect } from "@playwright/test";
import { annotateScenario, expectImsShell, gotoImsModule, assertNoModuleCrash } from "./helpers";

test.describe("IMS shell & navigation", () => {
  test("JX-SHELL — IMS shell for JustTestX owner", async ({ page }, testInfo) => {
    annotateScenario(testInfo, "JX-SHELL", "Sign in as JustTestX owner and open IMS shell", {
      mutates: "false",
      manualChecks: "Role pill shows Owner | Nav sections present | Notifications bell opens",
    });
    await gotoImsModule(page, "/ims");
    await expect(page.getByText(/Owner|Admin/i).first()).toBeVisible();
    const bell = page.getByRole("button", { name: /Notifications/i });
    await expect(bell).toBeVisible();
    await bell.click();
    await expect(page.getByRole("dialog").filter({ hasText: /Notifications|caught up|Stock alerts/i })).toBeVisible();
  });

  test("JX-NAV — sidebar and deep links", async ({ page }, testInfo) => {
    annotateScenario(testInfo, "JX-NAV", "Sidebar navigation switches modules without crash", {
      mutates: "false",
      manualChecks: "Active nav updates | Deep link persists after reload",
    });
    await gotoImsModule(page, "/ims");
    await page.locator('nav[aria-label="IMS modules"] button[title="Items"]').click();
    await expect(page.locator(".ims-page-title")).toContainText("Items");
    await expect(page).toHaveURL(/m=items/);

    await page.reload();
    await expectImsShell(page, "/ims?m=items");
    await assertNoModuleCrash(page);
    await expect(page.locator(".ims-page-title")).toContainText("Items");
  });

  test("JX-SEARCH — global search seeded entities", async ({ page }, testInfo) => {
    annotateScenario(testInfo, "JX-SEARCH", "Global search finds seeded party and item", {
      mutates: "false",
      manualChecks: "Cascade party | JX-CRIMP item",
    });
    await gotoImsModule(page, "/ims");

    async function openImsSearch() {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      // Overlay can sit above the readonly searchbox after prior dialogs — force open.
      await page.getByRole("searchbox", { name: "Search IMS" }).click({ force: true });
      const field = page.getByRole("dialog").getByLabel("Search", { exact: true });
      await expect(field).toBeVisible({ timeout: 15_000 });
      return field;
    }

    const searchBox = await openImsSearch();
    await searchBox.fill("Cascade");
    await expect(page.getByRole("dialog").getByRole("button", { name: /Cascade/i }).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("dialog").getByRole("button", { name: /Cascade/i }).first().click();
    await assertNoModuleCrash(page);
    await expect(page.locator(".ims-page-title").or(page.locator(".ims-hero-title")).first()).toBeVisible();

    const searchBox2 = await openImsSearch();
    await searchBox2.fill("JX-CRIMP");
    await expect(page.getByRole("dialog").getByRole("button", { name: /JX-CRIMP|Crimping/i }).first()).toBeVisible({
      timeout: 20_000,
    });
  });
});

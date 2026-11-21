import { test, expect } from "@playwright/test";
import { annotateScenario, assertNoModuleCrash, expectModuleTitle, gotoImsModule } from "./helpers";

const marker = () => `E2E-${Date.now()}`;

test.describe("IMS business journeys (JustTestX)", () => {
  test("JX-INV-NEW — new invoice editor opens", async ({ page }, testInfo) => {
    annotateScenario(testInfo, "JX-INV-NEW", "Open New invoice editor from sales deep link", {
      mutates: "false",
      manualChecks: "Customer picker | Line add | GST totals",
    });
    await gotoImsModule(page, "/ims?m=sales&intent=new");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, /New invoice|Edit draft/i);
    await expect(page.getByRole("button", { name: /Save draft/i })).toBeVisible();
  });

  test("JX-PO-NEW — new purchase order editor opens", async ({ page }, testInfo) => {
    annotateScenario(testInfo, "JX-PO-NEW", "Open New purchase order editor", {
      mutates: "false",
      manualChecks: "Supplier picker | Line qty/rate | Approval threshold",
    });
    await gotoImsModule(page, "/ims?m=purchase&intent=new");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, /New purchase order|Edit /i);
  });

  test("JX-REPORT-RANGE — reports module usable over seeded data", async ({ page }, testInfo) => {
    annotateScenario(testInfo, "JX-REPORT-RANGE", "Reports page accepts a wide date range over seeded years", {
      mutates: "false",
      manualChecks: "24-month window | Export",
    });
    await gotoImsModule(page, "/ims?m=reports");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Reports");
    // Seeded reports / report types should leave the page with interactive content.
    await expect(page.locator(".ims-page-title")).toBeVisible();
    await expect(page.locator("main").getByText(/report|stock|sales|purchase|export/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("JX-STOCK-IN — post small stock in with E2E marker", async ({ page }, testInfo) => {
    const note = marker();
    annotateScenario(testInfo, "JX-STOCK-IN", "Post a small Stock In against a seeded SKU (E2E-marked)", {
      mutates: "true",
      marker: note,
      manualChecks: `History shows ${note} | Full Stock qty +1`,
    });
    await gotoImsModule(page, "/ims?m=stockin");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Stock In");

    const search = page.getByLabel("Search items");
    await search.fill("JX-CRIMP");
    await expect(page.locator('[role="listbox"][aria-label="Items"] button').first()).toBeVisible({
      timeout: 20_000,
    });
    await page.locator('[role="listbox"][aria-label="Items"] button').first().click();
    await expect(page.getByText(/Crimping|JX-CRIMP/i).first()).toBeVisible();

    await page.getByLabel("Notes").fill(note);
    await page.getByPlaceholder(/INV-|GRN|e\.g\./i).first().fill(note);

    await page.getByRole("button", { name: /Post stock in/i }).click();
    await expect(page.getByText(/Stock received|posted|success/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test("JX-TICKET — raise helpdesk ticket with E2E marker", async ({ page }, testInfo) => {
    const note = marker();
    annotateScenario(testInfo, "JX-TICKET", "Raise a Help Desk ticket with E2E marker", {
      mutates: "true",
      marker: note,
      manualChecks: `Ticket ${note} in list`,
    });
    await gotoImsModule(page, "/ims?m=helpdesk");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Help Desk & FAQ");

    await page.getByRole("button", { name: /New ticket|Raise a ticket/i }).first().click();
    // Dialog title is a styled div (aria-labelledby), not a heading.
    const dialog = page.getByRole("dialog", { name: /Raise a ticket/i });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.getByLabel("Subject").fill(`E2E ticket ${note}`);
    await dialog.getByLabel("Details").fill(`Automated IMS journey coverage ${note}`);
    await dialog.getByRole("button", { name: /Raise ticket/i }).click();
    await expect(page.getByText(note).first()).toBeVisible({ timeout: 20_000 });
  });
});

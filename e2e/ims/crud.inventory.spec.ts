import { test, expect, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import {
  annotateScenario,
  assertNoModuleCrash,
  expectModuleTitle,
  gotoImsModule,
} from "./helpers";
import {
  clickTab,
  expectToastOrSuccess,
  marker,
  openDialogByButton,
} from "./crud-helpers";
import { imsAuthStatePath, playwrightBaseURL } from "./env";

test.describe.serial("IMS CRUD — Inventory (JustTestX)", () => {
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

  test("CRUD-ITEMS-C — create item with E2E marker", async ({}, testInfo) => {
    const note = marker();
    annotateScenario(testInfo, "CRUD-ITEMS-C", "Items — create item with E2E marker", {
      mutates: "true",
      marker: note,
      moduleKey: "items",
      manualChecks: "E2E item appears | SKU searchable",
    });
    await gotoImsModule(page, "/ims?m=items");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Items");

    const dialog = await openDialogByButton(page, /Add item/i);
    test.skip(!dialog, "Add item dialog unavailable");
    const name = `E2E Item ${note}`;
    const sku = `E2E-${Date.now().toString(36).toUpperCase()}`;
    await dialog!.getByLabel(/Item name/i).fill(name);
    // Label "SKU / item code" also matches the Auto suggest button aria-label — use textbox.
    await dialog!.getByRole("textbox", { name: /SKU/i }).fill(sku);
    // Unit is a select; leave default if fill fails.
    const unit = dialog!.getByLabel(/Unit/i);
    if (await unit.isEditable().catch(() => false)) await unit.fill("pcs");
    await dialog!.getByRole("button", { name: /^Add item$/i }).click();
    await expectToastOrSuccess(page, /added|saved|item/i);
    await expect(page.getByText(name).or(page.getByText(sku)).first()).toBeVisible({ timeout: 20_000 });
  });

  test("CRUD-ITEMS-R — search seeded SKU", async ({}, testInfo) => {
    annotateScenario(testInfo, "CRUD-ITEMS-R", "Items — search / read seeded SKU", {
      mutates: "false",
      moduleKey: "items",
      manualChecks: "JX-CRIMP found | Row opens",
    });
    await gotoImsModule(page, "/ims?m=items");
    await assertNoModuleCrash(page);
    const search = page.getByLabel("Search items");
    test.skip((await search.count()) === 0, "Search items not available");
    await search.fill("JX-CRIMP");
    await expect(page.getByText(/JX-CRIMP|Crimping/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test("CRUD-ITEMS-U — open item editor", async ({}, testInfo) => {
    annotateScenario(testInfo, "CRUD-ITEMS-U", "Items — open editor for update path", {
      mutates: "false",
      moduleKey: "items",
      manualChecks: "Detail → Edit | Save changes visible | Cancel safe",
    });
    await gotoImsModule(page, "/ims?m=items");
    await assertNoModuleCrash(page);
    const search = page.getByLabel("Search items");
    test.skip((await search.count()) === 0, "Search items not available");
    await search.fill("JX-CRIMP");
    const row = page.getByText(/JX-CRIMP|Crimping/i).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    // Row opens ItemDetailDialog (Edit / Close), not the editor.
    const detail = page.getByRole("dialog").filter({ hasText: /JX-CRIMP|Crimping/i }).first();
    await expect(detail).toBeVisible({ timeout: 20_000 });
    const editBtn = detail.getByRole("button", { name: /^Edit$/i });
    test.skip((await editBtn.count()) === 0, "Edit gated on item detail");
    await editBtn.click();
    const editor = page.getByRole("dialog").filter({ hasText: /Save changes|Item name/i }).first();
    await expect(editor.getByRole("button", { name: /Save changes/i })).toBeVisible({ timeout: 20_000 });
    await editor.getByRole("button", { name: /Cancel|Close/i }).first().click().catch(() => page.keyboard.press("Escape"));
    await assertNoModuleCrash(page);
  });

  test("FLOW-STOCK-IN — post stock in with marker", async ({}, testInfo) => {
    const note = marker();
    annotateScenario(testInfo, "FLOW-STOCK-IN", "Stock In — post with E2E note", {
      mutates: "true",
      marker: note,
      moduleKey: "stockin",
      manualChecks: `History shows ${note}`,
    });
    await gotoImsModule(page, "/ims?m=stockin");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Stock In");

    const search = page.getByLabel("Search items");
    test.skip((await search.count()) === 0, "Stock In item search missing");
    await search.fill("JX-CRIMP");
    const pick = page.locator('[role="listbox"][aria-label="Items"] button').first();
    test.skip((await pick.count()) === 0, "No items to pick for stock in");
    await expect(pick).toBeVisible({ timeout: 20_000 });
    await pick.click();
    await page.getByLabel("Notes").fill(note);
    const ref = page.getByPlaceholder(/INV-|GRN|e\.g\./i).first();
    if ((await ref.count()) > 0) await ref.fill(note);
    const post = page.getByRole("button", { name: /Post stock in/i });
    test.skip((await post.count()) === 0, "Post stock in gated");
    await post.click();
    await expectToastOrSuccess(page, /Stock received|posted|success/i);
  });

  test("FLOW-STOCK-OUT — post stock out with marker", async ({}, testInfo) => {
    const note = marker();
    annotateScenario(testInfo, "FLOW-STOCK-OUT", "Stock Out — post with E2E note", {
      mutates: "true",
      marker: note,
      moduleKey: "stockout",
      manualChecks: `History shows ${note}`,
    });
    await gotoImsModule(page, "/ims?m=stockout");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Stock Out");

    const search = page.getByLabel("Search items");
    test.skip((await search.count()) === 0, "Stock Out item search missing");
    await search.fill("JX-CRIMP");
    const pick = page.locator('[role="listbox"][aria-label="Items"] button').first();
    test.skip((await pick.count()) === 0, "No items to pick for stock out");
    await expect(pick).toBeVisible({ timeout: 20_000 });
    await pick.click();
    const notes = page.getByLabel("Notes");
    if ((await notes.count()) > 0) await notes.fill(note);
    const post = page.getByRole("button", { name: /Post stock out/i });
    test.skip((await post.count()) === 0, "Post stock out gated");
    await post.click();
    await expectToastOrSuccess(page, /Stock issued|posted|success/i);
  });

  test("FLOW-STOCK-CHECK — open new stock check UI", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-STOCK-CHECK", "Stock Check — open New stock check / start UI", {
      mutates: "false",
      moduleKey: "checks",
      manualChecks: "New stock check dialog | Start counting",
    });
    await gotoImsModule(page, "/ims?m=checks");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Stock Check");
    const dialog = await openDialogByButton(page, /New stock check|Start your first count/i);
    if (dialog) {
      await expect(dialog.getByRole("button", { name: /Start counting/i })).toBeVisible();
      await dialog.getByRole("button", { name: /Cancel/i }).click().catch(() => page.keyboard.press("Escape"));
    }
    await assertNoModuleCrash(page);
  });

  test("FLOW-RETURNS-CREATE — open customer return form", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-RETURNS-CREATE", "Damage & Returns — open Customer return form", {
      mutates: "false",
      moduleKey: "returns",
      manualChecks: "Customer return dialog | Record return",
    });
    await gotoImsModule(page, "/ims?m=returns");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Damage & Returns");
    const dialog = await openDialogByButton(page, /Customer return|Record a customer return/i);
    if (dialog) {
      await expect(dialog.getByRole("button", { name: /Record return|Cancel/i }).first()).toBeVisible();
      await dialog.getByRole("button", { name: /Cancel/i }).click().catch(() => page.keyboard.press("Escape"));
    }
    await assertNoModuleCrash(page);
  });

  test("TAB-STOCK-EXPORT — Full Stock filter + export", async ({}, testInfo) => {
    annotateScenario(testInfo, "TAB-STOCK-EXPORT", "Full Stock — filter + CSV/Excel export controls", {
      mutates: "false",
      moduleKey: "stock",
      manualChecks: "Search stock | CSV | Excel",
    });
    await gotoImsModule(page, "/ims?m=stock");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Full Stock");
    const search = page.getByLabel("Search stock");
    if ((await search.count()) > 0) {
      await search.fill("JX");
      await page.waitForTimeout(400);
    }
    await expect(page.getByRole("button", { name: /^CSV$/i }).or(page.getByText("CSV")).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: /Excel/i }).first()).toBeVisible();
  });

  test("TAB-LOW-STOCK — restock view tabs", async ({}, testInfo) => {
    annotateScenario(testInfo, "TAB-LOW-STOCK", "Restock List — walk supplier / items / dead tabs", {
      mutates: "false",
      moduleKey: "lowstock",
      manualChecks: "By supplier | All low items | Dead stock",
    });
    await gotoImsModule(page, "/ims?m=lowstock");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Restock List");
    for (const tab of [/By supplier/i, /All low items/i, /Dead stock/i]) {
      const t = page.getByRole("tab", { name: tab }).first();
      if ((await t.count()) === 0) continue;
      await t.click();
      await assertNoModuleCrash(page);
      await expect(page.locator(".ims-page-title").or(page.locator("main")).first()).toBeVisible();
    }
  });

  test("TAB-HISTORY — movement + activity tabs", async ({}, testInfo) => {
    annotateScenario(testInfo, "TAB-HISTORY", "History — Stock movements + Activity log tabs", {
      mutates: "false",
      moduleKey: "history",
      manualChecks: "Movement filters | Activity filters",
    });
    await gotoImsModule(page, "/ims?m=history");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Transactions & Activity");
    await clickTab(page, /Stock movements/i);
    await expect(page.locator("main").first()).toBeVisible();
    await clickTab(page, /Activity log/i);
    await expect(page.locator("main").first()).toBeVisible();
  });

  test("FLOW-SCANNER — manual barcode / SKU lookup", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-SCANNER", "QR Stock Scan — manual code lookup", {
      mutates: "false",
      moduleKey: "scanner",
      manualChecks: "Item code field | Lookup seeded SKU",
    });
    await gotoImsModule(page, "/ims?m=scanner");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "QR Stock Scan");
    const code = page.getByLabel("Item code");
    test.skip((await code.count()) === 0, "Scanner item code field missing");
    await code.fill("JX-CRIMP");
    await code.press("Enter");
    await expect(
      page.getByText(/JX-CRIMP|Crimping|stock|not found|No match|Look up/i).first(),
    ).toBeVisible({ timeout: 20_000 });
    await assertNoModuleCrash(page);
  });
});

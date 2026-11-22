import { test, expect, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import {
  annotateScenario,
  assertNoModuleCrash,
  expectModuleTitle,
  gotoImsModule,
} from "./helpers";
import {
  addCatalogLine,
  expectDraftSaveOrValidation,
  expectToastOrSuccess,
  marker,
  openDialogByButton,
  pickPartySuggest,
} from "./crud-helpers";
import { imsAuthStatePath, playwrightBaseURL } from "./env";

test.describe.serial("IMS CRUD — Purchasing (JustTestX)", () => {
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

  test("CRUD-PARTY-SUP — add supplier with E2E marker", async ({}, testInfo) => {
    const note = marker();
    annotateScenario(testInfo, "CRUD-PARTY-SUP", "Parties — add supplier with E2E marker", {
      mutates: "true",
      marker: note,
      moduleKey: "parties",
      manualChecks: `Supplier ${note} searchable`,
    });
    await gotoImsModule(page, "/ims?m=parties");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Suppliers & Customers");

    const supplierTab = page.getByRole("tab", { name: /Suppliers/i }).first();
    if ((await supplierTab.count()) > 0) await supplierTab.click();

    const dialog = await openDialogByButton(page, /Add supplier/i);
    test.skip(!dialog, "Add supplier unavailable");
    const name = `E2E Supplier ${note}`;
    await dialog!.getByLabel(/Business name/i).fill(name);
    await dialog!.getByRole("button", { name: /Add supplier/i }).last().click();
    await expectToastOrSuccess(page, /Supplier added|added|saved/i);
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });
  });

  test("CRUD-PARTY-CUS — add customer with E2E marker", async ({}, testInfo) => {
    const note = marker();
    annotateScenario(testInfo, "CRUD-PARTY-CUS", "Parties — add customer with E2E marker", {
      mutates: "true",
      marker: note,
      moduleKey: "parties",
      manualChecks: `Customer ${note} in list`,
    });
    await gotoImsModule(page, "/ims?m=parties");
    await assertNoModuleCrash(page);

    const customerTab = page.getByRole("tab", { name: /Customers/i }).first();
    if ((await customerTab.count()) > 0) await customerTab.click();

    const dialog = await openDialogByButton(page, /Add customer/i);
    test.skip(!dialog, "Add customer unavailable");
    const name = `E2E Customer ${note}`;
    await dialog!.getByLabel(/Business name/i).fill(name);
    await dialog!.getByRole("button", { name: /Add customer/i }).last().click();
    await expectToastOrSuccess(page, /Customer added|added|saved/i);
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });
  });

  test("FLOW-PO-DRAFT — new PO draft create/save", async ({}, testInfo) => {
    const note = marker();
    annotateScenario(testInfo, "FLOW-PO-DRAFT", "Purchase Orders — new PO draft save", {
      mutates: "true",
      marker: note,
      moduleKey: "purchase",
      manualChecks: "New PO editor | Save draft",
    });
    await gotoImsModule(page, "/ims?m=purchase&intent=new");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, /New purchase order|Edit /i);

    await pickPartySuggest(page, "Havells");
    // Prefer supplier quick-add chip when present; otherwise catalog picker.
    const quick = page.locator(".ims-quickadd button").first();
    if ((await quick.count()) > 0) {
      await quick.click();
    } else {
      await addCatalogLine(page, "JX-CRIMP");
    }

    const notes = page.getByLabel(/Notes to supplier/i);
    if ((await notes.count()) > 0) await notes.fill(note);

    const save = page.getByRole("button", { name: /Save draft/i });
    test.skip((await save.count()) === 0, "Save draft not available on PO");
    await save.click();
    await expectDraftSaveOrValidation(page, /Draft saved|saved/i);
    await assertNoModuleCrash(page);
  });

  test("TAB-APPROVALS — walk approval queues", async ({}, testInfo) => {
    annotateScenario(testInfo, "TAB-APPROVALS", "Approvals — walk PO / bills / checks / history tabs", {
      mutates: "false",
      moduleKey: "approvals",
      manualChecks: "Each queue loads without crash",
    });
    await gotoImsModule(page, "/ims?m=approvals");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Approvals");

    for (const tab of [/Purchase orders/i, /^Bills/i, /Stock checks/i, /Delivery challans/i, /^History$/i]) {
      const t = page.getByRole("tab", { name: tab }).first();
      if ((await t.count()) === 0) continue;
      await t.click();
      await assertNoModuleCrash(page);
      await expect(page.locator("main").or(page.locator(".ims-app")).first()).toBeVisible();
    }
  });
});

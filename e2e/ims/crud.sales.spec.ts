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
  clickTab,
  expectDraftSaveOrValidation,
  marker,
  pickPartySuggest,
} from "./crud-helpers";
import { imsAuthStatePath, playwrightBaseURL } from "./env";

test.describe.serial("IMS CRUD — Sales & Finance (JustTestX)", () => {
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

  test("FLOW-INV-DRAFT — new invoice draft save", async ({}, testInfo) => {
    const note = marker();
    annotateScenario(testInfo, "FLOW-INV-DRAFT", "Sales — new invoice draft save", {
      mutates: "true",
      marker: note,
      moduleKey: "sales",
      manualChecks: "Customer * | Save draft",
    });
    await gotoImsModule(page, "/ims?m=sales&intent=new");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, /New invoice|Edit draft/i);

    await pickPartySuggest(page, "Cascade");
    await addCatalogLine(page, "JX-CRIMP");

    const notes = page.getByLabel(/Notes/i).first();
    if ((await notes.count()) > 0) await notes.fill(note);

    const save = page.getByRole("button", { name: /Save draft/i });
    test.skip((await save.count()) === 0, "Save draft missing");
    await save.click();
    await expectDraftSaveOrValidation(page, /Draft saved|saved/i);
    await assertNoModuleCrash(page);
  });

  test("TAB-SALES-POS — invoices and POS tabs", async ({}, testInfo) => {
    annotateScenario(testInfo, "TAB-SALES-POS", "Sales — Invoices + POS counter tabs", {
      mutates: "false",
      moduleKey: "sales",
      manualChecks: "Invoices list | POS counter",
    });
    await gotoImsModule(page, "/ims?m=sales");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Invoices & Billing");

    await clickTab(page, /^Invoices/i);
    await expect(page.getByRole("button", { name: /New invoice/i }).first()).toBeVisible({ timeout: 15_000 });

    const pos = page.getByRole("tab", { name: /POS counter/i }).first();
    test.skip((await pos.count()) === 0, "POS tab not enabled");
    await pos.click();
    await assertNoModuleCrash(page);
    await expect(page.locator("main").first()).toBeVisible();
  });

  test("UI-AR-RECORD — AR record payment UI", async ({}, testInfo) => {
    annotateScenario(testInfo, "UI-AR-RECORD", "Accounts Receivable — record payment UI visible", {
      mutates: "false",
      moduleKey: "receivables",
      manualChecks: "Record payment | Promises UI",
    });
    await gotoImsModule(page, "/ims?m=receivables");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Accounts Receivable");
    await expect(
      page.getByRole("button", { name: /Record payment/i }).or(page.getByText(/Record payment|Promises due|Aging/i)).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("TAB-AP — payables bills + payment runs", async ({}, testInfo) => {
    annotateScenario(testInfo, "TAB-AP", "Accounts Payable — Bills + Payment runs tabs", {
      mutates: "false",
      moduleKey: "payables",
      manualChecks: "Bills | Payment runs",
    });
    await gotoImsModule(page, "/ims?m=payables");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Accounts Payable");
    await clickTab(page, /^Bills/i);
    await expect(page.locator("main").first()).toBeVisible();
    const runs = page.getByRole("tab", { name: /Payment runs/i }).first();
    if ((await runs.count()) > 0) {
      await runs.click();
      await assertNoModuleCrash(page);
    }
  });

  test("UI-LEDGER-PARTY — open party statement", async ({}, testInfo) => {
    annotateScenario(testInfo, "UI-LEDGER-PARTY", "Ledger — open party statement", {
      mutates: "false",
      moduleKey: "ledger",
      manualChecks: "Cascade party | Statement opens",
    });
    await gotoImsModule(page, "/ims?m=ledger");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Credit / Debit Ledger");

    const find = page.getByLabel("Find party");
    if ((await find.count()) > 0) {
      await find.fill("Cascade");
    }
    const party = page
      .getByRole("button", { name: /Statement for Cascade|Cascade/i })
      .or(page.getByText(/Cascade/i))
      .first();
    test.skip((await party.count()) === 0, "Cascade party not in ledger balances");
    await party.click();
    await assertNoModuleCrash(page);
    await expect(
      page.getByRole("dialog").or(page.getByText(/Statement|Cascade|balance/i)).first(),
    ).toBeVisible({ timeout: 20_000 });
    // Leave statement closed so the next module nav is not blocked by overlay.
    await page.keyboard.press("Escape").catch(() => undefined);
    const close = page.getByRole("dialog").getByRole("button", { name: /Close|Cancel|Back/i }).first();
    if ((await close.count()) > 0) await close.click({ force: true }).catch(() => undefined);
  });

  test("UI-CLOSING-FORM — day close form open", async ({}, testInfo) => {
    annotateScenario(testInfo, "UI-CLOSING-FORM", "Daily Closing — day close form open", {
      mutates: "false",
      moduleKey: "closing",
      manualChecks: "Day close | History",
    });
    await gotoImsModule(page, "/ims?m=closing");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Daily Closing");
    await clickTab(page, /Day close/i);
    await expect(page.locator("main").first()).toBeVisible();
    const hist = page.getByRole("tab", { name: /^History$/i }).first();
    if ((await hist.count()) > 0) {
      await hist.click();
      await assertNoModuleCrash(page);
    }
  });
});

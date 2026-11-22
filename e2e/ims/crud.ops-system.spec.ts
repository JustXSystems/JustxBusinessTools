import { test, expect, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import {
  annotateScenario,
  assertNoModuleCrash,
  expectModuleTitle,
  gotoImsModule,
} from "./helpers";
import { clickTab } from "./crud-helpers";
import { imsAuthStatePath, playwrightBaseURL } from "./env";

test.describe.serial("IMS CRUD — Ops & System (JustTestX)", () => {
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

  test("TAB-FIELD — Onsite Track tabs", async ({}, testInfo) => {
    annotateScenario(testInfo, "TAB-FIELD", "Onsite Track — Today / Tasks / Visit history / Day timeline", {
      mutates: "false",
      moduleKey: "field",
      manualChecks: "Each field tab loads",
    });
    await gotoImsModule(page, "/ims?m=field");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Onsite Track");
    for (const tab of [/^Today$/i, /^Tasks$/i, /Visit history/i, /Day timeline/i]) {
      const t = page.getByRole("tab", { name: tab }).first();
      if ((await t.count()) === 0) continue;
      await t.click();
      await assertNoModuleCrash(page);
      await expect(page.locator("main").first()).toBeVisible();
    }
  });

  test("TAB-HELPDESK-FAQ — tickets + FAQ", async ({}, testInfo) => {
    annotateScenario(testInfo, "TAB-HELPDESK-FAQ", "Helpdesk — Tickets + FAQ tabs", {
      mutates: "false",
      moduleKey: "helpdesk",
      manualChecks: "FAQ accordion | New ticket",
    });
    await gotoImsModule(page, "/ims?m=helpdesk");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Help Desk & FAQ");
    await clickTab(page, /^Tickets$/i);
    await expect(page.getByRole("button", { name: /New ticket/i }).first()).toBeVisible({ timeout: 15_000 });
    await clickTab(page, /^FAQ$/i);
    await expect(page.locator("main").getByText(/FAQ|question|help/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("TAB-SETTINGS-ALL — all settings subtabs", async ({}, testInfo) => {
    annotateScenario(testInfo, "TAB-SETTINGS-ALL", "Settings — all subtabs", {
      mutates: "false",
      moduleKey: "settings",
      manualChecks: "Business through Data tabs",
    });
    await gotoImsModule(page, "/ims?m=settings");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Settings");

    const tabs = [
      /^Business$/i,
      /Documents & numbering/i,
      /Team & access/i,
      /Role permissions/i,
      /Catalog lists/i,
      /^Reminders$/i,
      /Field map/i,
      /^Data$/i,
    ];
    for (const tab of tabs) {
      const t = page.getByRole("tab", { name: tab }).first();
      if ((await t.count()) === 0) continue;
      await t.click();
      await assertNoModuleCrash(page);
      await expect(page.locator("main").or(page.locator(".ims-app")).first()).toBeVisible();
    }
  });

  test("TAB-INTEGRATIONS — Tally / POS / Sync log", async ({}, testInfo) => {
    annotateScenario(testInfo, "TAB-INTEGRATIONS", "Integrations — Tally / POS / Sync log", {
      mutates: "false",
      moduleKey: "integrations",
      manualChecks: "Tally ERP | POS | Sync log",
    });
    await gotoImsModule(page, "/ims?m=integrations");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Tally & POS");
    for (const tab of [/Tally ERP/i, /^POS$/i, /Sync log/i]) {
      const t = page.getByRole("tab", { name: tab }).first();
      if ((await t.count()) === 0) continue;
      await t.click();
      await assertNoModuleCrash(page);
      await expect(page.locator("main").first()).toBeVisible();
    }
  });

  test("UI-CONNECT-TILES — connected tools tiles", async ({}, testInfo) => {
    annotateScenario(testInfo, "UI-CONNECT-TILES", "Connected Tools — tiles visible", {
      mutates: "false",
      moduleKey: "connect",
      manualChecks: "Tools tiles | Linked records",
    });
    await gotoImsModule(page, "/ims?m=connect");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Connected Tools");
    await clickTab(page, /^Tools$/i);
    await expect(page.locator("main").first()).toBeVisible();
    const links = page.getByRole("tab", { name: /Linked records/i }).first();
    if ((await links.count()) > 0) {
      await links.click();
      await assertNoModuleCrash(page);
    }
  });

  test("UI-MORE-FAVS — favourites controls", async ({}, testInfo) => {
    annotateScenario(testInfo, "UI-MORE-FAVS", "More Actions — favourites toggle visible", {
      mutates: "false",
      moduleKey: "more",
      manualChecks: "Edit favourites | Show favourites only",
    });
    await gotoImsModule(page, "/ims?m=more");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "More Actions");
    await expect(
      page.getByRole("button", { name: /Edit favourites|Done/i }).or(page.getByLabel(/Show favourites only/i)).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("FLOW-REPORTS-RUN — reports catalog UI", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-REPORTS-RUN", "Reports — catalog / run UI", {
      mutates: "false",
      moduleKey: "reports",
      manualChecks: "All reports | Saved & scheduled",
    });
    await gotoImsModule(page, "/ims?m=reports");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Reports");
    const catalog = page.getByRole("tab", { name: /All reports/i }).first();
    if ((await catalog.count()) > 0) await catalog.click();
    await expect(page.locator("main").getByText(/report|stock|sales|purchase|export/i).first()).toBeVisible({
      timeout: 20_000,
    });
    const saved = page.getByRole("tab", { name: /Saved & scheduled/i }).first();
    if ((await saved.count()) > 0) {
      await saved.click();
      await assertNoModuleCrash(page);
    }
  });

  test("TAB-GST — GST section tabs", async ({}, testInfo) => {
    annotateScenario(testInfo, "TAB-GST", "GST / HSN — all GST section tabs", {
      mutates: "false",
      moduleKey: "gst",
      manualChecks: "GSTR-1 through Item HSN",
    });
    await gotoImsModule(page, "/ims?m=gst");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "GST / HSN");
    for (const tab of [/GSTR-1/i, /GSTR-3B/i, /HSN summary/i, /Rate-wise/i, /Item HSN/i]) {
      const t = page.getByRole("tab", { name: tab }).first();
      if ((await t.count()) === 0) continue;
      await t.click();
      await assertNoModuleCrash(page);
      await expect(page.locator("main").first()).toBeVisible();
    }
  });

  test("TAB-AUDIT — auditor workspace tabs", async ({}, testInfo) => {
    annotateScenario(testInfo, "TAB-AUDIT", "Auditing / CA — walk auditor workspace tabs", {
      mutates: "false",
      moduleKey: "audit",
      manualChecks: "Overview through Access",
    });
    await gotoImsModule(page, "/ims?m=audit");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Auditing / CA");
    const tabs = [
      /^Overview$/i,
      /^Findings$/i,
      /^Ledgers$/i,
      /Financial statements/i,
      /Bank reconciliation/i,
      /^GST$/i,
      /^Documents$/i,
      /Flags & queries/i,
      /Audit trail/i,
      /^Integrations$/i,
      /^Access$/i,
    ];
    for (const tab of tabs) {
      const t = page.getByRole("tab", { name: tab }).first();
      if ((await t.count()) === 0) continue;
      await t.click();
      await assertNoModuleCrash(page);
      await expect(page.locator("main").or(page.locator(".ims-app")).first()).toBeVisible();
    }
  });
});

import { test, expect, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import {
  annotateScenario,
  assertNoModuleCrash,
  expectModuleTitle,
  gotoImsModule,
} from "./helpers";
import { clickTab, openDialogByButton } from "./crud-helpers";
import { imsAuthStatePath, playwrightBaseURL } from "./env";

test.describe.serial("IMS CRUD — BOM (JustTestX)", () => {
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

  test("UI-BOM-LIST — Create / Maintain list open", async ({}, testInfo) => {
    annotateScenario(testInfo, "UI-BOM-LIST", "BOM Create / Maintain — list open", {
      mutates: "false",
      moduleKey: "bom",
      manualChecks: "BOM list | New BOM CTA",
    });
    await gotoImsModule(page, "/ims?m=bom");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Create / Maintain");
    await expect(
      page.getByRole("button", { name: /New BOM/i }).or(page.getByText(/BOM|package|compose/i)).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("UI-BOM-NEW — New BOM builder open", async ({}, testInfo) => {
    annotateScenario(testInfo, "UI-BOM-NEW", "BOM — New BOM builder open", {
      mutates: "false",
      moduleKey: "bom",
      manualChecks: "New BOM title | Compose lines",
    });
    await gotoImsModule(page, "/ims?m=bom");
    await assertNoModuleCrash(page);
    const newBom = page.getByRole("button", { name: /New BOM/i }).first();
    test.skip((await newBom.count()) === 0, "New BOM gated");
    await newBom.click();
    await assertNoModuleCrash(page);
    await expect(
      page.locator(".ims-page-title").or(page.getByRole("heading", { name: /New BOM/i })).first(),
    ).toContainText(/New BOM|Edit|BOM/i);
  });

  test("UI-PKG-NEW — New package open", async ({}, testInfo) => {
    annotateScenario(testInfo, "UI-PKG-NEW", "Packages — New package open", {
      mutates: "false",
      moduleKey: "bomPackages",
      manualChecks: "New package editor | Cancel safe",
    });
    await gotoImsModule(page, "/ims?m=bomPackages");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Packages");
    const btn = page.getByRole("button", { name: /New package/i }).first();
    test.skip((await btn.count()) === 0, "New package gated");
    await btn.click();
    await assertNoModuleCrash(page);
    await expect(
      page.getByText(/New package|Edit package/i).or(page.locator(".ims-page-title")).first(),
    ).toBeVisible({ timeout: 20_000 });
    const cancel = page.getByRole("button", { name: /Cancel|Back|Close/i }).first();
    if ((await cancel.count()) > 0) await cancel.click().catch(() => undefined);
  });

  test("UI-RATE-CARDS — list + new rate card", async ({}, testInfo) => {
    annotateScenario(testInfo, "UI-RATE-CARDS", "Rate Cards — list + New rate card", {
      mutates: "false",
      moduleKey: "bomRateCards",
      manualChecks: "Rate cards list | New rate card",
    });
    await gotoImsModule(page, "/ims?m=bomRateCards");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Rate Cards");
    const dialog = await openDialogByButton(page, /New rate card|Create first card/i);
    if (dialog) {
      await expect(dialog.getByText(/New rate card|Edit rate card/i).or(dialog).first()).toBeVisible();
      await dialog.getByRole("button", { name: /Cancel|Close/i }).first().click().catch(() => page.keyboard.press("Escape"));
    }
    await assertNoModuleCrash(page);
  });

  test("TAB-BOM-DC — delivery challans + returns tabs", async ({}, testInfo) => {
    annotateScenario(testInfo, "TAB-BOM-DC", "DC & Returns — Delivery challans + Returns tabs", {
      mutates: "false",
      moduleKey: "bomDc",
      manualChecks: "Challans | Returns",
    });
    await gotoImsModule(page, "/ims?m=bomDc");
    await assertNoModuleCrash(page);
    await expect(page.locator(".ims-page-title").or(page.locator(".ims-hero-title")).first()).toBeVisible();
    await clickTab(page, /Delivery challans/i);
    await expect(page.locator("main").first()).toBeVisible();
    const ret = page.getByRole("tab", { name: /^Returns/i }).first();
    if ((await ret.count()) > 0) {
      await ret.click();
      await assertNoModuleCrash(page);
    }
  });

  test("UI-BOM-COMPARE — compare pickers visible", async ({}, testInfo) => {
    annotateScenario(testInfo, "UI-BOM-COMPARE", "Compare — pickers visible", {
      mutates: "false",
      moduleKey: "bomCompare",
      manualChecks: "Packages mode | Left/right pickers",
    });
    await gotoImsModule(page, "/ims?m=bomCompare");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Compare");
    await expect(
      page.getByRole("tab", { name: /Packages/i }).or(page.getByText(/Pick two|Compare|Filter packages/i)).first(),
    ).toBeVisible({ timeout: 20_000 });
    const pkgs = page.getByRole("tab", { name: /^Packages$/i }).first();
    if ((await pkgs.count()) > 0) await pkgs.click();
    const docs = page.getByRole("tab", { name: /Customer BOMs/i }).first();
    if ((await docs.count()) > 0) {
      await docs.click();
      await assertNoModuleCrash(page);
    }
  });
});

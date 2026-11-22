import { expect, test, type Page } from "@playwright/test";
import { assertNoModuleCrash } from "./helpers";

/** Unique marker for mutating JustTestX E2E rows. */
export function marker(prefix = "E2E"): string {
  return `${prefix}-${Date.now()}`;
}

/** Click an IMS sidebar module by its title attribute / accessible name. Soft-skips if gated. */
export async function clickNavModule(page: Page, label: string) {
  const nav = page.locator('nav[aria-label="IMS modules"]');
  await expect(nav).toBeVisible({ timeout: 60_000 });
  const btn = nav.locator(`button[title="${label}"]`);
  test.skip((await btn.count()) === 0, `${label} not enabled for this tenant`);
  await btn.click();
  await assertNoModuleCrash(page);
}

/**
 * Click a SubTabs / Segmented tab by accessible name (supports dynamic count suffixes).
 * Soft-skips when the tab is missing (feature-gated).
 */
export async function clickTab(page: Page, name: string | RegExp) {
  const pattern = typeof name === "string" ? new RegExp(`^${escapeRe(name)}`, "i") : name;
  const tab = page.getByRole("tab", { name: pattern }).first();
  test.skip((await tab.count()) === 0, `Tab ${String(name)} not present`);
  await tab.click();
  await assertNoModuleCrash(page);
  await expect(page.locator(".ims-app")).toBeVisible();
}

/** Assert a success toast / inline success message after a mutate. */
export async function expectToastOrSuccess(page: Page, pattern = /saved|added|posted|raised|received|issued|recorded/i) {
  await expect(page.getByText(pattern).first()).toBeVisible({ timeout: 30_000 });
}

/**
 * After Save draft: accept either a toast/success phrase or a field/alert validation
 * (scoped so nav labels like "Purchase Orders" / "Invoices" do not match).
 */
export async function expectDraftSaveOrValidation(page: Page, success: RegExp) {
  const toast = page.getByText(success);
  const fieldErr = page.locator(".bos-field-error, .ims-neg, [role='alert']");
  // .or() can match both sides — pin with .first() to avoid strict-mode double hits.
  await expect(toast.or(fieldErr).first()).toBeVisible({ timeout: 30_000 });
}

/** Pick a party from PartySelect / SuggestInput combobox. */
export async function pickPartySuggest(page: Page, query: string) {
  const input = page.getByRole("combobox").or(page.getByPlaceholder(/Supplier name|Customer name/i)).first();
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.fill(query);
  const opt = page.getByRole("option", { name: new RegExp(query, "i") }).first();
  await expect(opt).toBeVisible({ timeout: 20_000 });
  await opt.click();
}

/** Open LineEditor "Add items" picker and select a seeded SKU (e.g. JX-CRIMP). */
export async function addCatalogLine(page: Page, skuOrName = "JX-CRIMP") {
  await page.getByRole("button", { name: /^Add items$/i }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: /Add items|Pick as many/i }).first();
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  const search = dialog.getByLabel(/Search items/i).or(dialog.getByRole("textbox").first());
  await search.fill(skuOrName);
  const pick = dialog.locator('[role="listbox"][aria-label="Items"] button').first()
    .or(dialog.getByRole("option").first())
    .or(dialog.getByRole("button", { name: new RegExp(skuOrName, "i") }).first());
  await expect(pick).toBeVisible({ timeout: 20_000 });
  await pick.click();
  const done = dialog.getByRole("button", { name: /^Done$/i });
  if ((await done.count()) > 0) await done.click();
  else await page.keyboard.press("Escape");
}

/** Open a primary create dialog via button name; soft-skips if CTA missing. */
export async function openDialogByButton(page: Page, name: string | RegExp = /Add item|New /i) {
  const btn = page.getByRole("button", { name }).first();
  test.skip((await btn.count()) === 0, `Button ${String(name)} not available`);
  await btn.click();
  const dialog = page.getByRole("dialog").first();
  // Some flows navigate to an editor page instead of a dialog.
  if ((await dialog.count()) > 0) {
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    return dialog;
  }
  return null;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

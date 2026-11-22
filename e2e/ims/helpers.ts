import { expect, test, type Page, type TestInfo } from "@playwright/test";
import path from "node:path";
import type { ImsModuleScenario } from "./modules.catalog";
import { apiPath, appPath, imsAuthStatePath } from "./env";
import { apiLoginJustTestX } from "../helpers/auth";

export function annotateScenario(testInfo: TestInfo, id: string, title: string, extra?: Record<string, string>) {
  testInfo.annotations.push({ type: "scenarioId", description: id });
  testInfo.annotations.push({ type: "scenarioTitle", description: title });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      testInfo.annotations.push({ type: k, description: v });
    }
  }
}

async function switchJustTestX(page: Page) {
  const BRANCH_NAME = process.env.E2E_IMS_BRANCH_NAME ?? "JustTestX";
  const me = await page.request.get(apiPath("/api/auth/me"));
  if (!me.ok()) return;
  const body = (await me.json()) as {
    user?: { businessProfileId: number; branches?: Array<{ id: number; businessName: string }> };
  };
  const user = body.user;
  if (!user) return;
  const target =
    user.branches?.find((b) => b.businessName === BRANCH_NAME) ||
    user.branches?.find((b) => b.businessName.toLowerCase().includes("justtestx"));
  if (target && target.id !== user.businessProfileId) {
    await page.request.post(apiPath("/api/auth/switch-branch"), {
      data: { businessProfileId: target.id },
    });
  }
}

/** Recover session via API (with backoff) — never hammer the login UI mid-suite. */
export async function recoverImsSession(page: Page, resumePath: string) {
  if (process.env.E2E_IMS_BASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.E2E_IMS_BASE_URL)) {
    console.log("[IMS E2E] session lost — cooling 60s before API re-login");
    await new Promise((r) => setTimeout(r, 60_000));
  }
  await apiLoginJustTestX(page.request);
  await switchJustTestX(page);
  await page.context().storageState({ path: path.join(process.cwd(), imsAuthStatePath()) });
  await page.goto(appPath(resumePath));
}

function isImsGateVisible(page: Page) {
  return page.getByRole("heading", { name: /Welcome to Justxsystems IMS/i }).isVisible({ timeout: 1_500 });
}

/** Wait until IMS shell is up (nav + main content, not gate / error). */
export async function expectImsShell(page: Page, resumePath = "/ims") {
  if (await isImsGateVisible(page).catch(() => false)) {
    await recoverImsSession(page, resumePath);
  }
  if (page.url().includes("/login")) {
    await recoverImsSession(page, resumePath);
  }
  await expect(page.getByLabel("IMS modules")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".ims-app")).toBeVisible();
  await expect(page.getByText(/session has expired|UNAUTHENTICATED/i)).toHaveCount(0);
}

/** Close open dialogs / overlays so nav clicks are not intercepted. */
export async function dismissImsOverlays(page: Page) {
  for (let i = 0; i < 3; i++) {
    const openOverlay = page.locator(".bos-overlay.is-open");
    if ((await openOverlay.count()) === 0 || !(await openOverlay.first().isVisible().catch(() => false))) break;
    const close = page.getByRole("dialog").getByRole("button", { name: /Close|Cancel|Done/i }).first();
    if ((await close.count()) > 0 && (await close.isVisible().catch(() => false))) {
      await close.click().catch(() => undefined);
    } else {
      await page.keyboard.press("Escape").catch(() => undefined);
    }
    await page.waitForTimeout(200);
  }
}

function currentModuleKey(page: Page): string | null {
  try {
    return new URL(page.url()).searchParams.get("m");
  } catch {
    return null;
  }
}

export async function gotoImsModule(page: Page, pathAndQuery: string) {
  const target = appPath(pathAndQuery);
  const onIms = page.url().includes("/ims");
  const q = new URL(pathAndQuery, "http://local");
  const m = q.searchParams.get("m");
  const intent = q.searchParams.get("intent");

  // Prefer SPA sidebar navigation when already inside IMS (no full reload / auth churn).
  if (onIms && !intent) {
    await dismissImsOverlays(page);
    if (!m) {
      const dash = page.locator('nav[aria-label="IMS modules"] button[title="Dashboard"]');
      if ((await dash.count()) > 0) {
        await dash.click();
        await assertNoModuleCrash(page);
        return;
      }
    } else {
      const label = MODULE_LABEL[m];
      if (label) {
        const navBtn = page.locator(`nav[aria-label="IMS modules"] button[title="${label}"]`);
        if ((await navBtn.count()) > 0) {
          // Always re-click even when m= already matches — compose/detail views share the same key.
          await navBtn.click();
          try {
            await page.waitForURL(
              (url) => url.searchParams.get("m") === m && !url.searchParams.get("intent"),
              { timeout: 5_000 },
            );
            await assertNoModuleCrash(page);
            return;
          } catch {
            // fall through to full goto (clears compose/intent)
          }
        }
      }
    }
  }

  await page.goto(target);
  if ((await isImsGateVisible(page).catch(() => false)) || page.url().includes("/login")) {
    await recoverImsSession(page, pathAndQuery);
  }
  await expectImsShell(page, pathAndQuery);
}

const MODULE_LABEL: Record<string, string> = {
  dashboard: "Dashboard",
  stockin: "Stock In",
  stockout: "Stock Out",
  stock: "Full Stock",
  checks: "Stock Check",
  lowstock: "Restock List",
  items: "Items",
  parties: "Suppliers & Customers",
  purchase: "Purchase Orders",
  approvals: "Approvals",
  bom: "Create / Maintain",
  bomDc: "DC & Returns",
  bomPackages: "Packages",
  bomRateCards: "Rate Cards",
  bomCompare: "Compare",
  sales: "Invoices & Billing",
  receivables: "Accounts Receivable",
  payables: "Accounts Payable",
  ledger: "Credit / Debit Ledger",
  closing: "Daily Closing",
  field: "Onsite Track",
  returns: "Damage & Returns",
  scanner: "QR Stock Scan",
  reports: "Reports",
  gst: "GST / HSN",
  history: "Transactions & Activity",
  audit: "Auditing / CA",
  excise: "Excise Records",
  integrations: "Tally & POS",
  connect: "Connected Tools",
  helpdesk: "Help Desk & FAQ",
  settings: "Settings",
  more: "More Actions",
};

export async function expectModuleTitle(page: Page, title: string | RegExp) {
  const pageTitle = page.locator(".ims-page-title");
  if ((await pageTitle.count()) > 0) {
    await expect(pageTitle.first()).toBeVisible({ timeout: 45_000 });
    await expect(pageTitle.first()).toContainText(title);
    return;
  }
  const heroTitle = page.locator(".ims-hero-title");
  await expect(heroTitle.first()).toBeVisible({ timeout: 45_000 });
  await expect(heroTitle.first()).toContainText(title);
}

export async function assertNoModuleCrash(page: Page) {
  await expect(page.getByText(/failed to load|is not a function|Something went wrong/i)).toHaveCount(0);
  const busy = page.locator(".bos-shell-main [aria-busy='true']");
  if ((await busy.count()) > 0) {
    await expect(busy).toHaveCount(0, { timeout: 45_000 });
  }
}

export async function smokeModule(page: Page, scenario: ImsModuleScenario) {
  // First module (or cold page): full goto. Later: SPA nav via gotoImsModule.
  if (!page.url().includes("/ims")) {
    await page.goto(appPath(scenario.path));
    if ((await isImsGateVisible(page).catch(() => false)) || page.url().includes("/login")) {
      await recoverImsSession(page, scenario.path);
    }
    await expectImsShell(page, scenario.path);
  } else {
    await gotoImsModule(page, scenario.path);
  }
  await assertNoModuleCrash(page);

  const navBtn = page.locator(`nav[aria-label="IMS modules"] button[title="${scenario.label}"]`);
  const inNav = (await navBtn.count()) > 0;

  if (scenario.key !== "dashboard" && !inNav) {
    const hasModuleTitle = (await page.locator(".ims-page-title").count()) > 0;
    test.skip(!hasModuleTitle, `${scenario.label} not enabled for this tenant`);
    if (!hasModuleTitle) return;
  }

  if (scenario.key !== "dashboard" && inNav) {
    const active = await navBtn.getAttribute("aria-current");
    if (active !== "page") {
      await navBtn.click();
      await assertNoModuleCrash(page);
    }
  }

  await expectModuleTitle(page, scenario.title);
  for (const probe of scenario.probes ?? []) {
    await expect(page.getByText(probe, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  }
}

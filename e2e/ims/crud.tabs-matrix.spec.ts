import { test, expect, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import {
  annotateScenario,
  assertNoModuleCrash,
  expectModuleTitle,
  gotoImsModule,
} from "./helpers";
import { imsAuthStatePath, playwrightBaseURL } from "./env";

/**
 * Every IMS module that exposes SubTabs: click each tab, assert no crash + content visible.
 */
type ModuleTabs = {
  id: string;
  key: string;
  label: string;
  path: string;
  title: string | RegExp;
  /** Primary SubTabs names (regex). Dynamic count suffixes are OK. */
  tabs: RegExp[];
};

const MODULE_WITH_TABS: ReadonlyArray<ModuleTabs> = [
  {
    id: "MATRIX-PARTIES",
    key: "parties",
    label: "Suppliers & Customers",
    path: "/ims?m=parties",
    title: "Suppliers & Customers",
    tabs: [/^All/i, /Suppliers/i, /Customers/i],
  },
  {
    id: "MATRIX-APPROVALS",
    key: "approvals",
    label: "Approvals",
    path: "/ims?m=approvals",
    title: "Approvals",
    tabs: [/Purchase orders/i, /^Bills/i, /Stock checks/i, /Delivery challans/i, /^History$/i],
  },
  {
    id: "MATRIX-SALES",
    key: "sales",
    label: "Invoices & Billing",
    path: "/ims?m=sales",
    title: "Invoices & Billing",
    tabs: [/^Invoices/i, /POS counter/i],
  },
  {
    id: "MATRIX-AP",
    key: "payables",
    label: "Accounts Payable",
    path: "/ims?m=payables",
    title: "Accounts Payable",
    tabs: [/^Bills$/i, /Payment runs/i],
  },
  {
    id: "MATRIX-CLOSING",
    key: "closing",
    label: "Daily Closing",
    path: "/ims?m=closing",
    title: "Daily Closing",
    tabs: [/Day close/i, /^History$/i],
  },
  {
    id: "MATRIX-RETURNS",
    key: "returns",
    label: "Damage & Returns",
    path: "/ims?m=returns",
    title: "Damage & Returns",
    tabs: [/Customer returns/i, /Supplier returns/i, /Damaged stock/i, /Damage log/i],
  },
  {
    id: "MATRIX-LOW",
    key: "lowstock",
    label: "Restock List",
    path: "/ims?m=lowstock",
    title: "Restock List",
    tabs: [/By supplier/i, /All low items/i, /Dead stock/i],
  },
  {
    id: "MATRIX-HISTORY",
    key: "history",
    label: "Transactions & Activity",
    path: "/ims?m=history",
    title: "Transactions & Activity",
    tabs: [/Stock movements/i, /Activity log/i],
  },
  {
    id: "MATRIX-BOMDC",
    key: "bomDc",
    label: "DC & Returns",
    path: "/ims?m=bomDc",
    title: /Delivery challans|Material returns|DC/i,
    tabs: [/Delivery challans/i, /^Returns/i],
  },
  {
    id: "MATRIX-FIELD",
    key: "field",
    label: "Onsite Track",
    path: "/ims?m=field",
    title: "Onsite Track",
    tabs: [/^Today$/i, /^Tasks$/i, /Visit history/i, /Day timeline/i],
  },
  {
    id: "MATRIX-HELPDESK",
    key: "helpdesk",
    label: "Help Desk & FAQ",
    path: "/ims?m=helpdesk",
    title: "Help Desk & FAQ",
    tabs: [/^Tickets$/i, /^FAQ$/i],
  },
  {
    id: "MATRIX-SETTINGS",
    key: "settings",
    label: "Settings",
    path: "/ims?m=settings",
    title: "Settings",
    tabs: [
      /^Business$/i,
      /Documents & numbering/i,
      /Team & access/i,
      /Role permissions/i,
      /Catalog lists/i,
      /^Reminders$/i,
      /Field map/i,
      /^Data$/i,
    ],
  },
  {
    id: "MATRIX-INTEGRATIONS",
    key: "integrations",
    label: "Tally & POS",
    path: "/ims?m=integrations",
    title: "Tally & POS",
    tabs: [/Tally ERP/i, /^POS$/i, /Sync log/i],
  },
  {
    id: "MATRIX-CONNECT",
    key: "connect",
    label: "Connected Tools",
    path: "/ims?m=connect",
    title: "Connected Tools",
    tabs: [/^Tools$/i, /Linked records/i],
  },
  {
    id: "MATRIX-REPORTS",
    key: "reports",
    label: "Reports",
    path: "/ims?m=reports",
    title: "Reports",
    tabs: [/All reports/i, /Saved & scheduled/i],
  },
  {
    id: "MATRIX-GST",
    key: "gst",
    label: "GST / HSN",
    path: "/ims?m=gst",
    title: "GST / HSN",
    tabs: [/GSTR-1/i, /GSTR-3B/i, /HSN summary/i, /Rate-wise/i, /Item HSN/i],
  },
  {
    id: "MATRIX-AUDIT",
    key: "audit",
    label: "Auditing / CA",
    path: "/ims?m=audit",
    title: "Auditing / CA",
    tabs: [
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
    ],
  },
];

test.describe.serial("IMS tab matrix — SubTabs walk (JustTestX)", () => {
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

  for (const mod of MODULE_WITH_TABS) {
    test(`${mod.id} — ${mod.label} tabs`, async ({}, testInfo) => {
      annotateScenario(testInfo, mod.id, `Tab matrix: ${mod.label}`, {
        mutates: "false",
        moduleKey: mod.key,
        path: mod.path,
        manualChecks: mod.tabs.map((t) => String(t)).join(" | "),
      });

      await gotoImsModule(page, mod.path);
      await assertNoModuleCrash(page);

      const navBtn = page.locator(`nav[aria-label="IMS modules"] button[title="${mod.label}"]`);
      if ((await navBtn.count()) === 0) {
        const hasTitle = (await page.locator(".ims-page-title").count()) > 0;
        test.skip(!hasTitle, `${mod.label} not enabled for this tenant`);
      }

      await expectModuleTitle(page, mod.title);

      let clicked = 0;
      for (const tab of mod.tabs) {
        const t = page.getByRole("tab", { name: tab }).first();
        if ((await t.count()) === 0) continue;
        await t.click();
        await assertNoModuleCrash(page);
        await expect(page.locator(".ims-app")).toBeVisible();
        await expect(page.locator("main").or(page.locator(".bos-shell-main")).first()).toBeVisible();
        clicked += 1;
      }

      test.skip(clicked === 0, `No SubTabs found for ${mod.label}`);
      expect(clicked).toBeGreaterThan(0);
    });
  }
});

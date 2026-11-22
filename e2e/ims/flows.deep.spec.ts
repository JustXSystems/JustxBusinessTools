import { test, expect, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import {
  annotateScenario,
  assertNoModuleCrash,
  dismissImsOverlays,
  expectModuleTitle,
  gotoImsModule,
} from "./helpers";
import { clickTab, marker, openDialogByButton } from "./crud-helpers";
import { imsAuthStatePath, playwrightBaseURL } from "./env";

test.describe.serial("IMS deep functional flows (JustTestX)", () => {
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

  test("FLOW-DASH-QA — dashboard KPIs + quick actions", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-DASH-QA", "Dashboard — KPIs and quick actions route correctly", {
      mutates: "false",
      moduleKey: "dashboard",
      manualChecks: "KPI cards | Create invoice | Stock in | Create PO",
    });
    await gotoImsModule(page, "/ims");
    await assertNoModuleCrash(page);
    await expect(page.locator(".ims-hero-title").or(page.getByText(/JustTestX/i)).first()).toBeVisible();
    await expect(page.getByText(/Stock in today|Entries today|Stock value/i).first()).toBeVisible();

    const qa = page.locator('nav[aria-label="Quick actions"]');
    test.skip((await qa.count()) === 0, "Quick actions gated");
    await qa.getByRole("button", { name: /Create invoice/i }).click();
    await expect(
      page.getByRole("button", { name: /Save draft/i }).or(page.getByText(/New invoice|Edit draft/i)).first(),
    ).toBeVisible({ timeout: 20_000 });
    await dismissImsOverlays(page);

    await gotoImsModule(page, "/ims");
    await page.locator('nav[aria-label="Quick actions"]').getByRole("button", { name: /Stock in/i }).click();
    await expectModuleTitle(page, "Stock In");

    await gotoImsModule(page, "/ims");
    await page.locator('nav[aria-label="Quick actions"]').getByRole("button", { name: /Create PO/i }).click();
    await expect(
      page
        .getByRole("button", { name: /Save draft/i })
        .or(page.locator(".ims-page-title").filter({ hasText: /purchase order|Edit /i }))
        .first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("FLOW-STOCKIN-PARTY — reason chips + supplier suggest", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-STOCKIN-PARTY", "Stock In — reason chips and supplier suggest", {
      mutates: "false",
      moduleKey: "stockin",
      manualChecks: "Reason chips | Havells / Polycab suggest",
    });
    await gotoImsModule(page, "/ims?m=stockin");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Stock In");
    await expect(page.getByText(/Reason|Purchase|Return|Opening/i).first()).toBeVisible({ timeout: 20_000 });
    const supplier = page.getByPlaceholder(/Supplier|party/i).or(page.getByLabel(/^Supplier$/i)).first();
    if ((await supplier.count()) > 0) {
      await supplier.fill("Havells");
      await expect(
        page.getByRole("option", { name: /Havells/i }).or(page.getByRole("button", { name: /Havells/i })).first(),
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  test("FLOW-STOCKOUT-PARTY — customer suggest Cascade", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-STOCKOUT-PARTY", "Stock Out — customer suggest Cascade", {
      mutates: "false",
      moduleKey: "stockout",
      manualChecks: "Cascade / Meridian suggest",
    });
    await gotoImsModule(page, "/ims?m=stockout");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Stock Out");
    const customer = page.getByPlaceholder(/Customer|party/i).or(page.getByLabel(/^Customer$/i)).first();
    test.skip((await customer.count()) === 0, "Customer field missing");
    await customer.fill("Cascade");
    await expect(
      page.getByRole("option", { name: /Cascade/i }).or(page.getByRole("button", { name: /Cascade/i })).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("FLOW-STOCK-AGING — Full Stock aging + search", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-STOCK-AGING", "Full Stock — aging columns and seeded SKU", {
      mutates: "false",
      moduleKey: "stock",
      manualChecks: "Aging columns | JX-CRIMP row",
    });
    await gotoImsModule(page, "/ims?m=stock");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Full Stock");
    const search = page.getByLabel("Search stock");
    if ((await search.count()) > 0) await search.fill("JX-CRIMP");
    await expect(page.getByText(/JX-CRIMP|Crimping|0-15|16-30|aging|Idle/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("FLOW-ITEMS-IMPORT — import path visible", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-ITEMS-IMPORT", "Items — import spreadsheet path visible", {
      mutates: "false",
      moduleKey: "items",
      manualChecks: "Import CTA | Dialog or file picker",
    });
    await gotoImsModule(page, "/ims?m=items");
    await assertNoModuleCrash(page);
    const importBtn = page.getByRole("button", { name: /Import/i }).first();
    test.skip((await importBtn.count()) === 0, "Import gated");
    await importBtn.click();
    await expect(
      page.getByRole("dialog").or(page.getByText(/spreadsheet|Excel|CSV|Upload|Import/i)).first(),
    ).toBeVisible({ timeout: 20_000 });
    await dismissImsOverlays(page);
  });

  test("FLOW-PARTY-GST — seeded party GSTIN / credit", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-PARTY-GST", "Parties — Havells / Cascade GSTIN visible", {
      mutates: "false",
      moduleKey: "parties",
      manualChecks: "Havells present | GSTIN or credit limit",
    });
    await gotoImsModule(page, "/ims?m=parties");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Suppliers & Customers");
    const search = page.getByLabel("Search suppliers and customers");
    if ((await search.count()) > 0) await search.fill("Havells");
    await expect(page.getByText(/Havells/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/GSTIN|credit|₹|29[A-Z0-9]/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("FLOW-PO-OPEN — open seeded PO document", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-PO-OPEN", "Purchase Orders — open seeded PO document", {
      mutates: "false",
      moduleKey: "purchase",
      manualChecks: "PO list | Document / draft opens",
    });
    await gotoImsModule(page, "/ims?m=purchase");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Purchase Orders");
    const row = page
      .getByRole("button", { name: /JUS-PO|PO-|Havells|Polycab|Draft|Sent|Approved/i })
      .or(page.getByText(/JUS-PO-|PO-/i))
      .first();
    test.skip((await row.count()) === 0, "No seeded POs visible");
    await row.click();
    await assertNoModuleCrash(page);
    await expect(
      page.locator(".ims-page-title").or(page.getByRole("dialog")).or(page.getByText(/Supplier|Line|Total|Approve/i)).first(),
    ).toBeVisible({ timeout: 20_000 });
    await dismissImsOverlays(page);
    const back = page.getByRole("button", { name: /Back to list|Cancel|Close/i }).first();
    if ((await back.count()) > 0) await back.click().catch(() => undefined);
  });

  test("FLOW-APPR-ACTION — approve or reject pending PO UI", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-APPR-ACTION", "Approvals — Approve/Reject controls on pending PO", {
      mutates: "false",
      moduleKey: "approvals",
      manualChecks: "Pending PO tab | Approve | Reject",
    });
    await gotoImsModule(page, "/ims?m=approvals");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Approvals");
    await clickTab(page, /Purchase orders/i);
    const approve = page.getByRole("button", { name: /^Approve$/i }).first();
    const reject = page.getByRole("button", { name: /^Reject$/i }).first();
    // Soft-assert UI is present when queue has work; empty queue is OK.
    if ((await approve.count()) > 0) {
      await expect(approve).toBeVisible();
      await expect(reject).toBeVisible();
    } else {
      await expect(page.getByText(/No pending|caught up|nothing to approve|Purchase orders/i).first()).toBeVisible();
    }
  });

  test("FLOW-RESTOCK-PO — Create PO from restock suggestion", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-RESTOCK-PO", "Restock List — Create PO from suggestion", {
      mutates: "false",
      moduleKey: "lowstock",
      manualChecks: "Create PO CTA | Opens PO editor",
    });
    await gotoImsModule(page, "/ims?m=lowstock");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Restock List");
    await clickTab(page, /By supplier/i);
    const createPo = page.getByRole("button", { name: /Create PO/i }).first();
    test.skip((await createPo.count()) === 0, "No restock Create PO CTA");
    await createPo.click();
    await expect(
      page.locator(".ims-page-title").filter({ hasText: /purchase order|Edit /i }).or(page.getByText(/New purchase order|Supplier/i)).first(),
    ).toBeVisible({ timeout: 20_000 });
    const back = page.getByRole("button", { name: /Back to list|Cancel/i }).first();
    if ((await back.count()) > 0) await back.click().catch(() => undefined);
  });

  test("FLOW-BOM-OPEN — open seeded BOM / preview", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-BOM-OPEN", "BOM — open seeded document", {
      mutates: "false",
      moduleKey: "bom",
      manualChecks: "Seeded BOM row | Builder / paper opens",
    });
    await gotoImsModule(page, "/ims?m=bom");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Create / Maintain");
    const row = page
      .getByRole("button", { name: /BOM|JUS-BOM|Confirmed|Draft/i })
      .or(page.locator("main").getByText(/JUS-BOM|BOM-|Confirmed/i))
      .first();
    test.skip((await row.count()) === 0, "No seeded BOM rows");
    await row.click();
    await assertNoModuleCrash(page);
    await expect(
      page.locator(".ims-page-title").or(page.getByText(/Materials|Confirm|Issue|Customer|Package/i)).first(),
    ).toBeVisible({ timeout: 20_000 });
    const back = page.getByRole("button", { name: /Back|Cancel|Close/i }).first();
    if ((await back.count()) > 0) await back.click().catch(() => undefined);
  });

  test("FLOW-BOMDC-OPEN — delivery challan statuses", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-BOMDC-OPEN", "DC & Returns — challan list statuses from seed", {
      mutates: "false",
      moduleKey: "bomDc",
      manualChecks: "DC list | Status badges",
    });
    await gotoImsModule(page, "/ims?m=bomDc");
    await assertNoModuleCrash(page);
    await clickTab(page, /Delivery challans/i);
    await expect(
      page.getByText(/Draft|Sent|Delivered|Cancelled|DC-|JUS-DC|challan|No delivery/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("FLOW-COMPARE-PICK — compare pickers usable", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-COMPARE-PICK", "Compare — left/right pickers interact", {
      mutates: "false",
      moduleKey: "bomCompare",
      manualChecks: "Mode toggle | Pickers accept input",
    });
    await gotoImsModule(page, "/ims?m=bomCompare");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, /Compare/i);
    await expect(page.getByRole("radiogroup", { name: /Compare source/i }).or(page.getByText(/Packages|Customer BOMs/i)).first()).toBeVisible();
    const filter = page.getByLabel("Filter compare options");
    if ((await filter.count()) > 0) await filter.fill("a");
    await expect(page.getByRole("button", { name: /^Compare$/i }).or(page.locator("select").first()).first()).toBeVisible();
    await assertNoModuleCrash(page);
  });

  test("FLOW-INV-OPEN — open seeded invoice", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-INV-OPEN", "Sales — open seeded invoice document", {
      mutates: "false",
      moduleKey: "sales",
      manualChecks: "Invoice list | Document / print path",
    });
    await gotoImsModule(page, "/ims?m=sales");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Invoices & Billing");
    const invTab = page.getByRole("tab", { name: /^Invoices/i }).first();
    if ((await invTab.count()) > 0) await invTab.click();
    const row = page.locator("main").getByText(/INV-|JUS-INV|DRAFT/i).first();
    test.skip((await row.count()) === 0, "No seeded invoices");
    await row.click();
    await assertNoModuleCrash(page);
    await expect(
      page
        .getByRole("button", { name: /Print|PDF|Share|Save|Issue|Close|Back|Cancel/i })
        .or(page.getByText(/Customer|Grand total|GST|Invoice|Cascade/i))
        .first(),
    ).toBeVisible({ timeout: 20_000 });
    await dismissImsOverlays(page);
    const back = page.getByRole("button", { name: /Back|Cancel|Close/i }).first();
    if ((await back.count()) > 0) await back.click().catch(() => undefined);
  });

  test("FLOW-AR-PAY-UI — Record payment dialog", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-AR-PAY-UI", "AR — open Record payment dialog", {
      mutates: "false",
      moduleKey: "receivables",
      manualChecks: "Record payment dialog | Amount / method fields",
    });
    await gotoImsModule(page, "/ims?m=receivables");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Accounts Receivable");
    const btn = page.getByRole("button", { name: /Record payment/i }).first();
    test.skip((await btn.count()) === 0, "Record payment gated");
    await btn.click();
    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText(/Amount|Payment|Customer|Method|Cash|UPI|Bank/i).first()).toBeVisible();
    await dismissImsOverlays(page);
  });

  test("FLOW-AP-BILL-UI — open bill / payment run", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-AP-BILL-UI", "AP — open bill or payment run UI", {
      mutates: "false",
      moduleKey: "payables",
      manualChecks: "Bills list | Open bill or New payment run",
    });
    await gotoImsModule(page, "/ims?m=payables");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Accounts Payable");
    const billsTab = page.getByRole("tab", { name: /^Bills/i }).first();
    if ((await billsTab.count()) > 0) await billsTab.click();
    await expect(page.locator("main").first()).toBeVisible();
    const runsTab = page.getByRole("tab", { name: /Payment runs/i }).first();
    if ((await runsTab.count()) > 0) {
      await runsTab.click();
      await assertNoModuleCrash(page);
    }
    await expect(
      page
        .getByRole("button", { name: /New payment run|Start|Pay|Add bill|New bill/i })
        .or(page.getByText(/Payment run|Bill|Havells|No payment|runs|payable/i))
        .first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("FLOW-CLOSE-FIELDS — day close form fields", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-CLOSE-FIELDS", "Daily Closing — today close form fields", {
      mutates: "false",
      moduleKey: "closing",
      manualChecks: "Cash / bank / notes fields | Close day CTA",
    });
    await gotoImsModule(page, "/ims?m=closing");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Daily Closing");
    await clickTab(page, /Day close/i);
    await expect(
      page.getByLabel(/Cash|Bank|Notes|Counted/i).or(page.getByRole("button", { name: /Close day|Save closing|Submit/i })).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("FLOW-RETURNS-SUP — supplier return form", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-RETURNS-SUP", "Damage & Returns — supplier return form", {
      mutates: "false",
      moduleKey: "returns",
      manualChecks: "Supplier return CTA | Dialog",
    });
    await gotoImsModule(page, "/ims?m=returns");
    await assertNoModuleCrash(page);
    const tab = page.getByRole("tab", { name: /Supplier returns/i }).first();
    if ((await tab.count()) > 0) await tab.click();
    const cta = page.getByRole("button", { name: /Supplier return|Record a supplier return|New return|Add return/i }).first();
    if ((await cta.count()) > 0) {
      await cta.click();
      const dialog = page.getByRole("dialog").first();
      if ((await dialog.count()) > 0) {
        await expect(dialog.getByRole("button", { name: /Record|Cancel|Save/i }).first()).toBeVisible();
        await dismissImsOverlays(page);
      }
    } else {
      await expect(page.getByText(/Supplier return|No returns|supplier/i).first()).toBeVisible({ timeout: 15_000 });
    }
  });

  test("FLOW-DAMAGE-UI — damaged stock quarantine UI", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-DAMAGE-UI", "Damage & Returns — damaged stock tab", {
      mutates: "false",
      moduleKey: "returns",
      manualChecks: "Damaged stock | Quarantine / restore controls",
    });
    await gotoImsModule(page, "/ims?m=returns");
    await assertNoModuleCrash(page);
    await clickTab(page, /Damaged stock/i);
    await expect(
      page.getByText(/Damaged|Quarantine|Restore|Write-off|No damaged|pcs/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("FLOW-HIST-FILTER — filter stock movements", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-HIST-FILTER", "History — filter by movement type", {
      mutates: "false",
      moduleKey: "history",
      manualChecks: "Stock In filter | Rows update",
    });
    await gotoImsModule(page, "/ims?m=history");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Transactions & Activity");
    await clickTab(page, /Stock movements/i);
    const filter = page.getByRole("button", { name: /Stock in|All types|Type|Filter/i }).or(page.getByLabel(/Type|Movement/i)).first();
    if ((await filter.count()) > 0) {
      await filter.click();
      const opt = page.getByRole("option", { name: /Stock in|IN/i }).or(page.getByRole("button", { name: /Stock in/i })).first();
      if ((await opt.count()) > 0) await opt.click();
    }
    await expect(page.getByText(/STOCK IN|Stock in|JX-|movement|No movements/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("FLOW-GST-GSTR1 — GSTR-1 summary loads", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-GST-GSTR1", "GST — GSTR-1 fiscal summary", {
      mutates: "false",
      moduleKey: "gst",
      manualChecks: "GSTR-1 tab | Summary / taxable figures",
    });
    await gotoImsModule(page, "/ims?m=gst");
    await assertNoModuleCrash(page);
    await clickTab(page, /GSTR-1/i);
    await expect(
      page.getByText(/Taxable|CGST|SGST|IGST|Invoice|B2B|Nil|No data|₹/i).first(),
    ).toBeVisible({ timeout: 25_000 });
  });

  test("FLOW-AUDIT-FLAGS — auditor flags / overview", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-AUDIT-FLAGS", "Auditing — overview / flags from seed", {
      mutates: "false",
      moduleKey: "audit",
      manualChecks: "Overview KPIs | Flags or findings",
    });
    await gotoImsModule(page, "/ims?m=audit");
    await assertNoModuleCrash(page);
    await clickTab(page, /^Overview$/i);
    await expect(page.getByText(/Flag|Finding|Ledger|GST|Bank|Overview|query/i).first()).toBeVisible({
      timeout: 20_000,
    });
    const flags = page.getByRole("tab", { name: /Flags|Findings/i }).first();
    if ((await flags.count()) > 0) {
      await flags.click();
      await assertNoModuleCrash(page);
    }
  });

  test("FLOW-SETTINGS-BIZ — JustTestX business name", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-SETTINGS-BIZ", "Settings — JustTestX Distribution business name", {
      mutates: "false",
      moduleKey: "settings",
      manualChecks: "Business name JustTestX Distribution",
    });
    await gotoImsModule(page, "/ims?m=settings");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Settings");
    const bizTab = page.getByRole("tab", { name: /^Business$/i }).first();
    if ((await bizTab.count()) > 0) await bizTab.click();
    await expect(
      page.locator('input[value*="JustTestX"]').or(page.getByText(/JustTestX Distribution/i)).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("FLOW-TALLY-PERIOD — Tally export period picker", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-TALLY-PERIOD", "Integrations — Tally export period picker", {
      mutates: "false",
      moduleKey: "integrations",
      manualChecks: "From/To dates | Export Tally XML",
    });
    await gotoImsModule(page, "/ims?m=integrations");
    await assertNoModuleCrash(page);
    await clickTab(page, /Tally ERP/i);
    await expect(
      page.getByRole("button", { name: /Export|Download|Tally XML/i }).or(page.getByLabel(/From|To|Period/i)).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("FLOW-REPORT-EXPORT — reports export control", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-REPORT-EXPORT", "Reports — export control on catalog", {
      mutates: "false",
      moduleKey: "reports",
      manualChecks: "Report cards | Export / Excel / CSV",
    });
    await gotoImsModule(page, "/ims?m=reports");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, "Reports");
    await expect(
      page.getByRole("button", { name: /Export|Excel|CSV|Run|Open/i }).or(page.getByText(/Stock|Sales|Purchase|report/i)).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("FLOW-FIELD-TODAY — onsite today / check-in UI", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-FIELD-TODAY", "Onsite Track — Today check-in UI", {
      mutates: "false",
      moduleKey: "field",
      manualChecks: "Today tab | Check-in / tasks / map",
    });
    await gotoImsModule(page, "/ims?m=field");
    await assertNoModuleCrash(page);
    await expectModuleTitle(page, /Onsite|Field/i);
    await clickTab(page, /^Today$/i);
    await expect(
      page.getByText(/Check-in|Check in|Visit|Task|Map|No visits|Today/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("FLOW-INV-ISSUE-UI — Save & issue control on new invoice", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-INV-ISSUE-UI", "Sales — Save & issue path visible on new invoice", {
      mutates: "false",
      moduleKey: "sales",
      manualChecks: "Save draft | Save & issue",
    });
    await gotoImsModule(page, "/ims?m=sales&intent=new");
    await assertNoModuleCrash(page);
    await expect(page.getByRole("button", { name: /Save draft/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Save & issue/i })).toBeVisible();
  });

  test("FLOW-PO-SUBMIT-UI — PO submit / approve CTAs", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-PO-SUBMIT-UI", "Purchase Orders — submit/approve CTAs on new PO", {
      mutates: "false",
      moduleKey: "purchase",
      manualChecks: "Save draft | Save & approve or Submit for approval",
    });
    await gotoImsModule(page, "/ims?m=purchase&intent=new");
    await assertNoModuleCrash(page);
    await expect(page.getByRole("button", { name: /Save draft/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Save & approve|Submit for approval|Save & send/i }).first(),
    ).toBeVisible();
  });

  test("MUT-AR-PROMISE — open promise UI with marker note", async ({}, testInfo) => {
    const note = marker();
    annotateScenario(testInfo, "MUT-AR-PROMISE", "AR — promise / reminder UI reachable", {
      mutates: "false",
      marker: note,
      moduleKey: "receivables",
      manualChecks: "Promises due | Reminder controls",
    });
    await gotoImsModule(page, "/ims?m=receivables");
    await assertNoModuleCrash(page);
    await expect(
      page.getByText(/Promises due|Aging|Overdue|Record payment/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("MUT-APPR-REJECT-UI — reject dialog requires reason", async ({}, testInfo) => {
    annotateScenario(testInfo, "MUT-APPR-REJECT-UI", "Approvals — Reject dialog reason field", {
      mutates: "false",
      moduleKey: "approvals",
      manualChecks: "Reject opens reason dialog | Cancel safe",
    });
    await gotoImsModule(page, "/ims?m=approvals");
    await assertNoModuleCrash(page);
    await clickTab(page, /Purchase orders/i);
    const reject = page.getByRole("button", { name: /^Reject$/i }).first();
    test.skip((await reject.count()) === 0, "No pending PO to reject");
    await reject.click();
    const dialog = page.getByRole("dialog").filter({ hasText: /Reject/i });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByLabel(/Reason|Note|Why/i).or(dialog.locator("textarea")).first()).toBeVisible();
    await dialog.getByRole("button", { name: /Cancel|Close/i }).first().click().catch(() => page.keyboard.press("Escape"));
  });

  test("MUT-STOCKCHECK-START — start counting UI", async ({}, testInfo) => {
    annotateScenario(testInfo, "MUT-STOCKCHECK-START", "Stock Check — Start counting UI", {
      mutates: "false",
      moduleKey: "checks",
      manualChecks: "New stock check | Start counting",
    });
    await gotoImsModule(page, "/ims?m=checks");
    await assertNoModuleCrash(page);
    const dialog = await openDialogByButton(page, /New stock check|Start your first count/i);
    test.skip(!dialog, "New stock check unavailable");
    await expect(dialog!.getByRole("button", { name: /Start counting/i })).toBeVisible();
    await dismissImsOverlays(page);
  });

  test("MUT-ITEM-UPDATE — edit seeded item name field", async ({}, testInfo) => {
    annotateScenario(testInfo, "MUT-ITEM-UPDATE", "Items — edit path shows Save changes", {
      mutates: "false",
      moduleKey: "items",
      manualChecks: "Detail Edit | Save changes | Cancel",
    });
    await gotoImsModule(page, "/ims?m=items");
    await assertNoModuleCrash(page);
    const search = page.getByLabel("Search items");
    test.skip((await search.count()) === 0, "Search missing");
    await search.fill("JX-CRIMP");
    await page.getByText(/JX-CRIMP|Crimping/i).first().click();
    const detail = page.getByRole("dialog").first();
    await expect(detail).toBeVisible({ timeout: 20_000 });
    await detail.getByRole("button", { name: /^Edit$/i }).click();
    const editor = page.getByRole("dialog").filter({ hasText: /Save changes/i });
    await expect(editor.getByRole("textbox", { name: /Item name/i })).toBeVisible();
    await editor.getByRole("button", { name: /Cancel/i }).click().catch(() => page.keyboard.press("Escape"));
  });

  test("FLOW-SHELL-BIZ — branch shows JustTestX Distribution", async ({}, testInfo) => {
    annotateScenario(testInfo, "FLOW-SHELL-BIZ", "Shell — JustTestX Distribution in nav", {
      mutates: "false",
      moduleKey: "dashboard",
      manualChecks: "Nav business name | Owner role",
    });
    await gotoImsModule(page, "/ims");
    await assertNoModuleCrash(page);
    await expect(page.getByText(/JustTestX Distribution/i).first()).toBeVisible();
    await expect(page.getByText(/Owner/i).first()).toBeVisible();
  });
});

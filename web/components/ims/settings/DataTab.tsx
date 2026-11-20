"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Alert, Button, Dialog, Field, Input } from "@/components/bos";
import { ims, type ImsSettings } from "@/lib/ims/api";
import { STOCK_STATUS_LABEL } from "@/lib/ims/format";
import { purchase } from "@/lib/ims/purchase";
import { downloadWorkbook, settingsApi, type SheetSpec } from "@/lib/ims/settings";
import { useIms, useImsAction } from "../core";
import { SectionCard } from "./parts";

async function itemsSheet(): Promise<SheetSpec> {
  const { items } = await ims.items({ includeInactive: true });
  return {
    name: "Items",
    rows: [
      ["Name", "SKU", "Barcode", "Category", "Brand", "Unit", "HSN", "GST %", "Supplier", "Purchase price", "Selling price", "MRP", "Stock", "Damaged", "Min stock", "Max stock", "Reorder qty", "Location", "Status", "Stock value", "Active"],
      ...items.map((i) => [
        i.name,
        i.sku,
        i.barcode,
        i.category,
        i.brand,
        i.unit,
        i.hsn,
        i.gstRate,
        i.supplierName,
        i.purchasePrice,
        i.sellingPrice,
        i.mrp,
        i.currentStock,
        i.damagedStock,
        i.minStock,
        i.maxStock,
        i.reorderQty,
        i.location,
        STOCK_STATUS_LABEL[i.status],
        i.stockValue,
        i.active ? "Yes" : "No",
      ]),
    ],
  };
}

async function partiesSheet(): Promise<SheetSpec> {
  const { parties } = await purchase.exportParties();
  return {
    name: "Parties",
    rows: [
      ["Name", "Type", "Contact person", "Mobile", "Email", "GSTIN", "PAN", "Address", "City", "State", "State code", "Payment terms (days)", "Credit limit", "Opening balance", "Account manager", "Tags", "Receivable", "Payable", "Net balance", "Active"],
      ...parties.map((p) => [
        p.name,
        p.kind,
        p.contactPerson,
        p.mobile,
        p.email,
        p.gstin,
        p.pan,
        p.address,
        p.city,
        p.state,
        p.stateCode,
        p.paymentTermsDays,
        p.creditLimit,
        p.openingBalance,
        p.accountManagerName,
        p.tags.join(", "),
        p.stats.receivable,
        p.stats.payable,
        p.stats.netBalance,
        p.active ? "Yes" : "No",
      ]),
    ],
  };
}

const settingsSheet = (s: ImsSettings): SheetSpec => ({
  name: "Settings",
  rows: [
    ["Setting", "Value"],
    ["Business name", s.businessName],
    ["Business type", s.businessType],
    ["GSTIN", s.gstin],
    ["State", s.state ? `${s.state} (${s.stateCode ?? "—"})` : null],
    ["PO prefix", s.poPrefix],
    ["Invoice prefix", s.invoicePrefix],
    ["Bill prefix", s.billPrefix],
    ["BOM document purpose", s.bomPaperTemplate],
    ["BOM industry pack", s.bomIndustryPack],
    ["BOM paper tone", s.bomPaperTone],
    ["BOM hide margin", s.bomHideMargin ? "Yes" : "No"],
    ["BOM confirm needs approval", s.bomConfirmNeedsApproval ? "Yes" : "No"],
    ["Quotation reference required", s.bomRequireQuotationRef ? "Yes" : "No"],
    ["BOM schedule columns", s.bomScheduleColumns?.length ? s.bomScheduleColumns.join(", ") : "Pack defaults"],
    ["PO approval limit", s.poApprovalLimit],
    ["Default payment terms (days)", s.paymentTermsDays],
    ["Default GST %", s.defaultGstRate],
    ["Categories", s.taxonomy.categories.map((c) => c.name).join(", ")],
  ],
});

export function DataTab() {
  const { session, can } = useIms();
  const { isPlatformAdmin } = useAuth();
  const { run, busy } = useImsAction();
  const stamp = session.today;
  const canItems = can("items") || can("reports") || can("settings");
  const canParties = can("suppliers") || can("sales") || can("po") || can("settings");
  const [clearOpen, setClearOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const exportBook = (key: string, filename: string, build: () => Promise<SheetSpec[]>) =>
    run(
      key,
      async () => {
        await downloadWorkbook(filename, await build());
        return true;
      },
      { success: "Download ready", description: `${filename}.xlsx`, refresh: false },
    );

  const businessName = session.settings.businessName.trim();
  const nameMatches = confirmName.trim().toLowerCase() === businessName.toLowerCase() && businessName.length > 0;

  const clearOperational = () =>
    run(
      "clear-ops",
      async () => {
        const out = await settingsApi.clearOperational(confirmName.trim());
        setClearOpen(false);
        setConfirmName("");
        return out;
      },
      {
        success: "Operational data cleared",
        description: "Stock, BOM, DC, Invoice, Return and PO are empty — ready for a fresh dataset.",
      },
    );

  return (
    <>
      <SectionCard title="Export data" desc="Excel workbooks for your accountant, a backup or bulk edits. Items and parties re-import from their own modules.">
        <div className="ims-export-grid">
          <div className="ims-export">
            <div className="ims-export-title">Items & stock</div>
            <div className="ims-export-desc">Every item with prices, GST, stock levels and value — archived items included.</div>
            <div>
              <Button size="sm" icon="download" disabled={!canItems || Boolean(busy)} onClick={() => exportBook("items", `items-${stamp}`, async () => [await itemsSheet()])}>
                {busy === "items" ? "Preparing…" : "Download items"}
              </Button>
            </div>
          </div>
          <div className="ims-export">
            <div className="ims-export-title">Suppliers & customers</div>
            <div className="ims-export-desc">Contacts, GSTIN, terms and current balances for every party.</div>
            <div>
              <Button size="sm" icon="download" disabled={!canParties || Boolean(busy)} onClick={() => exportBook("parties", `parties-${stamp}`, async () => [await partiesSheet()])}>
                {busy === "parties" ? "Preparing…" : "Download parties"}
              </Button>
            </div>
          </div>
          <div className="ims-export">
            <div className="ims-export-title">Full workbook</div>
            <div className="ims-export-desc">Items, parties and a summary of these settings in one file.</div>
            <div>
              <Button
                size="sm"
                variant="primary"
                icon="download"
                disabled={!canItems || !canParties || Boolean(busy)}
                onClick={() => exportBook("all", `ims-export-${stamp}`, async () => [await itemsSheet(), await partiesSheet(), settingsSheet(session.settings)])}
              >
                {busy === "all" ? "Preparing…" : "Download everything"}
              </Button>
            </div>
          </div>
        </div>
      </SectionCard>

      {isPlatformAdmin ? (
        <SectionCard
          title="Clear operational data"
          desc="JBT Super Admin only. Permanently delete Stock movements, BOM documents, delivery challans, invoices, returns and purchase orders for this business profile so you can load a fresh dataset."
        >
          <Alert tone="coral" title="Irreversible for this profile">
            Keeps settings, team, parties, item catalogue and BOM packages. Zeros on-hand stock, resets document numbering for those docs, and removes supplier bills / payments tied to them. Active business: <strong>{businessName || "—"}</strong>.
          </Alert>
          <div style={{ marginTop: 14 }}>
            <Button
              size="sm"
              variant="destructive"
              icon="warning"
              disabled={!businessName || Boolean(busy)}
              onClick={() => {
                setConfirmName("");
                setClearOpen(true);
              }}
            >
              Clear Stock, BOM, DC, Invoice, Return &amp; PO…
            </Button>
          </div>

          <Dialog
            open={clearOpen}
            onClose={() => {
              if (busy === "clear-ops") return;
              setClearOpen(false);
              setConfirmName("");
            }}
            title="Clear operational IMS data?"
            description={`This deletes Stock, BOM, DC, Invoice, Return and PO data for “${businessName}”. Type the business name to confirm.`}
            icon={{ tone: "coral", name: "warning" }}
            dismissible={busy !== "clear-ops"}
            actions={
              <>
                <Button
                  variant="ghost"
                  disabled={busy === "clear-ops"}
                  onClick={() => {
                    setClearOpen(false);
                    setConfirmName("");
                  }}
                >
                  Cancel
                </Button>
                <Button variant="destructive" disabled={!nameMatches || busy === "clear-ops"} onClick={() => void clearOperational()}>
                  {busy === "clear-ops" ? "Clearing…" : "Clear permanently"}
                </Button>
              </>
            }
          >
            <Field label={`Type “${businessName}” to confirm`}>
              {({ id }) => (
                <Input
                  id={id}
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={businessName}
                  autoComplete="off"
                  disabled={busy === "clear-ops"}
                />
              )}
            </Field>
          </Dialog>
        </SectionCard>
      ) : null}
    </>
  );
}

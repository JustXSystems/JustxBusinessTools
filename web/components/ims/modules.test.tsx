/**
 * Guards the production crash "i is not a function": every IMS screen must
 * resolve to a function default export for React.lazy.
 */
import { describe, expect, it } from "vitest";

const SCREENS: ReadonlyArray<{ key: string; load: () => Promise<{ default: unknown }> }> = [
  { key: "dashboard", load: () => import("./inventory/Dashboard") },
  { key: "stockin", load: () => import("./inventory/StockIn") },
  { key: "stockout", load: () => import("./inventory/StockOut") },
  { key: "stock", load: () => import("./inventory/FullStock") },
  { key: "checks", load: () => import("./inventory/StockChecks") },
  { key: "lowstock", load: () => import("./inventory/LowStock") },
  { key: "items", load: () => import("./inventory/Items") },
  { key: "parties", load: () => import("./purchase/Parties") },
  { key: "purchase", load: () => import("./purchase/PurchaseOrders") },
  { key: "approvals", load: () => import("./purchase/Approvals") },
  { key: "sales", load: () => import("./finance/Sales") },
  { key: "receivables", load: () => import("./finance/Receivables") },
  { key: "payables", load: () => import("./finance/Payables") },
  { key: "ledger", load: () => import("./finance/Ledger") },
  { key: "closing", load: () => import("./finance/Closing") },
  { key: "field", load: () => import("./field/Onsite") },
  { key: "returns", load: () => import("./inventory/Returns") },
  { key: "scanner", load: () => import("./inventory/Scanner") },
  { key: "reports", load: () => import("./insights/Reports") },
  { key: "gst", load: () => import("./insights/Gst") },
  { key: "history", load: () => import("./inventory/History") },
  { key: "audit", load: () => import("./system/Audit") },
  { key: "excise", load: () => import("./system/Excise") },
  { key: "integrations", load: () => import("./system/Integrations") },
  { key: "connect", load: () => import("./system/Connect") },
  { key: "helpdesk", load: () => import("./system/Helpdesk") },
  { key: "settings", load: () => import("./settings/Settings") },
  { key: "more", load: () => import("./MoreActions") },
];

describe("IMS module default exports", () => {
  it.each(SCREENS)("$key exports a function as default", async ({ load }) => {
    const mod = await load();
    expect(typeof mod.default).toBe("function");
  });
});

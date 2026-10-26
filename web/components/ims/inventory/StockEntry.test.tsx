/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ImsSession } from "@/lib/ims/api";
import { ImsAppProvider, type ImsAppContextValue } from "../core";
import StockIn from "./StockIn";
import StockOut from "./StockOut";

vi.mock("@/lib/ims/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ims/api")>();
  return {
    ...actual,
    ims: {
      ...actual.ims,
      inventoryMeta: vi.fn(async () => ({
        taxonomy: { damageReasons: ["Broken"], adjustmentReasons: ["Count fix"], categories: [], brands: [], units: [] },
        allowNegativeStock: false,
        canSeeCost: true,
      })),
      items: vi.fn(async () => ({ items: [] })),
      parties: vi.fn(async () => ({ parties: [] })),
      // Missing `totals` must not crash RecentEntries (prod: TypeError → error boundary).
      movements: vi.fn(async () => ({ movements: [], range: { from: "2026-10-26", to: "2026-10-26" } })),
    },
  };
});

vi.mock("@/components/bos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/bos")>();
  return {
    ...actual,
    useToast: () => ({ show: vi.fn() }),
  };
});

const session = {
  host: "jbt",
  tenantId: 1,
  actor: { userId: 1, name: "Test", email: "t@x.com", platformRole: "owner" },
  access: {
    role: "owner",
    roleLabel: "Owner",
    perms: ["stockIn", "stockOut", "damage", "stockCheck", "items", "reports"],
  },
  settings: {
    businessName: "JustTestX",
    businessType: "distributor",
    gstin: null,
    stateCode: "29",
    address: null,
    phone: null,
    email: null,
    invoicePrefix: "INV",
    poPrefix: "PO",
    allowNegativeStock: false,
    exciseActive: false,
    permissions: {},
    taxonomy: { categories: [], brands: [], units: [], locations: [], damageReasons: [], adjustmentReasons: [], returnReasons: [], holdReasons: [], expenseCategories: [] },
    reminders: { autoEnabled: false, rules: {}, channels: [], templates: [] },
    terms: null,
  },
  brand: null,
  sources: [],
  catalogs: [],
  today: "2026-10-26",
} as unknown as ImsSession;

function wrap(ui: ReactNode) {
  const ctx: ImsAppContextValue = {
    session,
    mode: "tool",
    can: (p) => session.access.perms.includes(p),
    version: 0,
    invalidate: vi.fn(),
    navigate: vi.fn(),
    takeIntent: () => null,
    navSeq: 0,
    active: "stockin",
    notifications: [],
    refreshNotifications: vi.fn(),
    setSettings: vi.fn(),
    openPalette: vi.fn(),
  };
  return render(<ImsAppProvider value={ctx}>{ui}</ImsAppProvider>);
}

describe("StockEntry modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Stock In without throwing", async () => {
    wrap(<StockIn />);
    await waitFor(() => {
      expect(screen.getAllByText(/stock in/i).length).toBeGreaterThan(0);
    });
  });

  it("renders Stock Out without throwing", async () => {
    wrap(<StockOut />);
    await waitFor(() => {
      expect(screen.getAllByText(/stock out/i).length).toBeGreaterThan(0);
    });
  });
});

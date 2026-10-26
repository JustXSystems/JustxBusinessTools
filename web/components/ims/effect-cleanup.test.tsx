/**
 * @vitest-environment jsdom
 *
 * React 19 calls effect cleanups without a typeof check. Returning null / a
 * Promise / any non-function from useEffect becomes TypeError: i is not a
 * function in production (commitHookEffectListUnmount).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ImsSession } from "@/lib/ims/api";

const badReturns: Array<{ value: unknown; hint: string }> = [];

vi.mock("react", async (importOriginal) => {
  const React = await importOriginal<typeof import("react")>();
  const wrap =
    (hook: typeof React.useEffect): typeof React.useEffect =>
    (fn, deps) =>
      hook(() => {
        const result = (fn as () => unknown)();
        if (result !== undefined && typeof result !== "function") {
          badReturns.push({
            value: result,
            hint: Object.prototype.toString.call(result),
          });
        }
        return typeof result === "function" ? (result as () => void) : undefined;
      }, deps);
  return {
    ...React,
    useEffect: wrap(React.useEffect),
    useLayoutEffect: wrap(React.useLayoutEffect),
  };
});

vi.mock("@/lib/ims/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ims/api")>();
  return {
    ...actual,
    ims: {
      ...actual.ims,
      inventoryMeta: vi.fn(async () => ({
        taxonomy: {
          damageReasons: ["Broken"],
          adjustmentReasons: ["Count fix"],
          categories: [],
          brands: [],
          units: [],
          locations: [],
          returnReasons: [],
          holdReasons: [],
          expenseCategories: [],
        },
        allowNegativeStock: false,
        canSeeCost: true,
      })),
      items: vi.fn(async () => ({ items: [] })),
      parties: vi.fn(async () => ({ parties: [] })),
      movements: vi.fn(async () => ({ movements: [], range: { from: "2026-10-26", to: "2026-10-26" }, totals: {} })),
      notifications: vi.fn(async () => ({ notifications: [] })),
    },
  };
});

vi.mock("@/lib/ims/inventory-a", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ims/inventory-a")>();
  return {
    ...actual,
    invA: {
      ...actual.invA,
      dashboard: vi.fn(async () => ({
        today: "2026-10-26",
        range: { from: "2026-09-26", to: "2026-10-26" },
        kpis: { todayIn: 0, todayOut: 0, stockValue: 0, sku: 0, lowStock: 0, attention: 0 },
        series: [],
        attention: [],
        recent: [],
        categories: [],
        onboarding: false,
      })),
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
    perms: ["stockIn", "stockOut", "damage", "stockCheck", "items", "reports", "sales", "po", "suppliers", "receivables", "payables", "approvals", "closing", "integrations", "audit"],
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
    taxonomy: {
      categories: [],
      brands: [],
      units: [],
      locations: [],
      damageReasons: [],
      adjustmentReasons: [],
      returnReasons: [],
      holdReasons: [],
      expenseCategories: [],
    },
    reminders: { autoEnabled: false, rules: {}, channels: [], templates: [] },
    terms: null,
  },
  brand: null,
  sources: [],
  catalogs: [],
  today: "2026-10-26",
} as unknown as ImsSession;

describe("useEffect cleanup contract (React 19)", () => {
  afterEach(() => {
    cleanup();
    badReturns.length = 0;
  });

  it("Stock In mount/unmount never returns a non-function cleanup", async () => {
    const { ImsAppProvider } = await import("./core");
    const StockIn = (await import("./inventory/StockIn")).default;
    const ctx = {
      session,
      mode: "tool" as const,
      can: (p: (typeof session.access.perms)[number]) => session.access.perms.includes(p),
      version: 0,
      invalidate: vi.fn(),
      navigate: vi.fn(),
      takeIntent: () => null,
      navSeq: 0,
      active: "stockin" as const,
      notifications: [],
      refreshNotifications: vi.fn(),
      setSettings: vi.fn(),
      openPalette: vi.fn(),
    };
    const view = render(
      <ImsAppProvider value={ctx}>
        <StockIn />
      </ImsAppProvider>,
    );
    await waitFor(() => {
      expect(document.body.textContent?.toLowerCase()).toMatch(/stock in/);
    });
    view.unmount();
    expect(badReturns, JSON.stringify(badReturns)).toEqual([]);
  });

  it("Dashboard mount/unmount never returns a non-function cleanup", async () => {
    const { ImsAppProvider } = await import("./core");
    const { DashboardModule } = await import("./inventory/Dashboard");
    const ctx = {
      session,
      mode: "tool" as const,
      can: (p: (typeof session.access.perms)[number]) => session.access.perms.includes(p),
      version: 0,
      invalidate: vi.fn(),
      navigate: vi.fn(),
      takeIntent: () => null,
      navSeq: 0,
      active: "dashboard" as const,
      notifications: [],
      refreshNotifications: vi.fn(),
      setSettings: vi.fn(),
      openPalette: vi.fn(),
    };
    const view = render(
      <ImsAppProvider value={ctx}>
        <DashboardModule />
      </ImsAppProvider>,
    );
    await waitFor(() => {
      expect(document.body.textContent?.length ?? 0).toBeGreaterThan(20);
    });
    view.unmount();
    expect(badReturns, JSON.stringify(badReturns)).toEqual([]);
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { BosRoot } from "@/components/bos";
import { errorText, type ImsSession } from "@/lib/ims/api";
import { ImsAppProvider, type ImsAppContextValue } from "../core";
import { isChunkLoadError } from "../modules";
import ItemsModule from "./Items";

vi.mock("@/lib/ims/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ims/api")>();
  return {
    ...actual,
    ims: {
      ...actual.ims,
      // Intentionally omit locations / suppliers / summary / facets to verify defensive guards.
      inventoryMeta: vi.fn(async () => ({
        taxonomy: { categories: [{ name: "Cables", hsn: "8544", gstRate: 18 }] },
        allowNegativeStock: false,
        canSeeCost: true,
      })),
      items: vi.fn(async () => ({ items: [] })),
    },
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
    taxonomy: {},
    reminders: { autoEnabled: false, rules: {}, channels: [], templates: [] },
    terms: null,
  },
  brand: null,
  sources: [],
  catalogs: [],
  today: "2026-11-26",
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
    active: "items",
    notifications: [],
    refreshNotifications: vi.fn(),
    setSettings: vi.fn(),
    openPalette: vi.fn(),
  };
  return render(
    <BosRoot skin="ims">
      <ImsAppProvider value={ctx}>{ui}</ImsAppProvider>
    </BosRoot>,
  );
}

describe("Items module", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens Add item dialog without crashing on partial taxonomy/settings", async () => {
    wrap(<ItemsModule />);
    const addBtn = await screen.findByRole("button", { name: /^add item$/i });
    fireEvent.click(addBtn);
    await waitFor(() => {
      expect(screen.getByLabelText(/item name/i)).toBeTruthy();
    });
  });

  it("opens Import dialog cleanly", async () => {
    wrap(<ItemsModule />);
    const importBtn = await screen.findByRole("button", { name: /^import$/i });
    fireEvent.click(importBtn);
    await waitFor(() => {
      expect(screen.getByText(/import items from excel \/ csv/i)).toBeTruthy();
    });
  });

  it("errorText preserves non-empty string errors from error boundaries", () => {
    expect(errorText("TypeError: x is undefined\n\n    at ItemForm")).toBe("TypeError: x is undefined\n\n    at ItemForm");
    expect(errorText(new Error("Boom"))).toBe("Boom");
    expect(errorText(null)).toBe("Something went wrong");
  });

  it("isChunkLoadError identifies Next.js stale-chunk errors", () => {
    const chunkErr = new Error("Loading chunk 8650 failed.");
    chunkErr.name = "ChunkLoadError";
    expect(isChunkLoadError(chunkErr)).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 1234 failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("Network error"))).toBe(false);
    expect(isChunkLoadError("ChunkLoadError")).toBe(false);
  });
});

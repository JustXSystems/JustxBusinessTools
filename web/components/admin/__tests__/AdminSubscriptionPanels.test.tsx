/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromoCodesPanel } from "../PromoCodesPanel";
import { QuickGrantToolCard } from "../QuickGrantToolCard";
import { TenantLicenseInspector } from "../TenantLicenseInspector";
import { CommercePolicyPanel } from "../CommercePolicyPanel";
import { DEFAULT_COMMERCE_POLICY } from "@/lib/types/subscription";

const mockApi = vi.fn();
vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

vi.mock("@/components/admin/AdminOrgSelect", () => ({
  AdminOrgSelect: ({
    value,
    onChange,
  }: {
    value: number | null;
    onChange: (id: number | null) => void;
  }) => (
    <select
      aria-label="Organization"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">Select org</option>
      <option value="12">Acme Corp</option>
    </select>
  ),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("PromoCodesPanel", () => {
  it("loads promos with total saved & per-org cap and saves a new promo", async () => {
    mockApi
      .mockResolvedValueOnce({
        promos: [
          {
            code: "ANNUAL20",
            description: "Yearly launch",
            discountType: "percent",
            discountValue: 20,
            userCategory: "business",
            billingCycle: "year",
            minAmountInr: 500,
            maxRedemptions: 100,
            maxPerOrg: 1,
            redemptionsCount: 4,
            totalDiscountInr: 4000,
            expiresAt: null,
            active: true,
            featured: true,
          },
        ],
      })
      .mockResolvedValueOnce({ promo: { code: "SOLO15" } })
      .mockResolvedValueOnce({ promos: [] });

    const onMessage = vi.fn();
    render(<PromoCodesPanel onMessage={onMessage} />);

    await waitFor(() => expect(screen.getByText("ANNUAL20")).toBeTruthy());
    expect(screen.getByText("1/org")).toBeTruthy();
    expect(screen.getByText("₹4,000")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. ANNUAL20/i), {
      target: { value: "solo15" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save promo/i }));

    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/admin/subscriptions/promos",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(onMessage).toHaveBeenCalledWith("Promo code SOLO15 saved.");
  });
});

describe("QuickGrantToolCard", () => {
  it("applies 365d annual preset and posts /admin/subscriptions/grant-tool", async () => {
    mockApi
      .mockResolvedValueOnce({
        skus: [{ toolId: "invoice", name: "Invoice & Billing", priceInr: 500, includedFree: false }],
      })
      .mockResolvedValueOnce({ ok: true, profileCount: 2, periodEnd: "2027-11-26", mrrInr: 500 });

    const onGranted = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    render(
      <QuickGrantToolCard
        organizationId={12}
        onOrganizationChange={vi.fn()}
        onGranted={onGranted}
        onError={onError}
      />,
    );

    await waitFor(() => expect(screen.getByText(/Invoice & Billing/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "365d annual" }));
    fireEvent.click(screen.getByRole("button", { name: /Grant license/i }));

    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/admin/subscriptions/grant-tool",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ organizationId: 12, toolId: "invoice", mode: "paid", days: 365 }),
        }),
      ),
    );
    expect(onGranted).toHaveBeenCalledWith(expect.stringContaining("365d"));
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("TenantLicenseInspector", () => {
  it("lists active tools and triggers +30d extend and Revoke endpoints", async () => {
    mockApi
      .mockResolvedValueOnce({
        licenses: [
          {
            toolId: "invoice",
            toolName: "Invoice & Billing",
            priceInr: 500,
            branchCount: 2,
            periodEnd: "2026-12-01",
            daysLeft: 5,
            isTrial: false,
            source: "upi",
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, mrrInr: 500 })
      .mockResolvedValueOnce({
        licenses: [
          {
            toolId: "invoice",
            toolName: "Invoice & Billing",
            priceInr: 500,
            branchCount: 2,
            periodEnd: "2027-01-01",
            daysLeft: 35,
            isTrial: false,
            source: "admin",
          },
        ],
      })
      .mockResolvedValueOnce({ ok: true, mrrInr: 0 })
      .mockResolvedValueOnce({ licenses: [] });

    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <TenantLicenseInspector
        organizationId={12}
        organizationName="Acme Corp"
        onClose={vi.fn()}
        onChanged={onChanged}
        onError={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("Invoice & Billing")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "+30d" }));

    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/admin/subscriptions/grant-tool",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ organizationId: 12, toolId: "invoice", mode: "paid", days: 30 }),
        }),
      ),
    );
    expect(onChanged).toHaveBeenCalledWith(expect.stringContaining("+30d"));

    await waitFor(() => expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/admin/subscriptions/revoke-tool",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ organizationId: 12, toolId: "invoice" }),
        }),
      ),
    );
  });
});

describe("CommercePolicyPanel", () => {
  it("loads policy, updates live simulator, saves via PUT /policy, and resets defaults", async () => {
    mockApi
      .mockResolvedValueOnce({
        policy: { ...DEFAULT_COMMERCE_POLICY, categoryDiscountPct: { individual: 0, business: 10, enterprise: 20 } },
      })
      .mockResolvedValueOnce({
        policy: { ...DEFAULT_COMMERCE_POLICY, categoryDiscountPct: { individual: 0, business: 10, enterprise: 20 } },
      })
      .mockResolvedValueOnce({ policy: DEFAULT_COMMERCE_POLICY });

    const onMessage = vi.fn();
    const onError = vi.fn();
    render(<CommercePolicyPanel onMessage={onMessage} onError={onError} />);

    await waitFor(() => expect(screen.getByText(/Live pricing, tax & discount simulator/i)).toBeTruthy());
    expect(screen.getByText(/Category \(10%\)/i)).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /Save policy/i })[0]);
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/admin/subscriptions/policy",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    expect(onMessage).toHaveBeenCalledWith(expect.stringContaining("Commerce policy saved"));

    fireEvent.click(screen.getByRole("button", { name: /Reset defaults/i }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "/admin/subscriptions/policy/reset",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(onError).not.toHaveBeenCalled();
  });
});

/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CategoryTierComparison } from "../CategoryTierComparison";
import { StoreCartDock } from "../StoreCartDock";
import { UsageLimitBanner } from "../UsageLimitBanner";
import { BillingHistoryPanel } from "../BillingHistoryPanel";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const mockOpenUpgrade = vi.fn();
const mockStartTrial = vi.fn().mockResolvedValue(undefined);
const mockShowToast = vi.fn();

vi.mock("@/components/common/ToastProvider", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock("@/lib/use-brand-copy", () => ({
  useBrandCopy: () => ({ appName: "JustX", legalName: "JustX Systems Pvt Ltd" }),
}));

let mockSubscriptionValue: Record<string, unknown> = {
  openUpgrade: mockOpenUpgrade,
  isToolLicensed: () => false,
  startTrial: mockStartTrial,
  subscription: {
    pendingClaim: null,
    catalog: [
      {
        toolId: "invoice",
        name: "Invoice & Billing",
        priceInr: 500,
        annualPriceInr: 5000,
        trialEligible: true,
        trialDays: 14,
      },
    ],
  },
};

vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: () => mockSubscriptionValue,
}));

const mockFetchBillingHistory = vi.fn();
vi.mock("@/lib/api", () => ({
  fetchBillingHistory: (...args: unknown[]) => mockFetchBillingHistory(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CategoryTierComparison", () => {
  it("highlights Personal tier and exposes GSTIN / branch upgrade CTAs plus yearly toggle", () => {
    const onSelectCycle = vi.fn();
    render(
      <CategoryTierComparison
        currentCategory="individual"
        branchCount={1}
        billingCycle="month"
        onSelectCycle={onSelectCycle}
      />,
    );

    expect(screen.getByText("Current tier")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Add GSTIN in Profile/i }).getAttribute("href")).toBe(
      "/profile",
    );
    expect(screen.getByRole("link", { name: /Add another branch/i }).getAttribute("href")).toBe(
      "/profile",
    );

    fireEvent.click(screen.getByRole("button", { name: /Preview yearly savings/i }));
    expect(onSelectCycle).toHaveBeenCalledWith("year");
  });

  it("shows multi-branch active count for Enterprise tier", () => {
    render(
      <CategoryTierComparison
        currentCategory="enterprise"
        branchCount={4}
        billingCycle="year"
        onSelectCycle={vi.fn()}
      />,
    );
    expect(screen.getByText("Active across 4 branches")).toBeTruthy();
    expect(screen.getByText(/Yearly active/i)).toBeTruthy();
  });
});

describe("StoreCartDock", () => {
  it("switches cycles, applies Auto-Save pack, and triggers Proforma Quote PDF", () => {
    const onCycle = vi.fn();
    const onPack = vi.fn();
    const onProforma = vi.fn();
    const onClear = vi.fn();

    render(
      <StoreCartDock
        itemCount={2}
        totalLabel="₹900"
        billingCycle="month"
        onBillingCycleChange={onCycle}
        recommendedPack={{
          packId: "finance_suite",
          packName: "Finance Suite",
          packPriceInr: 799,
          cartPriceInr: 900,
          savingsInr: 101,
          extraToolCount: 1,
          extraToolIds: ["ledger"],
          billingCycle: "month",
          reason: "cheaper",
        }}
        onApplyRecommendedPack={onPack}
        lines={[
          { id: "invoice", name: "Invoice", priceLabel: "₹500" },
          { id: "quotation", name: "Quotation", priceLabel: "₹400" },
        ]}
        canCheckout={true}
        onDownloadProforma={onProforma}
        onClear={onClear}
      />,
    );

    // Expand cart dock
    fireEvent.click(screen.getByRole("button", { name: /Cart/i }));
    fireEvent.click(screen.getByRole("button", { name: /Yearly/i }));
    expect(onCycle).toHaveBeenCalledWith("year");

    fireEvent.click(screen.getByRole("button", { name: /Switch to Finance Suite/i }));
    expect(onPack).toHaveBeenCalledWith("finance_suite");

    fireEvent.click(screen.getByRole("button", { name: /Proforma quote PDF/i }));
    expect(onProforma).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Clear cart/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("UsageLimitBanner", () => {
  it("offers 1-click yearly checkout deep link and free trial when at freemium record cap", async () => {
    render(
      <UsageLimitBanner
        usage={{ toolId: "invoice", recordCount: 28, limit: 28, atLimit: true, nearLimit: false }}
        atLimit={true}
        nearLimit={false}
      />,
    );

    expect(screen.getByText(/reached the freemium limit of 28 records/i)).toBeTruthy();
    const yearlyLink = screen.getByRole("link", { name: /Yearly \(₹5,000\/yr · save ₹1,000\)/i });
    expect(yearlyLink.getAttribute("href")).toBe("/subscription/checkout?tool=invoice&cycle=year");

    fireEvent.click(screen.getByRole("button", { name: /Start 14-day trial/i }));
    await waitFor(() => expect(mockStartTrial).toHaveBeenCalledWith("invoice"));
  });
});

describe("BillingHistoryPanel", () => {
  it("filters paid vs pending entries and opens printable GST 18% receipt for GSTIN accounts", async () => {
    mockFetchBillingHistory.mockResolvedValue({
      account: { businessName: "Acme Steel Pvt Ltd", gstin: "27ABCDE1234F1Z5", hasGstin: true },
      entries: [
        {
          id: "upi-1",
          kind: "upi_claim",
          status: "approved",
          amountInr: 1180,
          billingCycle: "year",
          provider: "upi",
          reference: "UTR1234567890",
          toolIds: ["invoice"],
          toolNames: ["Invoice & Billing"],
          payerName: "Acme",
          payerEmail: "acct@acme.in",
          occurredAt: "2026-11-26T00:00:00.000Z",
        },
        {
          id: "upi-2",
          kind: "upi_claim",
          status: "pending",
          amountInr: 500,
          billingCycle: "month",
          provider: "upi",
          reference: "UTR9999999999",
          toolIds: ["ims"],
          toolNames: ["Inventory"],
          occurredAt: "2026-11-26T01:00:00.000Z",
        },
      ],
    });

    const written: string[] = [];
    const openSpy = vi.spyOn(window, "open").mockReturnValue({
      document: {
        open: vi.fn(),
        write: (html: string) => written.push(html),
        close: vi.fn(),
      },
    } as unknown as Window);

    render(<BillingHistoryPanel />);

    await waitFor(() => expect(screen.getByText(/Total paid: ₹1,180/i)).toBeTruthy());
    expect(screen.getByText(/UTR1234567890/)).toBeTruthy();
    expect(screen.getByText(/UTR9999999999/)).toBeTruthy();

    // Filter to Paid only
    fireEvent.click(screen.getByRole("tab", { name: "Paid" }));
    expect(screen.getByText(/UTR1234567890/)).toBeTruthy();
    expect(screen.queryByText(/UTR9999999999/)).toBeNull();

    // Open printable GST receipt
    fireEvent.click(screen.getByRole("button", { name: /Receipt \/ PDF/i }));
    expect(openSpy).toHaveBeenCalled();
    expect(written[0]).toContain("SAC 998314");
    expect(written[0]).toContain("1,000.00");
    expect(written[0]).toContain("180.00");
    openSpy.mockRestore();
  });
});

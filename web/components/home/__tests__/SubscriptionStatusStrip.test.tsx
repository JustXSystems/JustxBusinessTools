/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubscriptionStatusStrip } from "../SubscriptionStatusStrip";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let mockSub: Record<string, unknown> | null = null;
const mockOpenUpgrade = vi.fn();

vi.mock("@/hooks/useSubscription", () => ({
  useSubscription: () => ({ subscription: mockSub, openUpgrade: mockOpenUpgrade }),
}));

afterEach(() => {
  cleanup();
  mockSub = null;
  vi.clearAllMocks();
});

describe("SubscriptionStatusStrip", () => {
  it("renders pending UPI verification status with billing cycle", () => {
    mockSub = {
      pendingClaim: {
        status: "pending",
        utr: "432198765432",
        amountInr: 5000,
        billingCycle: "year",
      },
      catalog: [],
    };
    render(<SubscriptionStatusStrip />);
    expect(screen.getByText("Verification pending")).toBeTruthy();
    expect(screen.getByText(/UTR 432198765432/)).toBeTruthy();
    expect(screen.getByText(/Yearly/)).toBeTruthy();
  });

  it("renders expiring trial banner with direct 1-click yearly checkout link", () => {
    mockSub = {
      pendingClaim: null,
      catalog: [
        {
          toolId: "invoice",
          name: "Invoice & Billing",
          usage: { status: "expiring_soon", isTrial: true, daysLeft: 2 },
        },
      ],
    };
    render(<SubscriptionStatusStrip />);
    expect(screen.getByText("Trial ending soon")).toBeTruthy();
    const cta = screen.getByRole("link", { name: /Convert yearly/i });
    expect(cta.getAttribute("href")).toBe("/subscription/checkout?tool=invoice&cycle=year");
  });

  it("renders usage alert banner with direct tool upgrade link", () => {
    mockSub = {
      pendingClaim: null,
      usageSummary: { toolsAtLimit: 1, toolsNearLimit: 0 },
      catalog: [
        {
          toolId: "ims",
          name: "Inventory",
          usage: { status: "at_limit", atLimit: true },
        },
      ],
    };
    render(<SubscriptionStatusStrip />);
    expect(screen.getByText("Usage alert")).toBeTruthy();
    const cta = screen.getByRole("link", { name: /Upgrade Inventory/i });
    expect(cta.getAttribute("href")).toBe("/subscription/checkout?tool=ims&cycle=year");
  });

  it("renders nothing when workspace has no alerts", () => {
    mockSub = {
      pendingClaim: null,
      usageSummary: { toolsAtLimit: 0, toolsNearLimit: 0 },
      catalog: [],
    };
    const { container } = render(<SubscriptionStatusStrip />);
    expect(container.firstChild).toBeNull();
  });
});

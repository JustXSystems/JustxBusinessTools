// @vitest-environment jsdom
import { render, act, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateLiveData, isUserEditing, useLiveRefresh } from "@/hooks/useLiveRefresh";
import { ToolPricingPane, type SkuState } from "@/components/admin/ToolPricingPane";

let mockPathname = "/admin/tools";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn().mockResolvedValue({ toolPersonalUsage: { imsdealer: false } }),
}));

function Harness({
  onRefresh,
  intervalMs = 10_000,
  pauseWhileEditing = true,
}: {
  onRefresh: () => void;
  intervalMs?: number | null;
  pauseWhileEditing?: boolean;
}) {
  useLiveRefresh(onRefresh, { intervalMs, pauseWhileEditing });
  return (
    <div>
      <input aria-label="price" defaultValue="100" />
      <input aria-label="readonly" readOnly defaultValue="locked" />
      <button type="button">Done</button>
    </div>
  );
}

describe("useLiveRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPathname = "/admin/tools";
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("calls refresh once on mount (no duplicate pathname fire)", () => {
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} />);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("pauses interval and focus refreshes while typing in an editable input", async () => {
    const onRefresh = vi.fn();
    const { getByLabelText, getByText } = render(<Harness onRefresh={onRefresh} intervalMs={5_000} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    const input = getByLabelText("price");
    input.focus();
    expect(isUserEditing()).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // Moving focus to a non-editable button resumes polling
    getByText("Done").focus();
    expect(isUserEditing()).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("does not treat readOnly inputs as active editing", async () => {
    const onRefresh = vi.fn();
    const { getByLabelText } = render(<Harness onRefresh={onRefresh} intervalMs={5_000} />);
    await act(async () => {
      await Promise.resolve();
    });
    getByLabelText("readonly").focus();
    expect(isUserEditing()).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("coalesces rapid visibilitychange + focus bursts and honors explicit invalidation", async () => {
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} intervalMs={null} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      fireEvent(document, new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(onRefresh).toHaveBeenCalledTimes(2);

    await act(async () => {
      invalidateLiveData("admin-tools");
      await Promise.resolve();
    });
    expect(onRefresh).toHaveBeenCalledTimes(3);
  });
});

describe("ToolPricingPane unsaved edit preservation", () => {
  const baseSku: SkuState = {
    toolId: "imsdealer",
    name: "Justxsystems IMS — Dealer",
    category: "Utilities",
    tagline: "Old tagline",
    description: "Old desc",
    priceInr: 499,
    annualPriceInr: 4990,
    billingInterval: "month",
    includedFree: false,
    available: true,
    trialDays: 14,
    accessPolicy: "soft_cap",
    unlicensedRecordLimit: 25,
    featured: false,
  };

  it("keeps unsaved edits when parent re-fetches a fresh sku object for the same tool", () => {
    const onReload = vi.fn().mockResolvedValue(undefined);
    const onMessage = vi.fn();
    const { getByLabelText, rerender } = render(
      <ToolPricingPane
        toolId="imsdealer"
        toolName="Justxsystems IMS — Dealer"
        toolCategory="Utilities"
        sku={{ ...baseSku }}
        licensed={false}
        periodEnd={null}
        recordLimitOverride={null}
        profiles={[{ id: 1, businessName: "Demo", isDefault: true }]}
        businessProfileId={1}
        onBusinessProfileChange={vi.fn()}
        bundles={[]}
        onReload={onReload}
        onMessage={onMessage}
      />,
    );

    const taglineInput = getByLabelText("Tagline") as HTMLInputElement;
    fireEvent.change(taglineInput, { target: { value: "New dealer tagline" } });
    expect(taglineInput.value).toBe("New dealer tagline");

    // Simulate background useLiveRefresh returning a brand-new sku object reference
    rerender(
      <ToolPricingPane
        toolId="imsdealer"
        toolName="Justxsystems IMS — Dealer"
        toolCategory="Utilities"
        sku={{ ...baseSku }}
        licensed={false}
        periodEnd={null}
        recordLimitOverride={null}
        profiles={[{ id: 1, businessName: "Demo", isDefault: true }]}
        businessProfileId={1}
        onBusinessProfileChange={vi.fn()}
        bundles={[]}
        onReload={onReload}
        onMessage={onMessage}
      />,
    );

    expect(taglineInput.value).toBe("New dealer tagline");

    // Switching to another tool SHOULD reset the form to the new tool's SKU
    rerender(
      <ToolPricingPane
        toolId="bos"
        toolName="Justxsystems BOS"
        toolCategory="Utilities"
        sku={{ ...baseSku, toolId: "bos", name: "Justxsystems BOS", tagline: "BOS tagline" }}
        licensed={false}
        periodEnd={null}
        recordLimitOverride={null}
        profiles={[{ id: 1, businessName: "Demo", isDefault: true }]}
        businessProfileId={1}
        onBusinessProfileChange={vi.fn()}
        bundles={[]}
        onReload={onReload}
        onMessage={onMessage}
      />,
    );

    expect((getByLabelText("Tagline") as HTMLInputElement).value).toBe("BOS tagline");
  });
});

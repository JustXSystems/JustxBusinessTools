/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const badReturns: Array<{ value: unknown; hint: string }> = [];

vi.mock("react", async (importOriginal) => {
  const React = await importOriginal<typeof import("react")>();
  const wrap =
    (hook: typeof React.useEffect): typeof React.useEffect =>
    (fn, deps) =>
      hook(() => {
        const result = (fn as () => unknown)();
        if (result !== undefined && typeof result !== "function") {
          badReturns.push({ value: result, hint: Object.prototype.toString.call(result) });
        }
        return typeof result === "function" ? (result as () => void) : undefined;
      }, deps);
  return { ...React, useEffect: wrap(React.useEffect), useLayoutEffect: wrap(React.useLayoutEffect) };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/tools/imsdealer",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn(async () => ({ user: { id: 1, email: "t@x.com", name: "Test", isPlatformAdmin: true, businessProfileId: 1 } })),
  verifyPhoneOtp: vi.fn(),
}));

vi.mock("@/lib/api-base", () => ({
  apiUrl: (p: string) => p,
}));

describe("shell providers effect cleanup", () => {
  afterEach(() => {
    cleanup();
    badReturns.length = 0;
  });

  it("AuthProvider + ConfigProvider + SubscriptionProvider + Bos TimePill unmount cleanly", async () => {
    const { AuthProvider } = await import("@/components/auth/AuthProvider");
    const { ConfigProvider } = await import("@/components/config/ConfigProvider");
    const { SubscriptionProvider } = await import("@/components/subscription/SubscriptionProvider");
    const { BrandingProvider } = await import("@/components/branding/BrandingProvider");
    const { BosRoot, TimePill, AppShell, NavBrand } = await import("@/components/bos");

    // Avoid network: branding soft-revalidate via useLiveRefresh
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ branding: {}, poweredBy: {} }),
      status: 200,
    } as Response);

    const view = render(
      <BrandingProvider>
        <AuthProvider>
          <ConfigProvider>
            <SubscriptionProvider>
              <BosRoot skin="ims" canvas>
                <AppShell
                  brand={<NavBrand name="IMS" mark="I" />}
                  items={[{ key: "a", label: "A", icon: "·", section: "Inventory" }]}
                  active="a"
                  onSelect={() => undefined}
                  footer={<TimePill />}
                >
                  <div>child</div>
                </AppShell>
              </BosRoot>
            </SubscriptionProvider>
          </ConfigProvider>
        </AuthProvider>
      </BrandingProvider>,
    );

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/child|IMS|A/);
    });
    view.unmount();
    expect(badReturns, JSON.stringify(badReturns)).toEqual([]);
  });
});

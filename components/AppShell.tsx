import type { ReactNode } from "react";
import { Header, BottomNavigation } from "@/components/layout/Header";
import { DesktopSidebar } from "@/components/layout/DesktopSidebar";
import { ApiHealthBanner } from "@/components/layout/ApiHealthBanner";
import { OfflineSyncBanner } from "@/components/layout/OfflineSyncBanner";
import { PoweredByFooter } from "@/components/layout/PoweredByFooter";
import { AnalyticsTracker } from "@/components/analytics/AnalyticsTracker";
import { ConfigProvider } from "@/components/config/ConfigProvider";
import { ToastProvider } from "@/components/common/ToastProvider";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { SubscriptionProvider } from "@/components/subscription/SubscriptionProvider";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfigProvider>
        <LocaleProvider>
          <SubscriptionProvider>
            <AnalyticsTracker />
            <ApiHealthBanner />
            <OfflineSyncBanner />
            <div className="operator-layout">
              <DesktopSidebar />
              <div className="operator-main min-h-full">
                <Header />
                <main className="page-shell">{children}</main>
                <PoweredByFooter />
                <BottomNavigation />
              </div>
            </div>
          </SubscriptionProvider>
        </LocaleProvider>
      </ConfigProvider>
    </ToastProvider>
  );
}

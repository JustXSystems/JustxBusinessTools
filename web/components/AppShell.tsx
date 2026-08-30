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
import { SidebarLayoutProvider } from "@/components/layout/SidebarLayoutProvider";
import { OperatorLayoutChrome } from "@/components/layout/OperatorLayoutChrome";
import { OPERATOR_SIDEBAR_KEY } from "@/lib/sidebar-layout";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfigProvider>
        <LocaleProvider>
          <SubscriptionProvider>
            <SidebarLayoutProvider storageKey={OPERATOR_SIDEBAR_KEY}>
              <AnalyticsTracker />
              <ApiHealthBanner />
              <OfflineSyncBanner />
              <OperatorLayoutChrome>
                <DesktopSidebar />
                <div className="operator-main min-h-full">
                  <Header />
                  <main className="page-shell">{children}</main>
                  <PoweredByFooter variant="bar" />
                  <BottomNavigation />
                </div>
              </OperatorLayoutChrome>
            </SidebarLayoutProvider>
          </SubscriptionProvider>
        </LocaleProvider>
      </ConfigProvider>
    </ToastProvider>
  );
}

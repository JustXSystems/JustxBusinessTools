"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  AppShell,
  BosRoot,
  Button,
  CommandPalette,
  ThemeToggle,
  useBosTheme,
  useCommandHotkey,
  type BosCommand,
  type BosNavItem,
} from "@/components/bos";
import { useAuth } from "@/components/auth/AuthProvider";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import { ConfigProvider } from "@/components/config/ConfigProvider";
import { PoweredByFooter } from "@/components/layout/PoweredByFooter";
import { NavIcon } from "@/components/layout/NavIcon";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";
import {
  adminNavigation,
  type AdminNavItem,
} from "@/config/admin-navigation.config";
import { adminDeepLink, type ApprovalsKind } from "@/lib/admin-deep-links";
import "./admin-console.css";

/** Phones / touch-first screens: no keyboard hint, shorter nav search label. */
const COMPACT_QUERY = "(max-width: 900px), (hover: none)";

function subscribeCompact(onChange: () => void) {
  const mq = window.matchMedia(COMPACT_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function useCompactViewport(): boolean {
  return useSyncExternalStore(
    subscribeCompact,
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false,
  );
}

function flatAdminItems(): AdminNavItem[] {
  return adminNavigation.flatMap((s) => s.items);
}

const APPROVAL_KINDS: Array<{ kind: ApprovalsKind; label: string }> = [
  { kind: "profile", label: "Profiles" },
  { kind: "user", label: "Users" },
  { kind: "payment_op", label: "Payment ops" },
  { kind: "upi_claim", label: "UPI claims" },
];

function matchActive(pathname: string, items: AdminNavItem[]): string {
  const exact = items.find((i) => i.exact && pathname === i.href);
  if (exact) return exact.href;
  const ranked = items
    .filter((i) => !i.exact && pathname.startsWith(i.href))
    .sort((a, b) => b.href.length - a.href.length);
  return ranked[0]?.href ?? "/admin";
}

function AdminShellChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { branding } = usePlatformBranding();
  const { theme, setTheme } = useBosTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const compact = useCompactViewport();

  const items = useMemo(() => flatAdminItems(), []);
  const active = matchActive(pathname, items);

  const navItems = useMemo<BosNavItem[]>(
    () =>
      adminNavigation.flatMap((section) =>
        section.items.map((item, idx) => ({
          key: item.href,
          label: item.label,
          section: idx === 0 ? section.label : undefined,
          icon: <NavIcon id={item.icon} />,
        })),
      ),
    [],
  );

  const go = useCallback(
    (href: string) => {
      if (href !== pathname) router.push(href);
    },
    [pathname, router],
  );

  /** Deep links differ by query/hash only, so always push (pathname check would no-op). */
  const goDeep = useCallback((href: string) => router.push(href), [router]);

  /** Platform super still carrying Operator act-as while in Admin Console (it is ignored here). */
  const actingAs = Boolean(user?.isPlatformAdmin && user.actAsRole);

  const commands = useMemo<BosCommand[]>(() => {
    const navCmds: BosCommand[] = items.map((item) => ({
      id: `nav-${item.href}`,
      label: item.label,
      section: "Navigate",
      keywords: item.href,
      icon: <NavIcon id={item.icon} />,
      onSelect: () => go(item.href),
    }));
    const deep = (
      id: string,
      label: string,
      section: string,
      href: string,
      keywords?: string,
    ): BosCommand => ({
      id: `deep-${id}`,
      label,
      section,
      keywords: keywords ? `${keywords} ${href}` : href,
      onSelect: () => goDeep(href),
    });
    const flowCmds: BosCommand[] = [
      deep("approvals-all", "Approvals — all pending", "Approvals", adminDeepLink.approvals(), "queue review"),
      ...APPROVAL_KINDS.map(({ kind, label }) =>
        deep(`approvals-${kind}`, `Approvals — ${label}`, "Approvals", adminDeepLink.approvals(kind), kind),
      ),
      deep("pay-overview", "Payments — Overview", "Payments", adminDeepLink.payments(), "money"),
      deep("pay-saas", "Payments — SaaS charges", "Payments", adminDeepLink.paymentSaas(), "subscription billing"),
      deep("pay-collections", "Payments — Collections", "Payments", adminDeepLink.paymentCollections(), "dues overdue"),
      deep("pay-ops", "Payments — Ops", "Payments", adminDeepLink.paymentOps(), "operations payouts"),
      deep("pay-upi-pending", "Payments — UPI pending claims", "Payments", adminDeepLink.upiClaimPending(), "upi claim verify"),
      deep("plans-renewals", "Plans — Renewals", "Plans", adminDeepLink.subscriptionsRenewals(), "subscriptions expiring"),
      deep("profiles-fabric", "Business Profiles — Fabric", "Business Profiles", adminDeepLink.profileAccess(), "tools licenses ims capabilities"),
      deep("exp-theme", "Experience — Theme", "Experience", adminDeepLink.experienceTheme(), "colors appearance"),
      deep("exp-public-home", "Experience — Public home", "Experience", adminDeepLink.experiencePublicHome(), "landing"),
      deep("analytics-limit-blocks", "Analytics — Limit blocks", "Analytics", adminDeepLink.analytics("limit_blocks"), "quota ceiling upgrade"),
    ];
    return [
      ...navCmds,
      ...flowCmds,
      {
        id: "enter-operator",
        label: "Enter Operator as…",
        section: "Session",
        keywords: "impersonate act as",
        onSelect: () => go("/enter"),
      },
      {
        id: "logout",
        label: "Log out",
        section: "Session",
        onSelect: () => logout(),
      },
    ];
  }, [go, goDeep, items, logout]);

  useCommandHotkey(() => setPaletteOpen(true));

  const appName = branding.appName || "Justxsystems";

  const iconSession = (
    <>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon="palette"
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      />
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon="login"
        aria-label="Enter Operator"
        title="Enter Operator"
        onClick={() => go("/enter")}
      />
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon="x"
        aria-label="Log out"
        title="Log out"
        onClick={() => logout()}
      />
    </>
  );

  /* Compact / collapsed: icon-only so the mobile pill strip and mini rail stay usable */
  const footer =
    compact || collapsed ? (
      <div className="admin-cc-nav-foot">{iconSession}</div>
    ) : (
      <div className="admin-cc-nav-foot">
        <ThemeToggle theme={theme} onChange={setTheme} />
        <p className="admin-cc-session-meta" title={user?.email || undefined}>
          {user?.name || user?.email || "Platform admin"}
        </p>
        <Button variant="ghost" size="sm" block icon="login" onClick={() => go("/enter")}>
          Enter Operator
        </Button>
        <Button variant="ghost" size="sm" block onClick={() => logout()}>
          Log out
        </Button>
      </div>
    );

  return (
    <>
      <AppShell
        size="fill"
        collapsible
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        brand={
          <div className="admin-cc-brand-wrap">
            <PlatformBrandMark href="/admin" size="sm" showText={false} />
            <span className="admin-cc-brand-name">{appName}</span>
          </div>
        }
        items={navItems}
        active={active}
        onSelect={go}
        onSearch={() => setPaletteOpen(true)}
        searchLabel={compact ? "Search" : "Jump to… ⌘K"}
        navLabel="Platform"
        aria-label="Admin navigation"
        footer={footer}
      >
        <div className="admin-cc-main-stack">
          {actingAs ? (
            <div className="admin-cc-scope-chip" role="status">
              <span>
                Admin Console ignores act-as
                {user?.actAsRole ? ` (${user.actAsRole})` : ""}.
              </span>
              <Link href="/enter">Operator /enter</Link>
            </div>
          ) : null}
          <div className="admin-cc-content">{children}</div>
          <PoweredByFooter variant="bar" autoHide />
        </div>
      </AppShell>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        placeholder="Jump to a page or action…"
      />
    </>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>
      <BosRoot canvas className="admin-bos admin-bos-fill" defaultTheme="dark" skin="bos">
        <AdminShellChrome>{children}</AdminShellChrome>
      </BosRoot>
    </ConfigProvider>
  );
}

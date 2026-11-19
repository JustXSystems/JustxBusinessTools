"use client";

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

  const commands = useMemo<BosCommand[]>(() => {
    const navCmds: BosCommand[] = items.map((item) => ({
      id: `nav-${item.href}`,
      label: item.label,
      section: "Navigate",
      keywords: item.href,
      icon: <NavIcon id={item.icon} />,
      onSelect: () => go(item.href),
    }));
    return [
      ...navCmds,
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
  }, [go, items, logout]);

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
          <div className="admin-cc-content">{children}</div>
          <PoweredByFooter variant="bar" />
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

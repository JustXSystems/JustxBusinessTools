import type { SessionUser } from "@/lib/types/auth";
import { canAccessPath } from "@/lib/auth-access";

export type NavIconId =
  | "home"
  | "profile"
  | "notifications"
  | "email"
  | "subscription"
  | "settings"
  | "admin"
  | "dashboard"
  | "approvals"
  | "analytics"
  | "tools"
  | "users"
  | "payments"
  | "gateways"
  | "experience"
  | "audit"
  | "ops"
  | "integrations"
  | "logout"
  | "arrowLeft"
  | "menu"
  | "sync";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconId;
};

export const navigationConfig = {
  workspace: [
    { href: "/", label: "Home", icon: "home" as const },
    { href: "/profile", label: "Business Profile", icon: "profile" as const },
    { href: "/sync", label: "Sync Center", icon: "sync" as const },
    { href: "/email-outbox", label: "Email Outbox", icon: "email" as const },
    { href: "/notifications", label: "Notifications", icon: "notifications" as const },
  ],
  account: [
    { href: "/subscription", label: "My tools", icon: "subscription" as const },
  ],
  /** Alias for workspace — Home / Profile / Sync / Notifications */
  primary: [
    { href: "/", label: "Home", icon: "home" as const },
    { href: "/profile", label: "Business Profile", icon: "profile" as const },
    { href: "/sync", label: "Sync Center", icon: "sync" as const },
    { href: "/email-outbox", label: "Email Outbox", icon: "email" as const },
    { href: "/notifications", label: "Notifications", icon: "notifications" as const },
  ],
  mobileBottom: [
    { href: "/", label: "Home", icon: "home" as const },
    { href: "/sync", label: "Sync", icon: "sync" as const },
    { href: "/email-outbox", label: "Email", icon: "email" as const },
    { href: "/subscription", label: "Tools", icon: "subscription" as const },
    { href: "/notifications", label: "Alerts", icon: "notifications" as const },
  ],
} as const;

/** Workspace + account nav items visible for the signed-in role. */
export function operatorNavForUser(user: SessionUser | null | undefined): {
  workspace: NavItem[];
  account: NavItem[];
} {
  const workspace = navigationConfig.workspace.filter((item) => canAccessPath(user, item.href));
  const account = navigationConfig.account.filter((item) => canAccessPath(user, item.href));
  return { workspace: [...workspace], account: [...account] };
}

/** Mobile bottom bar — keep at most 4 items, prefer role-allowed entries. */
export function mobileNavForUser(user: SessionUser | null | undefined): NavItem[] {
  const allowed = navigationConfig.mobileBottom.filter((item) => canAccessPath(user, item.href));
  if (allowed.length <= 4) return [...allowed];
  // Prefer Home, primary work area, Tools, Alerts when trimming.
  const prefer = ["/", "/email-outbox", "/sync", "/subscription", "/notifications"];
  const ranked = [...allowed].sort(
    (a, b) => prefer.indexOf(a.href) - prefer.indexOf(b.href),
  );
  return ranked.slice(0, 4);
}

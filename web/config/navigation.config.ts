export type NavIconId =
  | "home"
  | "profile"
  | "notifications"
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
  | "logout"
  | "arrowLeft"
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
    { href: "/notifications", label: "Notifications", icon: "notifications" as const },
  ],
  mobileBottom: [
    { href: "/", label: "Home", icon: "home" as const },
    { href: "/sync", label: "Sync", icon: "sync" as const },
    { href: "/subscription", label: "Tools", icon: "subscription" as const },
    { href: "/notifications", label: "Alerts", icon: "notifications" as const },
  ],
} as const;

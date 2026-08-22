import type { NavIconId } from "@/config/navigation.config";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: NavIconId;
  exact?: boolean;
};

export type AdminNavSection = {
  id: string;
  label: string;
  items: AdminNavItem[];
};

export const adminNavigation: AdminNavSection[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { href: "/admin", label: "Dashboard", icon: "dashboard", exact: true },
      { href: "/admin/analytics", label: "Analytics", icon: "analytics" },
      { href: "/admin/approvals", label: "Approvals", icon: "approvals" },
    ],
  },
  {
    id: "directory",
    label: "Directory",
    items: [
      { href: "/admin/profiles", label: "Business profiles", icon: "profile" },
      { href: "/admin/team", label: "Users", icon: "users" },
    ],
  },
  {
    id: "catalog",
    label: "Catalog",
    items: [
      { href: "/admin/tools", label: "Tools", icon: "tools" },
      { href: "/admin/experience", label: "Experience", icon: "experience" },
    ],
  },
  {
    id: "billing",
    label: "Billing",
    items: [
      { href: "/admin/subscriptions", label: "Plans & entitlements", icon: "subscription" },
      { href: "/admin/payments", label: "Payments", icon: "payments" },
      { href: "/admin/gateways", label: "Gateways", icon: "gateways" },
    ],
  },
  {
    id: "security",
    label: "Security",
    items: [{ href: "/admin/audit", label: "Audit", icon: "audit" }],
  },
];

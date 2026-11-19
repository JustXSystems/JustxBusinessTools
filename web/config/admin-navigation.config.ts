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
      { href: "/admin", label: "Command center", icon: "dashboard", exact: true },
      { href: "/admin/analytics", label: "Analytics", icon: "analytics" },
      { href: "/admin/approvals", label: "Approvals", icon: "approvals" },
    ],
  },
  {
    id: "directory",
    label: "Access",
    items: [
      { href: "/admin/profiles", label: "Business Profiles", icon: "profile" },
      { href: "/admin/team", label: "People", icon: "users" },
    ],
  },
  {
    id: "catalog",
    label: "Product",
    items: [
      { href: "/admin/tools", label: "Catalog", icon: "tools" },
      { href: "/admin/experience", label: "Experience", icon: "experience" },
    ],
  },
  {
    id: "billing",
    label: "Revenue",
    items: [
      { href: "/admin/subscriptions", label: "Plans", icon: "subscription" },
      { href: "/admin/payments", label: "Payments", icon: "payments" },
      { href: "/admin/gateways", label: "Gateways", icon: "gateways" },
    ],
  },
  {
    id: "security",
    label: "Platform",
    items: [
      { href: "/admin/integrations", label: "Integrations", icon: "integrations" },
      { href: "/admin/audit", label: "Audit", icon: "audit" },
      { href: "/admin/ops", label: "Operations", icon: "ops" },
    ],
  },
];

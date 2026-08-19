export const navigationConfig = {
  primary: [
    { href: "/", label: "Home", icon: "🏠" },
    { href: "/profile", label: "Business Profile", icon: "🏢" },
    { href: "/notifications", label: "Notifications", icon: "🔔" },
  ],
  mobileBottom: [
    { href: "/", label: "Home", icon: "🏠" },
    { href: "/profile", label: "Profile", icon: "🏢" },
    { href: "/settings", label: "Settings", icon: "⚙️" },
    { href: "/notifications", label: "Alerts", icon: "🔔" },
  ],
} as const;

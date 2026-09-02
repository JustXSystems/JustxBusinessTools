import type { ReactNode } from "react";
import type { NavIconId } from "@/config/navigation.config";

type IconProps = { className?: string };

function Svg({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function NavIcon({ id, className }: { id: NavIconId; className?: string }) {
  const props: IconProps = { className };
  switch (id) {
    case "home":
      return (
        <Svg {...props}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5.5 9.5V20h13V9.5" />
          <path d="M10 20v-6h4v6" />
        </Svg>
      );
    case "dashboard":
      return (
        <Svg {...props}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        </Svg>
      );
    case "profile":
      return (
        <Svg {...props}>
          <path d="M4 20V6a2 2 0 0 1 2-2h8l6 6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
          <path d="M14 4v6h6" />
          <path d="M8 13h5M8 17h8" />
        </Svg>
      );
    case "sync":
      return (
        <Svg {...props}>
          <path d="M21 12a9 9 0 0 0-15.5-6.4" />
          <path d="M3 4v5h5" />
          <path d="M3 12a9 9 0 0 0 15.5 6.4" />
          <path d="M21 20v-5h-5" />
        </Svg>
      );
    case "notifications":
      return (
        <Svg {...props}>
          <path d="M6 9a6 6 0 1 1 12 0c0 3.5 1.5 5 2 6H4c.5-1 2-2.5 2-6Z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </Svg>
      );
    case "subscription":
      return (
        <Svg {...props}>
          <path d="M12 3 14.5 8.5 20.5 9.5 16 13.8 17.2 19.8 12 17 6.8 19.8 8 13.8 3.5 9.5 9.5 8.5 12 3Z" />
        </Svg>
      );
    case "settings":
      return (
        <Svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2.2M12 18.8V21M4.9 6.5l1.6 1.6M17.5 17.9l1.6 1.6M3 12h2.2M18.8 12H21M4.9 17.5l1.6-1.6M17.5 6.1l1.6-1.6" />
        </Svg>
      );
    case "admin":
      return (
        <Svg {...props}>
          <path d="M12 3 4 7v5c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V7l-8-4Z" />
          <path d="M9.5 12.5 11 14l3.5-3.5" />
        </Svg>
      );
    case "approvals":
      return (
        <Svg {...props}>
          <path d="M9 11.5 11 13.5 15.5 9" />
          <path d="M12 3 4 7v5c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V7l-8-4Z" />
        </Svg>
      );
    case "analytics":
      return (
        <Svg {...props}>
          <path d="M4 19h16" />
          <path d="M7 16V10" />
          <path d="M12 16V6" />
          <path d="M17 16v-4" />
        </Svg>
      );
    case "tools":
      return (
        <Svg {...props}>
          <path d="M14.5 6.5a4 4 0 0 0 3 3L20 12l-2 2-2.5-2.5a4 4 0 0 0-3-3L10 6l2-2 2.5 2.5Z" />
          <path d="M5 19 11 13" />
        </Svg>
      );
    case "users":
      return (
        <Svg {...props}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19c.8-3 2.8-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M14.5 19c.5-1.8 1.6-2.8 3.5-3" />
        </Svg>
      );
    case "payments":
      return (
        <Svg {...props}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M3 10h18" />
          <path d="M7 15h4" />
        </Svg>
      );
    case "gateways":
      return (
        <Svg {...props}>
          <path d="M12 3v6" />
          <path d="M8 9h8" />
          <path d="M7 21v-5a5 5 0 0 1 10 0v5" />
          <path d="M5 21h4M15 21h4" />
        </Svg>
      );
    case "experience":
      return (
        <Svg {...props}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" />
          <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
        </Svg>
      );
    case "audit":
      return (
        <Svg {...props}>
          <path d="M8 4h8a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2Z" />
          <path d="M9 10h6M9 14h4" />
        </Svg>
      );
    case "ops":
      return (
        <Svg {...props}>
          <path d="M4 7h16M4 12h10M4 17h13" />
          <circle cx="18" cy="12" r="2" />
          <circle cx="19" cy="17" r="2" />
        </Svg>
      );
    case "logout":
      return (
        <Svg {...props}>
          <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
          <path d="M15 16l4-4-4-4" />
          <path d="M19 12H10" />
        </Svg>
      );
    case "arrowLeft":
      return (
        <Svg {...props}>
          <path d="M15 6 9 12l6 6" />
          <path d="M9 12h11" />
        </Svg>
      );
    default:
      return null;
  }
}

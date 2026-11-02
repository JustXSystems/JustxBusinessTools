import Link from "next/link";
import type { CtaButton } from "@/lib/public-home/types";
import { withBasePath } from "@/lib/base-path";

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href) || href.startsWith("mailto:");
}

/** App-relative path for Next `<Link>` (no basePath — Next adds it). */
function appPath(href: string): string {
  const raw = String(href || "#").trim() || "#";
  if (raw.startsWith("#") || isExternal(raw)) return raw;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

/** Absolute browser href for plain `<a>` tags. */
function browserHref(href: string): string {
  const raw = appPath(href);
  if (raw.startsWith("#") || isExternal(raw)) return raw;
  return withBasePath(raw);
}

export function PhCtaButtons({ actions }: { actions: CtaButton[] }) {
  if (!actions?.length) return null;
  return (
    <div className="ph-actions">
      {actions.map((btn) => {
        const className = `ph-btn ph-btn-${btn.variant || "primary"}`;
        const path = appPath(btn.href);
        if (btn.openInNewTab || isExternal(path)) {
          return (
            <a
              key={btn.id}
              className={className}
              href={browserHref(btn.href)}
              target={btn.openInNewTab ? "_blank" : undefined}
              rel={btn.openInNewTab ? "noopener noreferrer" : undefined}
            >
              {btn.label}
            </a>
          );
        }
        if (path.startsWith("#")) {
          return (
            <a key={btn.id} className={className} href={path}>
              {btn.label}
            </a>
          );
        }
        return (
          <Link key={btn.id} className={className} href={path}>
            {btn.label}
          </Link>
        );
      })}
    </div>
  );
}

export function PhNavLink({
  href,
  label,
  openInNewTab,
  onClick,
}: {
  href: string;
  label: string;
  openInNewTab?: boolean;
  onClick?: () => void;
}) {
  const path = appPath(href);
  if (openInNewTab || isExternal(path)) {
    return (
      <a href={browserHref(href)} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        {label}
      </a>
    );
  }
  if (path.startsWith("#")) {
    return (
      <a href={path} onClick={onClick}>
        {label}
      </a>
    );
  }
  return (
    <Link href={path} onClick={onClick}>
      {label}
    </Link>
  );
}

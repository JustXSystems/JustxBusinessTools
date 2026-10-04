"use client";

import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { BosIcon } from "../icons";
import { cx } from "../cx";
import { revealInline } from "../scroll";

export type BosNavItem<K extends string = string> = {
  key: K;
  label: string;
  /** Emoji or short glyph shown in the 18px icon slot. */
  icon?: ReactNode;
  /** Group label rendered above the first item of each section. */
  section?: string;
};

export type BosAppShellProps<K extends string> = {
  brand?: ReactNode;
  items: ReadonlyArray<BosNavItem<K>>;
  active: K;
  onSelect: (key: K) => void;
  /** Accent for the active item: blue (default) or emerald (Finance). */
  accent?: "blue" | "emerald";
  /** Optional nav search affordance (opens the command palette). */
  onSearch?: () => void;
  searchLabel?: string;
  navLabel?: string;
  footer?: ReactNode;
  /** `fixed` = 480px demo frame, `fill` = fills its parent, default = natural height. */
  size?: "auto" | "fixed" | "fill";
  children: ReactNode;
  "aria-label"?: string;
};

/** Module workspace: 236px sidebar + main panel. Under 900px the sidebar becomes a scrolling pill strip. */
export function AppShell<K extends string>({
  brand,
  items,
  active,
  onSelect,
  accent = "blue",
  onSearch,
  searchLabel = "Search…",
  navLabel,
  footer,
  size = "auto",
  children,
  ...aria
}: BosAppShellProps<K>) {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    revealInline(navRef.current, navRef.current?.querySelector(".bos-nav-item.is-active"));
  }, [active]);

  return (
    <div className={cx("bos-shell", size === "fixed" && "bos-shell-fixed", size === "fill" && "bos-shell-fill")}>
      <nav ref={navRef} className={cx("bos-nav", accent === "emerald" && "bos-nav-emerald")} aria-label={aria["aria-label"] ?? "Module navigation"}>
        {brand ? <div className="bos-nav-brand">{brand}</div> : null}
        {onSearch ? (
          <button type="button" className="bos-nav-search" onClick={onSearch} aria-label={searchLabel}>
            <BosIcon name="search" />
            <span className="bos-nav-search-label">{searchLabel}</span>
          </button>
        ) : null}
        {navLabel ? <div className="bos-nav-label">{navLabel}</div> : null}
        {items.map((item, i) => (
          <Fragment key={item.key}>
            {item.section && item.section !== items[i - 1]?.section ? <div className="bos-nav-label">{item.section}</div> : null}
            <button
              type="button"
              className={cx("bos-nav-item", item.key === active && "is-active")}
              aria-current={item.key === active ? "page" : undefined}
              onClick={() => onSelect(item.key)}
            >
              {item.icon ? (
                <span className="bos-nav-ic" aria-hidden="true">
                  {item.icon}
                </span>
              ) : null}
              <span className="bos-nav-item-label">{item.label}</span>
            </button>
          </Fragment>
        ))}
        {footer ? <div className="bos-nav-foot">{footer}</div> : null}
      </nav>
      <main className="bos-shell-main">{children}</main>
    </div>
  );
}

/** Logo + name for the nav header. Use `mark` for the gradient "J" tile. */
export function NavBrand({ name, logoSrc, mark }: { name: ReactNode; logoSrc?: string; mark?: string }) {
  return (
    <>
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- static brand asset under the app base path
        <img src={logoSrc} alt="" />
      ) : (
        <span className="bos-nav-brand-mark" aria-hidden="true">
          {mark ?? "J"}
        </span>
      )}
      <span className="bos-nav-brand-name">{name}</span>
    </>
  );
}

/** "Employee Management (Directory & profiles)" ……… "Justx BOS" */
export function ModuleHeader({ title, sub, brand = "Justx BOS" }: { title: ReactNode; sub?: ReactNode; brand?: ReactNode }) {
  return (
    <div className="bos-module-head">
      <div>
        <span className="bos-module-title">{title}</span>
        {sub ? <span className="bos-module-sub"> ({sub})</span> : null}
      </div>
      {brand ? <span className="bos-module-brand">{brand}</span> : null}
    </div>
  );
}

export function ModuleToolbar({ children }: { children: ReactNode }) {
  return <div className="bos-module-toolbar">{children}</div>;
}

/** AI insight pill with an optional "Review" action. */
export function AiPill({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="bos-ai-pill" role="note">
      <BosIcon name="sparkle" width={12} height={12} />
      <span className="bos-ai-pill-text">{children}</span>
      {action}
    </div>
  );
}

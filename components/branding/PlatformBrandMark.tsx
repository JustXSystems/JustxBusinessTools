"use client";

import Link from "next/link";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";

type Size = "sm" | "md" | "lg" | "xl";

type Props = {
  href?: string;
  size?: Size;
  showText?: boolean;
  layout?: "row" | "stack";
  className?: string;
  /** Override branding logo (e.g. splash with freshly fetched config). */
  logoUrl?: string;
  appName?: string;
  tagline?: string;
};

const SIZES: Record<Size, number> = {
  sm: 36,
  md: 44,
  lg: 72,
  xl: 112,
};

export function PlatformBrandMark({
  href,
  size = "md",
  showText = true,
  layout = "row",
  className = "",
  logoUrl,
  appName,
  tagline,
}: Props) {
  const { branding } = usePlatformBranding();
  const px = SIZES[size];
  const src = logoUrl || branding.logoUrl;
  const name = appName || branding.appName;
  const sub = tagline || branding.tagline;
  // Bust HTTP cache when logo URL is reused after an admin upload replace.
  const imgSrc =
    !src || src.startsWith("data:") || src.startsWith("blob:")
      ? src
      : `${src}${src.includes("?") ? "&" : "?"}bn=${encodeURIComponent(name)}`;

  const inner = (
    <>
      <span className={`platform-brand-logo-frame size-${size}`} style={{ width: px, height: px }}>
        <img className="platform-brand-logo" src={imgSrc} alt="" width={px} height={px} />
      </span>
      {showText ? (
        <div className="brand-text">
          <span className="brand-name">{name}</span>
          {sub ? <span className="brand-sub">{sub}</span> : null}
        </div>
      ) : null}
    </>
  );

  const cls = `brand platform-brand platform-brand-${layout} ${className}`.trim();

  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }

  return <div className={cls}>{inner}</div>;
}

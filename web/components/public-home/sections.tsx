"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TOOL_CATALOG } from "@/config/tools.config";
import { sectionInlineStyle, hasRenderableMedia } from "@/lib/public-home/style";
import type {
  CtaSection,
  FeaturesSection,
  FooterSection,
  HeaderSection,
  HeroSection,
  MarqueeSection,
  ToolsShowcaseSection,
} from "@/lib/public-home/types";
import { PhCtaButtons, PhNavLink } from "./PhCta";
import { PhMedia } from "./PhMedia";

function BrandLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const raw = String(href || "/").trim() || "/";
  if (raw.startsWith("#") || /^https?:\/\//i.test(raw)) {
    return (
      <a className="ph-brand" href={raw}>
        {children}
      </a>
    );
  }
  return (
    <Link className="ph-brand" href={raw.startsWith("/") ? raw : `/${raw}`}>
      {children}
    </Link>
  );
}

function SectionShell({
  id,
  style,
  className,
  backdrop,
  children,
}: {
  id: string;
  style: HeaderSection["style"];
  className?: string;
  backdrop?: React.ReactNode;
  children: React.ReactNode;
}) {
  const inline = sectionInlineStyle(style);
  if (style.maxWidth) {
    (inline as Record<string, string>)["--ph-max"] = style.maxWidth;
  }
  const cssId =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(id)
      : id.replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <section id={id} className={className} style={inline}>
      {style.backgroundOverlay ? (
        <div className="ph-overlay" style={{ background: style.backgroundOverlay }} />
      ) : null}
      {style.backgroundType === "video" && style.backgroundValue ? (
        <video
          className="ph-overlay"
          style={{ objectFit: "cover", width: "100%", height: "100%" }}
          src={style.backgroundValue}
          autoPlay
          muted
          loop
          playsInline
        />
      ) : null}
      {backdrop}
      <div className="ph-inner">{children}</div>
      {style.customCss && cssId ? <style>{`#${cssId}{${style.customCss}}`}</style> : null}
    </section>
  );
}

export function PhHeaderSection({ section }: { section: HeaderSection }) {
  const [open, setOpen] = useState(false);
  const inline = sectionInlineStyle(section.style);
  return (
    <header
      className={`ph-header ${section.sticky ? "is-sticky" : ""}`}
      style={inline}
      id={section.id}
    >
      <div className="ph-inner">
        <div className="ph-header-row">
          <BrandLink href={section.logoHref || "/"}>
            {hasRenderableMedia(section.logo) ? <PhMedia media={section.logo} /> : null}
            {section.logoText ? <span>{section.logoText}</span> : null}
          </BrandLink>
          <nav className="ph-nav" aria-label="Primary">
            {section.menus.map((m) => (
              <PhNavLink key={m.id} href={m.href} label={m.label} openInNewTab={m.openInNewTab} />
            ))}
          </nav>
          <div className="ph-actions desktop-only">
            <PhCtaButtons actions={section.actions} />
          </div>
          <button
            type="button"
            className="ph-menu-toggle"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            ☰
          </button>
        </div>
        <div className={`ph-mobile-nav ${open ? "is-open" : ""}`}>
          {section.menus.map((m) => (
            <PhNavLink
              key={m.id}
              href={m.href}
              label={m.label}
              openInNewTab={m.openInNewTab}
              onClick={() => setOpen(false)}
            />
          ))}
          <PhCtaButtons actions={section.actions} />
        </div>
      </div>
    </header>
  );
}

export function PhHeroSection({ section }: { section: HeroSection }) {
  const asBackground =
    section.mediaPosition === "background" && hasRenderableMedia(section.media);
  const mediaClass =
    section.mediaPosition === "background"
      ? ""
      : `has-media-${section.mediaPosition}`;
  const showSideMedia =
    hasRenderableMedia(section.media) && section.mediaPosition !== "background";

  return (
    <SectionShell
      id={section.id}
      style={section.style}
      className="ph-shell"
      backdrop={
        asBackground ? (
          <div className="ph-overlay" style={{ overflow: "hidden" }} aria-hidden>
            <PhMedia media={section.media} />
          </div>
        ) : null
      }
    >
      <div className={`ph-hero ${showSideMedia ? mediaClass : ""}`}>
        <div className="ph-hero-copy ph-rise">
          {section.eyebrow ? <div className="ph-eyebrow">{section.eyebrow}</div> : null}
          <h1 className="ph-display">{section.headline}</h1>
          {section.subheadline ? <p className="ph-lead">{section.subheadline}</p> : null}
          <div style={{ marginTop: "1.6rem" }}>
            <PhCtaButtons actions={section.actions} />
          </div>
        </div>
        {showSideMedia ? (
          <div className="ph-hero-media ph-rise-delay">
            <PhMedia media={section.media} />
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}

export function PhMarqueeSection({ section }: { section: MarqueeSection }) {
  const items = useMemo(() => {
    if (section.source === "custom" && section.items.length) {
      return section.items;
    }
    const byId = new Map(TOOL_CATALOG.map((t) => [t.id, t]));
    const ids = section.toolIds.length
      ? section.toolIds
      : Array.from(new Set(TOOL_CATALOG.map((t) => t.id))).slice(0, 14);
    return ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((t) => ({
        id: t!.id,
        label: t!.name,
        icon: t!.icon,
        href: "",
        media: { kind: "none" as const, url: "", alt: "", objectFit: "cover" as const, posterUrl: "" },
      }));
  }, [section]);

  const loop = [...items, ...items];

  return (
    <SectionShell
      id={section.id}
      style={section.style}
      className={`ph-marquee ${section.pauseOnHover ? "is-pause" : ""} ${
        section.direction === "right" ? "is-right" : ""
      }`}
    >
      {section.title ? <div className="ph-marquee-title">{section.title}</div> : null}
      <div
        className="ph-marquee-track"
        style={{ ["--ph-marquee-speed" as string]: `${section.speedSec || 38}s` }}
      >
        {loop.map((item, i) => (
          <span key={`${item.id}-${i}`} className="ph-marquee-item">
            {item.icon ? <span aria-hidden>{item.icon}</span> : null}
            {hasRenderableMedia(item.media) ? (
              <PhMedia media={item.media} className="ph-media" />
            ) : null}
            <span>{item.label}</span>
          </span>
        ))}
      </div>
    </SectionShell>
  );
}

export function PhToolsShowcaseSection({ section }: { section: ToolsShowcaseSection }) {
  const tools = useMemo(() => {
    if (section.source === "custom" && section.tools.length) return section.tools;
    const byId = new Map(TOOL_CATALOG.map((t) => [t.id, t]));
    const ids = section.toolIds.length
      ? section.toolIds
      : Array.from(new Set(TOOL_CATALOG.map((t) => t.id))).slice(0, 8);
    return ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((t) => ({
        id: t!.id,
        toolId: t!.id,
        name: t!.name,
        description: t!.desc,
        icon: t!.icon,
        screenshot: {
          kind: "none" as const,
          url: "",
          alt: "",
          objectFit: "cover" as const,
          posterUrl: "",
        },
        featureScreenshots: [],
        features: [],
        href: "/register",
        ctaLabel: "Explore",
      }));
  }, [section]);

  return (
    <SectionShell id={section.id} style={section.style} className="ph-shell">
      <div className="ph-section-head">
        {section.eyebrow ? <div className="ph-eyebrow">{section.eyebrow}</div> : null}
        <h2>{section.title}</h2>
        {section.subtitle ? <p>{section.subtitle}</p> : null}
      </div>
      <div className="ph-tools-grid">
        {tools.map((tool) => (
          <article key={tool.id} className="ph-tool-card">
            {hasRenderableMedia(tool.screenshot) ? (
              <div className="ph-tool-shot">
                <PhMedia media={tool.screenshot} />
              </div>
            ) : null}
            {tool.icon ? <div className="ph-tool-icon">{tool.icon}</div> : null}
            <h3>{tool.name}</h3>
            <p>{tool.description}</p>
            {tool.features?.length ? (
              <ul className="ph-feature-list">
                {tool.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : null}
            {tool.featureScreenshots?.filter((m) => hasRenderableMedia(m)).length ? (
              <div className="ph-tools-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                {tool.featureScreenshots.map((shot, i) =>
                  hasRenderableMedia(shot) ? (
                    <div key={i} className="ph-tool-shot">
                      <PhMedia media={shot} />
                    </div>
                  ) : null,
                )}
              </div>
            ) : null}
            {tool.href && tool.ctaLabel ? (
              <div style={{ marginTop: "auto", paddingTop: "0.5rem" }}>
                <PhCtaButtons
                  actions={[
                    {
                      id: `${tool.id}-cta`,
                      label: tool.ctaLabel,
                      href: tool.href,
                      variant: "secondary",
                      openInNewTab: false,
                    },
                  ]}
                />
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </SectionShell>
  );
}

export function PhFeaturesSection({ section }: { section: FeaturesSection }) {
  return (
    <SectionShell id={section.id} style={section.style} className="ph-shell">
      <div className="ph-section-head">
        {section.eyebrow ? <div className="ph-eyebrow">{section.eyebrow}</div> : null}
        <h2>{section.title}</h2>
        {section.subtitle ? <p>{section.subtitle}</p> : null}
      </div>
      <div className="ph-features">
        {section.items.map((item, index) => {
          const hasMedia = hasRenderableMedia(item.media);
          return (
            <div
              key={item.id}
              className={`ph-feature-row ${hasMedia ? "has-media" : ""} ${
                section.layout === "alternating" && index % 2 === 1 ? "is-flip" : ""
              }`}
            >
              <div className="ph-feature-copy">
                {item.icon ? <div className="ph-tool-icon">{item.icon}</div> : null}
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
              {hasMedia ? (
                <div className="ph-feature-media">
                  <PhMedia media={item.media} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </SectionShell>
  );
}

export function PhCtaSection({ section }: { section: CtaSection }) {
  return (
    <SectionShell id={section.id} style={section.style} className="ph-shell ph-cta">
      <div className="ph-cta-panel">
        <h2>{section.title}</h2>
        {section.subtitle ? <p>{section.subtitle}</p> : null}
        <div style={{ marginTop: "1.5rem" }}>
          <PhCtaButtons actions={section.actions} />
        </div>
      </div>
    </SectionShell>
  );
}

export function PhFooterSection({ section }: { section: FooterSection }) {
  return (
    <SectionShell id={section.id} style={section.style} className="ph-shell ph-footer">
      <div className="ph-footer-grid">
        <div className="ph-footer-brand">
          <div className="ph-brand">
            {hasRenderableMedia(section.logo) ? <PhMedia media={section.logo} /> : null}
            {section.logoText ? <span>{section.logoText}</span> : null}
          </div>
          {section.tagline ? <p>{section.tagline}</p> : null}
        </div>
        {section.columns.map((col) => (
          <div key={col.id}>
            <h4>{col.title}</h4>
            <div className="ph-footer-links">
              {col.links.map((link) => (
                <PhNavLink
                  key={link.id}
                  href={link.href}
                  label={link.label}
                  openInNewTab={link.openInNewTab}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {section.legalText ? <div className="ph-footer-legal">{section.legalText}</div> : null}
    </SectionShell>
  );
}

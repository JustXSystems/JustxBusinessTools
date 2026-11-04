"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TOOL_CATALOG } from "@/config/tools.config";
import { sectionInlineStyle, hasRenderableMedia } from "@/lib/public-home/style";
import type {
  CtaSection,
  FeaturesSection,
  FooterSection,
  HeaderSection,
  HeroSection,
  HeroSlide,
  MarqueeSection,
  PillarsSection,
  StatsSection,
  ToolsShowcaseSection,
} from "@/lib/public-home/types";
import { EMPTY_MEDIA } from "@/lib/public-home/types";
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

function slideFromLegacy(section: HeroSection): HeroSlide {
  return {
    id: `${section.id}-legacy`,
    eyebrow: section.eyebrow,
    headline: section.headline,
    subheadline: section.subheadline,
    words: [],
    actions: section.actions,
    background: EMPTY_MEDIA,
  };
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
  const slides = section.slides.length ? section.slides : [slideFromLegacy(section)];
  const [active, setActive] = useState(0);
  const current = slides[Math.min(active, slides.length - 1)] ?? slides[0];
  const cinematic = section.slides.length > 0 || section.mediaPosition === "background";

  useEffect(() => {
    if (slides.length < 2 || !section.autoplaySec) return;
    const ms = Math.max(3, section.autoplaySec) * 1000;
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % slides.length);
    }, ms);
    return () => window.clearInterval(id);
  }, [slides.length, section.autoplaySec]);

  const asBackground =
    !cinematic &&
    section.mediaPosition === "background" &&
    hasRenderableMedia(section.media);
  const mediaClass =
    section.mediaPosition === "background"
      ? ""
      : `has-media-${section.mediaPosition}`;
  const showSideMedia =
    !cinematic &&
    hasRenderableMedia(section.media) &&
    section.mediaPosition !== "background";

  if (cinematic) {
    return (
      <SectionShell
        id={section.id}
        style={section.style}
        className="ph-shell ph-hero-cinematic"
        backdrop={
          <div className="ph-hero-bgs" aria-hidden>
            {slides.map((slide, i) => (
              <div
                key={slide.id}
                className={`ph-hero-bg ${i === active ? "is-on" : ""} ${
                  hasRenderableMedia(slide.background) ? "has-media" : `tint-${(i % 3) + 1}`
                }`}
              >
                {hasRenderableMedia(slide.background) ? (
                  <PhMedia media={slide.background} className="ph-hero-bg-media" />
                ) : null}
              </div>
            ))}
            <div className="ph-hero-grid-mask" />
          </div>
        }
      >
        <div className="ph-hero-stage">
          <div className="ph-hero-copy ph-rise" key={current.id}>
            {section.brandLabel ? (
              <div className="ph-brand-signal">{section.brandLabel}</div>
            ) : null}
            {current.eyebrow ? <div className="ph-eyebrow">{current.eyebrow}</div> : null}
            <h1 className="ph-display">{current.headline}</h1>
            {current.words.length ? (
              <div className="ph-hero-words" aria-hidden>
                {current.words.map((w, i) => (
                  <span key={`${w}-${i}`}>
                    {i > 0 ? <span className="ph-hero-word-sep">·</span> : null}
                    <span>{w}</span>
                  </span>
                ))}
              </div>
            ) : null}
            {current.subheadline ? <p className="ph-lead">{current.subheadline}</p> : null}
            <div className="ph-hero-actions">
              <PhCtaButtons actions={current.actions.length ? current.actions : section.actions} />
            </div>
            {section.chips.length ? (
              <div className="ph-hero-chips">
                {section.chips.map((chip) => (
                  <span key={chip} className="ph-hero-chip">
                    {chip}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {slides.length > 1 ? (
            <div className="ph-hero-dots" role="tablist" aria-label="Hero slides">
              {slides.map((slide, i) => (
                <button
                  key={slide.id}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  aria-label={`Show slide ${i + 1}`}
                  className={`ph-hero-dot ${i === active ? "is-on" : ""}`}
                  onClick={() => setActive(i)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </SectionShell>
    );
  }

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
          {section.brandLabel ? (
            <div className="ph-brand-signal">{section.brandLabel}</div>
          ) : null}
          {section.eyebrow ? <div className="ph-eyebrow">{section.eyebrow}</div> : null}
          <h1 className="ph-display">{section.headline}</h1>
          {section.subheadline ? <p className="ph-lead">{section.subheadline}</p> : null}
          <div className="ph-hero-actions">
            <PhCtaButtons actions={section.actions} />
          </div>
          {section.chips.length ? (
            <div className="ph-hero-chips">
              {section.chips.map((chip) => (
                <span key={chip} className="ph-hero-chip">
                  {chip}
                </span>
              ))}
            </div>
          ) : null}
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

export function PhStatsSection({ section }: { section: StatsSection }) {
  return (
    <SectionShell id={section.id} style={section.style} className="ph-shell ph-stats">
      <div className="ph-stats-grid">
        {section.items.map((item) => (
          <div key={item.id} className="ph-stat">
            <div className="ph-stat-icon" aria-hidden>
              {hasRenderableMedia(item.media) ? (
                <PhMedia media={item.media} />
              ) : (
                <span>{item.icon || "◆"}</span>
              )}
            </div>
            <div className="ph-stat-value">{item.value}</div>
            <div className="ph-stat-label">
              {item.label.split("\n").map((line) => (
                <span key={line}>
                  {line}
                  <br />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

export function PhPillarsSection({ section }: { section: PillarsSection }) {
  return (
    <SectionShell id={section.id} style={section.style} className="ph-shell ph-pillars">
      <div className="ph-section-head is-center">
        {section.eyebrow ? <div className="ph-eyebrow">{section.eyebrow}</div> : null}
        <h2>{section.title}</h2>
        {section.subtitle ? <p>{section.subtitle}</p> : null}
      </div>
      <div className="ph-pillar-grid">
        {section.items.map((item) => (
          <article
            key={item.id}
            className={`ph-pillar-card ${hasRenderableMedia(item.media) ? "has-bg" : ""}`}
          >
            {hasRenderableMedia(item.media) ? (
              <div className="ph-pillar-bg" aria-hidden>
                <PhMedia media={item.media} />
              </div>
            ) : null}
            <div className="ph-pillar-top">
              <div className="ph-pillar-icon" aria-hidden>
                {hasRenderableMedia(item.iconMedia) ? (
                  <PhMedia media={item.iconMedia} />
                ) : (
                  <span>{item.icon || "◇"}</span>
                )}
              </div>
              {item.tag ? <span className="ph-pillar-tag">{item.tag}</span> : null}
            </div>
            <h3>{item.title}</h3>
            {item.subtitle ? <p className="ph-pillar-sub">{item.subtitle}</p> : null}
            {item.bullets.length ? (
              <ul className="ph-tick-list">
                {item.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
            {item.href && item.linkLabel ? (
              <a className="ph-pillar-link" href={item.href}>
                {item.linkLabel} <span aria-hidden>→</span>
              </a>
            ) : null}
          </article>
        ))}
      </div>
      {section.note ? <p className="ph-pillar-note">{section.note}</p> : null}
      {section.actions.length ? (
        <div className="ph-section-cta">
          <PhCtaButtons actions={section.actions} />
        </div>
      ) : null}
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
  const isGrid = section.layout === "grid";
  return (
    <SectionShell id={section.id} style={section.style} className="ph-shell">
      <div className={`ph-section-head ${isGrid ? "is-center" : ""}`}>
        {section.eyebrow ? <div className="ph-eyebrow">{section.eyebrow}</div> : null}
        <h2>{section.title}</h2>
        {section.subtitle ? <p>{section.subtitle}</p> : null}
      </div>
      <div className={isGrid ? "ph-why-grid" : "ph-features"}>
        {section.items.map((item, index) => {
          const hasMedia = hasRenderableMedia(item.media);
          if (isGrid) {
            return (
              <article key={item.id} className={`ph-why-card tint-${(index % 6) + 1}`}>
                <div className="ph-why-index">{String(index + 1).padStart(2, "0")}</div>
                {item.icon ? <div className="ph-tool-icon">{item.icon}</div> : null}
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                {hasMedia ? (
                  <div className="ph-feature-media">
                    <PhMedia media={item.media} />
                  </div>
                ) : null}
              </article>
            );
          }
          return (
            <div
              key={item.id}
              className={`ph-feature-row ${hasMedia ? "has-media" : ""} ${
                index % 2 === 1 ? "is-flip" : ""
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
    <SectionShell id={section.id} style={section.style} className="ph-shell ph-cta has-orbs">
      <div className="ph-orb ph-orb-cyan" aria-hidden />
      <div className="ph-orb ph-orb-orange" aria-hidden />
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

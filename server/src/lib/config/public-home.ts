import { pool } from "../../db.js";
import {
  canonicalizeStoredImageUrl,
  saveImageUpload,
  withFileAccessToken,
} from "../storage.js";

export type MediaKind = "none" | "image" | "video" | "svg";

export type MediaRef = {
  kind: MediaKind;
  url: string;
  alt: string;
  objectFit: "cover" | "contain";
  posterUrl: string;
};

export type SectionStyle = {
  backgroundType: "none" | "color" | "gradient" | "image" | "video";
  backgroundValue: string;
  backgroundOverlay: string;
  textColor: string;
  mutedColor: string;
  accentColor: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  textAlign: "left" | "center" | "right";
  paddingY: string;
  paddingX: string;
  maxWidth: string;
  minHeight: string;
  customCss: string;
};

export type NavItem = {
  id: string;
  label: string;
  href: string;
  openInNewTab: boolean;
};

export type CtaButton = {
  id: string;
  label: string;
  href: string;
  variant: "primary" | "secondary" | "ghost" | "link";
  openInNewTab: boolean;
};

export type ToolCard = {
  id: string;
  toolId: string;
  name: string;
  description: string;
  icon: string;
  screenshot: MediaRef;
  featureScreenshots: MediaRef[];
  features: string[];
  href: string;
  ctaLabel: string;
};

export type FeatureItem = {
  id: string;
  title: string;
  description: string;
  icon: string;
  media: MediaRef;
};

export type FooterColumn = {
  id: string;
  title: string;
  links: NavItem[];
};

type SectionBase = {
  id: string;
  enabled: boolean;
  style: SectionStyle;
};

export type HeaderSection = SectionBase & {
  type: "header";
  sticky: boolean;
  logo: MediaRef;
  logoText: string;
  logoHref: string;
  menus: NavItem[];
  actions: CtaButton[];
};

export type HeroSection = SectionBase & {
  type: "hero";
  eyebrow: string;
  headline: string;
  subheadline: string;
  actions: CtaButton[];
  media: MediaRef;
  mediaPosition: "right" | "left" | "bottom" | "background";
};

export type MarqueeSection = SectionBase & {
  type: "marquee";
  title: string;
  source: "catalog" | "custom";
  toolIds: string[];
  items: { id: string; label: string; icon: string; href: string; media: MediaRef }[];
  speedSec: number;
  pauseOnHover: boolean;
  direction: "left" | "right";
};

export type ToolsShowcaseSection = SectionBase & {
  type: "toolsShowcase";
  eyebrow: string;
  title: string;
  subtitle: string;
  layout: "grid" | "list" | "featured";
  source: "catalog" | "custom";
  toolIds: string[];
  tools: ToolCard[];
};

export type FeaturesSection = SectionBase & {
  type: "features";
  eyebrow: string;
  title: string;
  subtitle: string;
  layout: "grid" | "alternating";
  items: FeatureItem[];
};

export type CtaSection = SectionBase & {
  type: "cta";
  title: string;
  subtitle: string;
  actions: CtaButton[];
};

export type FooterSection = SectionBase & {
  type: "footer";
  logo: MediaRef;
  logoText: string;
  tagline: string;
  columns: FooterColumn[];
  legalText: string;
  socialLinks: NavItem[];
};

export type PublicHomeSection =
  | HeaderSection
  | HeroSection
  | MarqueeSection
  | ToolsShowcaseSection
  | FeaturesSection
  | CtaSection
  | FooterSection;

export type PublicHomeTheme = {
  colorScheme: "dark" | "light";
  bg0: string;
  bg1: string;
  accent: string;
  accentStrong: string;
  textHi: string;
  textMid: string;
  fontSans: string;
  fontDisplay: string;
  radius: string;
};

export type PublicHomeConfig = {
  version: 1;
  enabled: boolean;
  seo: { title: string; description: string };
  theme: PublicHomeTheme;
  sections: PublicHomeSection[];
};

const KEY = "public_home";

const EMPTY_MEDIA: MediaRef = {
  kind: "none",
  url: "",
  alt: "",
  objectFit: "cover",
  posterUrl: "",
};

function media(partial?: Partial<MediaRef>): MediaRef {
  return {
    kind: partial?.kind ?? "none",
    url: String(partial?.url ?? "").trim(),
    alt: String(partial?.alt ?? "").trim(),
    objectFit: partial?.objectFit === "contain" ? "contain" : "cover",
    posterUrl: String(partial?.posterUrl ?? "").trim(),
  };
}

function style(partial?: Partial<SectionStyle>): SectionStyle {
  const bg = partial?.backgroundType;
  const align = partial?.textAlign;
  return {
    backgroundType:
      bg === "color" || bg === "gradient" || bg === "image" || bg === "video" || bg === "none"
        ? bg
        : "none",
    backgroundValue: String(partial?.backgroundValue ?? "").trim(),
    backgroundOverlay: String(partial?.backgroundOverlay ?? "").trim(),
    textColor: String(partial?.textColor ?? "").trim(),
    mutedColor: String(partial?.mutedColor ?? "").trim(),
    accentColor: String(partial?.accentColor ?? "").trim(),
    fontFamily: String(partial?.fontFamily ?? "").trim(),
    fontSize: String(partial?.fontSize ?? "").trim(),
    fontWeight: String(partial?.fontWeight ?? "").trim(),
    textAlign: align === "left" || align === "right" || align === "center" ? align : "left",
    paddingY: String(partial?.paddingY ?? "").trim(),
    paddingX: String(partial?.paddingX ?? "").trim(),
    maxWidth: String(partial?.maxWidth ?? "").trim(),
    minHeight: String(partial?.minHeight ?? "").trim(),
    customCss: String(partial?.customCss ?? "").trim(),
  };
}

function nav(partial?: Partial<NavItem>, fallbackId = "nav"): NavItem {
  return {
    id: String(partial?.id ?? fallbackId).trim() || fallbackId,
    label: String(partial?.label ?? "").trim(),
    href: String(partial?.href ?? "#").trim() || "#",
    openInNewTab: Boolean(partial?.openInNewTab),
  };
}

function cta(partial?: Partial<CtaButton>, fallbackId = "cta"): CtaButton {
  const variant = partial?.variant;
  return {
    id: String(partial?.id ?? fallbackId).trim() || fallbackId,
    label: String(partial?.label ?? "").trim(),
    href: String(partial?.href ?? "#").trim() || "#",
    variant:
      variant === "secondary" || variant === "ghost" || variant === "link" || variant === "primary"
        ? variant
        : "primary",
    openInNewTab: Boolean(partial?.openInNewTab),
  };
}

function toolCard(partial?: Partial<ToolCard>, fallbackId = "tool"): ToolCard {
  const shots = Array.isArray(partial?.featureScreenshots)
    ? partial!.featureScreenshots.map((m) => media(m))
    : [];
  const features = Array.isArray(partial?.features)
    ? partial!.features.map((f) => String(f ?? "").trim()).filter(Boolean)
    : [];
  return {
    id: String(partial?.id ?? fallbackId).trim() || fallbackId,
    toolId: String(partial?.toolId ?? "").trim(),
    name: String(partial?.name ?? "").trim(),
    description: String(partial?.description ?? "").trim(),
    icon: String(partial?.icon ?? "").trim(),
    screenshot: media(partial?.screenshot),
    featureScreenshots: shots,
    features,
    href: String(partial?.href ?? "").trim(),
    ctaLabel: String(partial?.ctaLabel ?? "").trim(),
  };
}

/**
 * Default marketing home — futuristic corporate JustX look.
 * `enabled` defaults to false so production deploys do not change guest `/`
 * until an admin turns Public home on (Experience → Public home).
 */
export const DEFAULT_PUBLIC_HOME: PublicHomeConfig = {
  version: 1,
  enabled: false,
  seo: {
    title: "JustX Business Tools — Operate smarter",
    description:
      "Quotations, invoices, inventory, field ops, and calculators — one modern platform for Indian businesses.",
  },
  theme: {
    colorScheme: "dark",
    bg0: "#050b14",
    bg1: "#0a1628",
    accent: "#00dfff",
    accentStrong: "#1a6fd4",
    textHi: "rgba(255,255,255,0.96)",
    textMid: "rgba(220,230,245,0.68)",
    fontSans: "var(--font-ph-sans), system-ui, sans-serif",
    fontDisplay: "var(--font-ph-display), system-ui, sans-serif",
    radius: "18px",
  },
  sections: [
    {
      type: "header",
      id: "header",
      enabled: true,
      sticky: true,
      logo: media({ kind: "image", url: "/icons/justx-logo.png", alt: "JustXSystems" }),
      logoText: "JustX Business Tools",
      logoHref: "/",
      menus: [
        nav({ id: "m-tools", label: "Tools", href: "#tools" }),
        nav({ id: "m-features", label: "Features", href: "#features" }),
        nav({ id: "m-status", label: "Status", href: "/status" }),
      ],
      actions: [
        cta({ id: "h-login", label: "Sign in", href: "/login", variant: "ghost" }),
        cta({ id: "h-start", label: "Get started", href: "/register", variant: "primary" }),
      ],
      style: style({
        backgroundType: "color",
        backgroundValue: "rgba(5,11,20,0.72)",
        textAlign: "left",
        paddingY: "0.75rem",
        paddingX: "1.25rem",
      }),
    },
    {
      type: "hero",
      id: "hero",
      enabled: true,
      eyebrow: "Business operating suite",
      headline: "Run quotations to field ops in one electric workspace.",
      subheadline:
        "JustX Business Tools unifies sales, inventory, service, and finance workflows — designed for dealers, distributors, and growing Indian teams.",
      actions: [
        cta({ id: "hero-start", label: "Start free", href: "/register", variant: "primary" }),
        cta({ id: "hero-login", label: "Sign in", href: "/login", variant: "secondary" }),
      ],
      media: media({
        kind: "image",
        url: "/icons/justx-logo.png",
        alt: "JustX Business Tools product preview",
        objectFit: "contain",
      }),
      mediaPosition: "right",
      style: style({
        backgroundType: "gradient",
        backgroundValue:
          "radial-gradient(ellipse 80% 60% at 70% 20%, rgba(0,223,255,0.18), transparent 55%), radial-gradient(ellipse 50% 40% at 10% 80%, rgba(26,111,212,0.22), transparent 50%), linear-gradient(180deg, #050b14 0%, #0a1628 100%)",
        textAlign: "left",
        paddingY: "5rem",
        paddingX: "1.5rem",
        minHeight: "88vh",
        maxWidth: "1180px",
      }),
    },
    {
      type: "marquee",
      id: "marquee",
      enabled: true,
      title: "Every tool your team needs",
      source: "catalog",
      toolIds: [
        "quotationv1",
        "invoice",
        "salesorder",
        "po",
        "stock",
        "projects",
        "sitesurveyv1",
        "imsdealer",
        "bos",
        "gstcalc",
        "qrgenerator",
        "paymenttracker",
      ],
      items: [],
      speedSec: 38,
      pauseOnHover: true,
      direction: "left",
      style: style({
        backgroundType: "color",
        backgroundValue: "rgba(255,255,255,0.02)",
        textAlign: "center",
        paddingY: "1.75rem",
        paddingX: "0",
      }),
    },
    {
      type: "toolsShowcase",
      id: "tools",
      enabled: true,
      eyebrow: "Platform",
      title: "Tools built for real operations",
      subtitle: "Showcase screenshots and capabilities for each module your team can enable.",
      layout: "grid",
      source: "custom",
      toolIds: [],
      tools: [
        toolCard({
          id: "t-quote",
          toolId: "quotationv1",
          name: "Quotation Generator",
          description: "Category-based quotes with GST, PDF delivery, and customer approval links.",
          icon: "📑",
          features: ["GST-ready line items", "Branded PDF", "Approval workflow"],
          href: "/register",
          ctaLabel: "Explore",
        }),
        toolCard({
          id: "t-ims",
          toolId: "imsdealer",
          name: "Justx IMS — Dealer",
          description: "Inventory, purchasing, GST sales, receivables, and field ops in one system.",
          icon: "📦",
          features: ["Stock in / out", "Purchase orders", "Field map & onsite"],
          href: "/register",
          ctaLabel: "Explore",
        }),
        toolCard({
          id: "t-bos",
          toolId: "bos",
          name: "Justx BOS",
          description: "Finance, GST invoicing, HR and projects — synced with your business tools.",
          icon: "🏢",
          features: ["Invoicing", "HR samples", "Operating system UI"],
          href: "/register",
          ctaLabel: "Explore",
        }),
        toolCard({
          id: "t-survey",
          toolId: "sitesurveyv1",
          name: "Site Survey Generator",
          description: "Wizard surveys with load calc, PDF report, and send to customers.",
          icon: "🛰️",
          features: ["Load calculator", "PDF report", "On-site capture"],
          href: "/register",
          ctaLabel: "Explore",
        }),
        toolCard({
          id: "t-invoice",
          toolId: "invoice",
          name: "Invoice Creator",
          description: "GST-ready tax invoices that match how Indian businesses bill.",
          icon: "🧮",
          features: ["Tax invoices", "Client history", "Fast drafts"],
          href: "/register",
          ctaLabel: "Explore",
        }),
        toolCard({
          id: "t-calc",
          toolId: "gstcalc",
          name: "Finance Calculators",
          description: "GST, TDS, EMI, profit and more — instant answers for the floor.",
          icon: "📈",
          features: ["GST add/remove", "EMI & loans", "Margin checks"],
          href: "/register",
          ctaLabel: "Explore",
        }),
      ],
      style: style({
        backgroundType: "none",
        textAlign: "left",
        paddingY: "5rem",
        paddingX: "1.5rem",
        maxWidth: "1180px",
      }),
    },
    {
      type: "features",
      id: "features",
      enabled: true,
      eyebrow: "Why JustX",
      title: "Corporate-grade control. Futuristic speed.",
      subtitle: "Admin-configurable experience, multi-branch ready, built for Indian commerce.",
      layout: "alternating",
      items: [
        {
          id: "f1",
          title: "Admin-tunable experience",
          description:
            "Themes, branding, and this public home — every section, style, and media asset controllable from Admin → Experience.",
          icon: "🎛️",
          media: { ...EMPTY_MEDIA },
        },
        {
          id: "f2",
          title: "Subscription-ready catalog",
          description:
            "Enable tools per organization, price SKUs, and put the right modules on every operator home.",
          icon: "🧩",
          media: { ...EMPTY_MEDIA },
        },
        {
          id: "f3",
          title: "Field to finance",
          description:
            "From site surveys and stock moves to GST invoices and receivables — one signed-in workspace.",
          icon: "⚡",
          media: { ...EMPTY_MEDIA },
        },
      ],
      style: style({
        backgroundType: "gradient",
        backgroundValue:
          "linear-gradient(180deg, transparent 0%, rgba(0,223,255,0.04) 40%, transparent 100%)",
        textAlign: "left",
        paddingY: "5rem",
        paddingX: "1.5rem",
        maxWidth: "1180px",
      }),
    },
    {
      type: "cta",
      id: "cta",
      enabled: true,
      title: "Ready to modernize your operations?",
      subtitle: "Create your business profile and start with the tools your team needs today.",
      actions: [
        cta({ id: "cta-reg", label: "Create account", href: "/register", variant: "primary" }),
        cta({ id: "cta-login", label: "Sign in", href: "/login", variant: "secondary" }),
      ],
      style: style({
        backgroundType: "gradient",
        backgroundValue:
          "linear-gradient(135deg, rgba(26,111,212,0.35) 0%, rgba(0,223,255,0.18) 100%)",
        textAlign: "center",
        paddingY: "4.5rem",
        paddingX: "1.5rem",
        maxWidth: "900px",
      }),
    },
    {
      type: "footer",
      id: "footer",
      enabled: true,
      logo: media({ kind: "image", url: "/icons/justx-logo.png", alt: "JustXSystems" }),
      logoText: "JustXSystems",
      tagline: "Business tools for modern Indian teams.",
      columns: [
        {
          id: "fc-product",
          title: "Product",
          links: [
            nav({ id: "fl-tools", label: "Tools", href: "#tools" }),
            nav({ id: "fl-features", label: "Features", href: "#features" }),
            nav({ id: "fl-status", label: "Status", href: "/status" }),
          ],
        },
        {
          id: "fc-account",
          title: "Account",
          links: [
            nav({ id: "fl-login", label: "Sign in", href: "/login" }),
            nav({ id: "fl-reg", label: "Register", href: "/register" }),
          ],
        },
      ],
      legalText: "© JustXSystems LLP. All rights reserved.",
      socialLinks: [],
      style: style({
        backgroundType: "color",
        backgroundValue: "#040910",
        textAlign: "left",
        paddingY: "3.5rem",
        paddingX: "1.5rem",
        maxWidth: "1180px",
      }),
    },
  ],
};

function asObj(raw: unknown): Record<string, unknown> {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseMedia(raw: unknown): MediaRef {
  const o = asObj(raw);
  const kind = String(o.kind ?? "none");
  return media({
    kind:
      kind === "image" || kind === "video" || kind === "svg" || kind === "none"
        ? kind
        : "none",
    url: String(o.url ?? ""),
    alt: String(o.alt ?? ""),
    objectFit: o.objectFit === "contain" ? "contain" : "cover",
    posterUrl: String(o.posterUrl ?? ""),
  });
}

function parseStyle(raw: unknown): SectionStyle {
  return style(asObj(raw) as Partial<SectionStyle>);
}

function parseNavList(raw: unknown): NavItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => nav(asObj(item) as Partial<NavItem>, `nav-${i}`));
}

function parseCtas(raw: unknown): CtaButton[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => cta(asObj(item) as Partial<CtaButton>, `cta-${i}`));
}

function parseToolCard(raw: unknown, i: number): ToolCard {
  const o = asObj(raw);
  return toolCard(
    {
      id: String(o.id ?? `tool-${i}`),
      toolId: String(o.toolId ?? ""),
      name: String(o.name ?? ""),
      description: String(o.description ?? ""),
      icon: String(o.icon ?? ""),
      screenshot: parseMedia(o.screenshot),
      featureScreenshots: Array.isArray(o.featureScreenshots)
        ? o.featureScreenshots.map((m) => parseMedia(m))
        : [],
      features: Array.isArray(o.features) ? o.features.map((f) => String(f ?? "")) : [],
      href: String(o.href ?? ""),
      ctaLabel: String(o.ctaLabel ?? ""),
    },
    `tool-${i}`,
  );
}

function parseSection(raw: unknown, index: number): PublicHomeSection | null {
  const o = asObj(raw);
  const type = String(o.type ?? "");
  const id = String(o.id ?? `section-${index}`).trim() || `section-${index}`;
  const enabled = o.enabled == null ? true : Boolean(o.enabled);
  const baseStyle = parseStyle(o.style);

  if (type === "header") {
    return {
      type: "header",
      id,
      enabled,
      sticky: o.sticky == null ? true : Boolean(o.sticky),
      logo: parseMedia(o.logo),
      logoText: String(o.logoText ?? "").trim(),
      logoHref: String(o.logoHref ?? "/").trim() || "/",
      menus: parseNavList(o.menus),
      actions: parseCtas(o.actions),
      style: baseStyle,
    };
  }
  if (type === "hero") {
    const pos = String(o.mediaPosition ?? "right");
    return {
      type: "hero",
      id,
      enabled,
      eyebrow: String(o.eyebrow ?? "").trim(),
      headline: String(o.headline ?? "").trim(),
      subheadline: String(o.subheadline ?? "").trim(),
      actions: parseCtas(o.actions),
      media: parseMedia(o.media),
      mediaPosition:
        pos === "left" || pos === "bottom" || pos === "background" || pos === "right"
          ? pos
          : "right",
      style: baseStyle,
    };
  }
  if (type === "marquee") {
    const items = Array.isArray(o.items)
      ? o.items.map((item, i) => {
          const it = asObj(item);
          return {
            id: String(it.id ?? `mq-${i}`),
            label: String(it.label ?? "").trim(),
            icon: String(it.icon ?? "").trim(),
            href: String(it.href ?? "").trim(),
            media: parseMedia(it.media),
          };
        })
      : [];
    return {
      type: "marquee",
      id,
      enabled,
      title: String(o.title ?? "").trim(),
      source: o.source === "custom" ? "custom" : "catalog",
      toolIds: Array.isArray(o.toolIds) ? o.toolIds.map((t) => String(t ?? "").trim()).filter(Boolean) : [],
      items,
      speedSec: Math.min(120, Math.max(8, Number(o.speedSec) || 38)),
      pauseOnHover: o.pauseOnHover == null ? true : Boolean(o.pauseOnHover),
      direction: o.direction === "right" ? "right" : "left",
      style: baseStyle,
    };
  }
  if (type === "toolsShowcase") {
    const layout = String(o.layout ?? "grid");
    return {
      type: "toolsShowcase",
      id,
      enabled,
      eyebrow: String(o.eyebrow ?? "").trim(),
      title: String(o.title ?? "").trim(),
      subtitle: String(o.subtitle ?? "").trim(),
      layout: layout === "list" || layout === "featured" || layout === "grid" ? layout : "grid",
      source: o.source === "catalog" ? "catalog" : "custom",
      toolIds: Array.isArray(o.toolIds) ? o.toolIds.map((t) => String(t ?? "").trim()).filter(Boolean) : [],
      tools: Array.isArray(o.tools) ? o.tools.map((t, i) => parseToolCard(t, i)) : [],
      style: baseStyle,
    };
  }
  if (type === "features") {
    const items = Array.isArray(o.items)
      ? o.items.map((item, i) => {
          const it = asObj(item);
          return {
            id: String(it.id ?? `feat-${i}`),
            title: String(it.title ?? "").trim(),
            description: String(it.description ?? "").trim(),
            icon: String(it.icon ?? "").trim(),
            media: parseMedia(it.media),
          };
        })
      : [];
    return {
      type: "features",
      id,
      enabled,
      eyebrow: String(o.eyebrow ?? "").trim(),
      title: String(o.title ?? "").trim(),
      subtitle: String(o.subtitle ?? "").trim(),
      layout: o.layout === "grid" ? "grid" : "alternating",
      items,
      style: baseStyle,
    };
  }
  if (type === "cta") {
    return {
      type: "cta",
      id,
      enabled,
      title: String(o.title ?? "").trim(),
      subtitle: String(o.subtitle ?? "").trim(),
      actions: parseCtas(o.actions),
      style: baseStyle,
    };
  }
  if (type === "footer") {
    const columns = Array.isArray(o.columns)
      ? o.columns.map((col, i) => {
          const c = asObj(col);
          return {
            id: String(c.id ?? `col-${i}`),
            title: String(c.title ?? "").trim(),
            links: parseNavList(c.links),
          };
        })
      : [];
    return {
      type: "footer",
      id,
      enabled,
      logo: parseMedia(o.logo),
      logoText: String(o.logoText ?? "").trim(),
      tagline: String(o.tagline ?? "").trim(),
      columns,
      legalText: String(o.legalText ?? "").trim(),
      socialLinks: parseNavList(o.socialLinks),
      style: baseStyle,
    };
  }
  return null;
}

export function parsePublicHome(raw: unknown): PublicHomeConfig {
  const o = asObj(raw);
  const themeObj = asObj(o.theme);
  const seoObj = asObj(o.seo);
  const sectionsRaw = Array.isArray(o.sections) ? o.sections : null;
  const sections = sectionsRaw
    ? (sectionsRaw.map((s, i) => parseSection(s, i)).filter(Boolean) as PublicHomeSection[])
    : DEFAULT_PUBLIC_HOME.sections.map((s) => structuredClone(s));

  return {
    version: 1,
    // Missing key must stay off — never auto-enable marketing home on parse.
    enabled: o.enabled == null ? DEFAULT_PUBLIC_HOME.enabled : Boolean(o.enabled),
    seo: {
      title: String(seoObj.title ?? DEFAULT_PUBLIC_HOME.seo.title).trim() || DEFAULT_PUBLIC_HOME.seo.title,
      description:
        String(seoObj.description ?? DEFAULT_PUBLIC_HOME.seo.description).trim() ||
        DEFAULT_PUBLIC_HOME.seo.description,
    },
    theme: {
      colorScheme: themeObj.colorScheme === "light" ? "light" : "dark",
      bg0: String(themeObj.bg0 ?? DEFAULT_PUBLIC_HOME.theme.bg0).trim() || DEFAULT_PUBLIC_HOME.theme.bg0,
      bg1: String(themeObj.bg1 ?? DEFAULT_PUBLIC_HOME.theme.bg1).trim() || DEFAULT_PUBLIC_HOME.theme.bg1,
      accent:
        String(themeObj.accent ?? DEFAULT_PUBLIC_HOME.theme.accent).trim() ||
        DEFAULT_PUBLIC_HOME.theme.accent,
      accentStrong:
        String(themeObj.accentStrong ?? DEFAULT_PUBLIC_HOME.theme.accentStrong).trim() ||
        DEFAULT_PUBLIC_HOME.theme.accentStrong,
      textHi:
        String(themeObj.textHi ?? DEFAULT_PUBLIC_HOME.theme.textHi).trim() ||
        DEFAULT_PUBLIC_HOME.theme.textHi,
      textMid:
        String(themeObj.textMid ?? DEFAULT_PUBLIC_HOME.theme.textMid).trim() ||
        DEFAULT_PUBLIC_HOME.theme.textMid,
      fontSans:
        String(themeObj.fontSans ?? DEFAULT_PUBLIC_HOME.theme.fontSans).trim() ||
        DEFAULT_PUBLIC_HOME.theme.fontSans,
      fontDisplay:
        String(themeObj.fontDisplay ?? DEFAULT_PUBLIC_HOME.theme.fontDisplay).trim() ||
        DEFAULT_PUBLIC_HOME.theme.fontDisplay,
      radius:
        String(themeObj.radius ?? DEFAULT_PUBLIC_HOME.theme.radius).trim() ||
        DEFAULT_PUBLIC_HOME.theme.radius,
    },
    sections: sections.length ? sections : DEFAULT_PUBLIC_HOME.sections.map((s) => structuredClone(s)),
  };
}

async function persistMediaUrl(url: string, folder: string): Promise<string> {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  // Raster uploads only (same as branding). Never wipe existing URLs on failure.
  if (raw.startsWith("data:image/svg")) {
    throw new Error("SVG file uploads are not supported — use PNG/JPEG/WebP/GIF or an SVG URL");
  }
  if (raw.startsWith("data:image/")) {
    const saved = await saveImageUpload(raw, folder);
    if (!saved) throw new Error("Image upload failed");
    return saved;
  }
  if (raw.startsWith("data:")) {
    throw new Error("Only PNG, JPEG, WebP, or GIF uploads are supported. For video, paste a URL.");
  }
  return canonicalizeStoredImageUrl(raw);
}

async function hydrateMedia(m: MediaRef, folder: string): Promise<MediaRef> {
  const url = await persistMediaUrl(m.url, folder);
  const posterUrl = m.posterUrl ? await persistMediaUrl(m.posterUrl, folder) : "";
  return { ...m, url, posterUrl };
}

async function hydrateConfigMedia(cfg: PublicHomeConfig): Promise<PublicHomeConfig> {
  const sections: PublicHomeSection[] = [];
  for (const section of cfg.sections) {
    const styleBg =
      section.style.backgroundType === "image" || section.style.backgroundType === "video"
        ? await persistMediaUrl(section.style.backgroundValue, "public-home")
        : section.style.backgroundValue;
    const nextStyle = { ...section.style, backgroundValue: styleBg };

    if (section.type === "header") {
      sections.push({
        ...section,
        style: nextStyle,
        logo: await hydrateMedia(section.logo, "public-home"),
      });
      continue;
    }
    if (section.type === "hero") {
      sections.push({
        ...section,
        style: nextStyle,
        media: await hydrateMedia(section.media, "public-home"),
      });
      continue;
    }
    if (section.type === "marquee") {
      const items = [];
      for (const item of section.items) {
        items.push({ ...item, media: await hydrateMedia(item.media, "public-home") });
      }
      sections.push({ ...section, style: nextStyle, items });
      continue;
    }
    if (section.type === "toolsShowcase") {
      const tools = [];
      for (const tool of section.tools) {
        const featureScreenshots = [];
        for (const shot of tool.featureScreenshots) {
          featureScreenshots.push(await hydrateMedia(shot, "public-home"));
        }
        tools.push({
          ...tool,
          screenshot: await hydrateMedia(tool.screenshot, "public-home"),
          featureScreenshots,
        });
      }
      sections.push({ ...section, style: nextStyle, tools });
      continue;
    }
    if (section.type === "features") {
      const items = [];
      for (const item of section.items) {
        items.push({ ...item, media: await hydrateMedia(item.media, "public-home") });
      }
      sections.push({ ...section, style: nextStyle, items });
      continue;
    }
    if (section.type === "footer") {
      sections.push({
        ...section,
        style: nextStyle,
        logo: await hydrateMedia(section.logo, "public-home"),
      });
      continue;
    }
    sections.push({ ...section, style: nextStyle });
  }
  return { ...cfg, sections };
}

function signUrl(url: string): string {
  const raw = String(url ?? "").trim();
  if (!raw) return raw;
  return withFileAccessToken(raw) ?? raw;
}

function signMedia(m: MediaRef): MediaRef {
  return {
    ...m,
    url: signUrl(m.url),
    posterUrl: signUrl(m.posterUrl),
  };
}

export function signPublicHomeMedia(cfg: PublicHomeConfig): PublicHomeConfig {
  return {
    ...cfg,
    sections: cfg.sections.map((section) => {
      const styleNext = {
        ...section.style,
        backgroundValue:
          section.style.backgroundType === "image" || section.style.backgroundType === "video"
            ? signUrl(section.style.backgroundValue)
            : section.style.backgroundValue,
      };
      if (section.type === "header") {
        return { ...section, style: styleNext, logo: signMedia(section.logo) };
      }
      if (section.type === "hero") {
        return { ...section, style: styleNext, media: signMedia(section.media) };
      }
      if (section.type === "marquee") {
        return {
          ...section,
          style: styleNext,
          items: section.items.map((item) => ({ ...item, media: signMedia(item.media) })),
        };
      }
      if (section.type === "toolsShowcase") {
        return {
          ...section,
          style: styleNext,
          tools: section.tools.map((tool) => ({
            ...tool,
            screenshot: signMedia(tool.screenshot),
            featureScreenshots: tool.featureScreenshots.map(signMedia),
          })),
        };
      }
      if (section.type === "features") {
        return {
          ...section,
          style: styleNext,
          items: section.items.map((item) => ({ ...item, media: signMedia(item.media) })),
        };
      }
      if (section.type === "footer") {
        return { ...section, style: styleNext, logo: signMedia(section.logo) };
      }
      return { ...section, style: styleNext };
    }),
  };
}

export async function getPublicHome(): Promise<PublicHomeConfig> {
  try {
    const [rows] = await pool.query(`SELECT value FROM platform_config WHERE config_key = :key`, {
      key: KEY,
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return structuredClone(DEFAULT_PUBLIC_HOME);
    return parsePublicHome((row as { value: unknown }).value);
  } catch {
    // DB blip must not take down guest `/` or admin Experience.
    return structuredClone(DEFAULT_PUBLIC_HOME);
  }
}

export async function savePublicHome(input: unknown): Promise<PublicHomeConfig> {
  const parsed = parsePublicHome(input);
  const hydrated = await hydrateConfigMedia(parsed);
  await pool.query(
    `INSERT INTO platform_config (config_key, value) VALUES (:key, CAST(:value AS JSON))
     ON DUPLICATE KEY UPDATE value = CAST(:value AS JSON)`,
    { key: KEY, value: JSON.stringify(hydrated) },
  );
  return signPublicHomeMedia(hydrated);
}

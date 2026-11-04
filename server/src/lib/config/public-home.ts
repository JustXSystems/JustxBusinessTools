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

export type HeroSlide = {
  id: string;
  eyebrow: string;
  headline: string;
  subheadline: string;
  words: string[];
  actions: CtaButton[];
  background: MediaRef;
};

export type StatItem = {
  id: string;
  value: string;
  label: string;
  icon: string;
  media: MediaRef;
};

export type PillarItem = {
  id: string;
  tag: string;
  title: string;
  subtitle: string;
  bullets: string[];
  href: string;
  linkLabel: string;
  icon: string;
  media: MediaRef;
  iconMedia: MediaRef;
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
  brandLabel: string;
  eyebrow: string;
  headline: string;
  subheadline: string;
  actions: CtaButton[];
  media: MediaRef;
  mediaPosition: "right" | "left" | "bottom" | "background";
  slides: HeroSlide[];
  chips: string[];
  autoplaySec: number;
};

export type StatsSection = SectionBase & {
  type: "stats";
  items: StatItem[];
};

export type PillarsSection = SectionBase & {
  type: "pillars";
  eyebrow: string;
  title: string;
  subtitle: string;
  note: string;
  actions: CtaButton[];
  items: PillarItem[];
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
  | StatsSection
  | PillarsSection
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

function heroSlide(partial?: Partial<HeroSlide>, fallbackId = "slide"): HeroSlide {
  const words = Array.isArray(partial?.words)
    ? partial!.words.map((w) => String(w ?? "").trim()).filter(Boolean)
    : [];
  return {
    id: String(partial?.id ?? fallbackId).trim() || fallbackId,
    eyebrow: String(partial?.eyebrow ?? "").trim(),
    headline: String(partial?.headline ?? "").trim(),
    subheadline: String(partial?.subheadline ?? "").trim(),
    words,
    actions: Array.isArray(partial?.actions)
      ? partial!.actions.map((a, i) => cta(a, `${fallbackId}-cta-${i}`))
      : [],
    background: media(partial?.background),
  };
}

function statItem(partial?: Partial<StatItem>, fallbackId = "stat"): StatItem {
  return {
    id: String(partial?.id ?? fallbackId).trim() || fallbackId,
    value: String(partial?.value ?? "").trim(),
    label: String(partial?.label ?? "").trim(),
    icon: String(partial?.icon ?? "").trim(),
    media: media(partial?.media),
  };
}

function pillarItem(partial?: Partial<PillarItem>, fallbackId = "pillar"): PillarItem {
  const bullets = Array.isArray(partial?.bullets)
    ? partial!.bullets.map((b) => String(b ?? "").trim()).filter(Boolean)
    : [];
  return {
    id: String(partial?.id ?? fallbackId).trim() || fallbackId,
    tag: String(partial?.tag ?? "").trim(),
    title: String(partial?.title ?? "").trim(),
    subtitle: String(partial?.subtitle ?? "").trim(),
    bullets,
    href: String(partial?.href ?? "").trim(),
    linkLabel: String(partial?.linkLabel ?? "").trim(),
    icon: String(partial?.icon ?? "").trim(),
    media: media(partial?.media),
    iconMedia: media(partial?.iconMedia),
  };
}

/**
 * Default marketing home — industrial SaaS look inspired by high-end ops sites,
 * tuned for JustX (brand-first, register CTAs, admin-configurable media).
 */
export const DEFAULT_PUBLIC_HOME: PublicHomeConfig = {
  version: 1,
  enabled: true,
  seo: {
    title: "JustX Business Tools — Operate smarter",
    description:
      "Quotations, invoices, inventory, field ops, and calculators — one modern platform for Indian dealers, distributors, and growing teams.",
  },
  theme: {
    colorScheme: "dark",
    bg0: "#0A1628",
    bg1: "#0F1F3D",
    accent: "#00D4FF",
    accentStrong: "#FF6B1A",
    textHi: "rgba(255,255,255,0.96)",
    textMid: "#B7C2D6",
    fontSans: "var(--font-ph-sans), system-ui, sans-serif",
    fontDisplay: "var(--font-ph-display), system-ui, sans-serif",
    radius: "14px",
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
        nav({ id: "m-pillars", label: "Capabilities", href: "#pillars" }),
        nav({ id: "m-tools", label: "Tools", href: "#tools" }),
        nav({ id: "m-features", label: "Why JustX", href: "#features" }),
        nav({ id: "m-status", label: "Status", href: "/status" }),
      ],
      actions: [
        cta({ id: "h-login", label: "Sign in", href: "/login", variant: "ghost" }),
        cta({ id: "h-start", label: "Get started", href: "/register", variant: "primary" }),
      ],
      style: style({
        backgroundType: "color",
        backgroundValue: "rgba(10,22,40,0.92)",
        textAlign: "left",
        paddingY: "0.85rem",
        paddingX: "1.5rem",
      }),
    },
    {
      type: "hero",
      id: "hero",
      enabled: true,
      brandLabel: "JustX Business Tools",
      eyebrow: "Business operating suite",
      headline: "Run quotations to field ops in one workspace.",
      subheadline:
        "JustX unifies sales, inventory, service, and finance workflows — built for dealers, distributors, and growing Indian teams.",
      actions: [
        cta({ id: "hero-start", label: "Start free", href: "/register", variant: "primary" }),
        cta({ id: "hero-login", label: "Sign in", href: "/login", variant: "secondary" }),
      ],
      media: media({
        kind: "image",
        url: "/icons/justx-logo.png",
        alt: "JustX Business Tools",
        objectFit: "contain",
      }),
      mediaPosition: "background",
      slides: [
        heroSlide(
          {
            id: "hs-1",
            eyebrow: "Business operating suite",
            headline: "Operate from quote to cash — without the tool sprawl.",
            subheadline:
              "One signed-in workspace for quotations, GST billing, stock, field teams, and finance — designed for how Indian businesses actually work.",
            words: ["Quote", "Stock", "Service", "Collect"],
            actions: [
              cta({ id: "hs1-a", label: "Create account", href: "/register", variant: "primary" }),
              cta({ id: "hs1-b", label: "Explore tools", href: "#tools", variant: "secondary" }),
            ],
            background: { ...EMPTY_MEDIA },
          },
          "hs-1",
        ),
        heroSlide(
          {
            id: "hs-2",
            eyebrow: "Inventory & GST",
            headline: "Dealer-grade inventory with GST that matches the floor.",
            subheadline:
              "Stock in/out, purchase orders, party ledgers, and GST-ready sales — so warehouse and accounts stay on the same truth.",
            words: ["Stock", "Purchase", "GST", "Parties"],
            actions: [
              cta({ id: "hs2-a", label: "Start free", href: "/register", variant: "primary" }),
              cta({ id: "hs2-b", label: "See capabilities", href: "#pillars", variant: "secondary" }),
            ],
            background: { ...EMPTY_MEDIA },
          },
          "hs-2",
        ),
        heroSlide(
          {
            id: "hs-3",
            eyebrow: "Field & surveys",
            headline: "Site surveys and field ops that close the loop.",
            subheadline:
              "Capture on-site work, generate PDFs customers trust, and keep HQ informed — without WhatsApp chaos.",
            words: ["Survey", "Map", "Approve", "Deliver"],
            actions: [
              cta({ id: "hs3-a", label: "Get started", href: "/register", variant: "primary" }),
              cta({ id: "hs3-b", label: "Sign in", href: "/login", variant: "ghost" }),
            ],
            background: { ...EMPTY_MEDIA },
          },
          "hs-3",
        ),
      ],
      chips: ["GST-ready", "Multi-branch", "Admin themes", "Subscription catalog"],
      autoplaySec: 7,
      style: style({
        backgroundType: "gradient",
        backgroundValue:
          "radial-gradient(ellipse 70% 55% at 75% 15%, rgba(0,212,255,0.16), transparent 55%), radial-gradient(ellipse 45% 40% at 8% 85%, rgba(255,107,26,0.12), transparent 50%), linear-gradient(180deg, #0A1628 0%, #0F1F3D 100%)",
        backgroundOverlay: "rgba(10,22,40,0.35)",
        textAlign: "left",
        paddingY: "0",
        paddingX: "1.5rem",
        minHeight: "92vh",
        maxWidth: "1280px",
      }),
    },
    {
      type: "stats",
      id: "stats",
      enabled: true,
      items: [
        statItem({ id: "st-1", value: "20+", label: "Business tools\nin one suite", icon: "◆" }),
        statItem({ id: "st-2", value: "GST", label: "Indian tax\nworkflows built-in", icon: "▣" }),
        statItem({ id: "st-3", value: "1", label: "Signed-in workspace\nfor every team", icon: "⬡" }),
        statItem({ id: "st-4", value: "Admin", label: "Themes, branding &\nhome media control", icon: "◎" }),
      ],
      style: style({
        backgroundType: "color",
        backgroundValue: "#0F1F3D",
        textAlign: "center",
        paddingY: "2.2rem",
        paddingX: "1.5rem",
        maxWidth: "1280px",
      }),
    },
    {
      type: "pillars",
      id: "pillars",
      enabled: true,
      eyebrow: "What you run on JustX",
      title: "Three operating pillars. One accountable platform.",
      subtitle:
        "Sell with confidence, keep stock honest, and close the loop from field to finance — without stitching five vendors together.",
      note: "Every pillar is module-based: enable what your organization needs, price SKUs from Admin, and keep operators on a clean home.",
      actions: [cta({ id: "pillars-cta", label: "Create account", href: "/register", variant: "primary" })],
      items: [
        pillarItem({
          id: "p-sell",
          tag: "01 — Sell",
          title: "Quotations & billing",
          subtitle: "Customer-facing documents that look branded and stay GST-correct.",
          bullets: [
            "Category-based quotations with approvals",
            "GST invoices and tax-ready line items",
            "PDF delivery your customers can trust",
            "Sales orders that feed operations",
          ],
          href: "#tools",
          linkLabel: "Explore sell tools",
          icon: "01",
        }),
        pillarItem({
          id: "p-stock",
          tag: "02 — Stock",
          title: "Inventory & purchasing",
          subtitle: "Dealer and distributor flows for real warehouses — not spreadsheet theatre.",
          bullets: [
            "Stock in / out with history",
            "Purchase orders and party masters",
            "Low-stock and full-stock views",
            "IMS Dealer for denser ops",
          ],
          href: "#tools",
          linkLabel: "Explore stock tools",
          icon: "02",
        }),
        pillarItem({
          id: "p-field",
          tag: "03 — Field",
          title: "Field, surveys & finance",
          subtitle: "On-site capture through receivables — one trail from job to cash.",
          bullets: [
            "Site survey generator with PDF reports",
            "Field map and onsite workflows",
            "Receivables, payables, and ledgers",
            "Calculators for GST, EMI, and margin",
          ],
          href: "#tools",
          linkLabel: "Explore field tools",
          icon: "03",
        }),
      ],
      style: style({
        backgroundType: "color",
        backgroundValue: "#F4F6F9",
        textColor: "#1E2530",
        mutedColor: "#5B6472",
        accentColor: "#FF6B1A",
        textAlign: "center",
        paddingY: "5.5rem",
        paddingX: "1.5rem",
        maxWidth: "1280px",
      }),
    },
    {
      type: "marquee",
      id: "marquee",
      enabled: true,
      title: "Modules your team can enable",
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
        backgroundValue: "#0A1628",
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
      subtitle: "Showcase screenshots and capabilities for each module — every image is editable from Admin → Experience.",
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
        backgroundType: "color",
        backgroundValue: "#0A1628",
        textAlign: "left",
        paddingY: "5rem",
        paddingX: "1.5rem",
        maxWidth: "1280px",
      }),
    },
    {
      type: "features",
      id: "features",
      enabled: true,
      eyebrow: "Why JustX",
      title: "Corporate control. Operator speed.",
      subtitle: "Admin-tunable experience, subscription-ready catalog, built for Indian commerce.",
      layout: "grid",
      items: [
        {
          id: "f1",
          title: "Admin-tunable experience",
          description:
            "Themes, branding, and this public home — every section, style, image, SVG, and video controllable from Admin → Experience.",
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
        {
          id: "f4",
          title: "Built for Indian teams",
          description:
            "GST, party workflows, dealer inventory patterns, and documents that match how businesses here actually operate.",
          icon: "🇮🇳",
          media: { ...EMPTY_MEDIA },
        },
        {
          id: "f5",
          title: "Multi-branch ready",
          description:
            "Organize people and tools around how your company is structured — without fragmenting data trails.",
          icon: "🗂️",
          media: { ...EMPTY_MEDIA },
        },
        {
          id: "f6",
          title: "Status you can trust",
          description:
            "Public status and a product surface that stays fast, mobile-friendly, and operator-clear.",
          icon: "📡",
          media: { ...EMPTY_MEDIA },
        },
      ],
      style: style({
        backgroundType: "color",
        backgroundValue: "#F0F8FC",
        textColor: "#1E2530",
        mutedColor: "#5B6472",
        accentColor: "#FF6B1A",
        textAlign: "center",
        paddingY: "5rem",
        paddingX: "1.5rem",
        maxWidth: "1280px",
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
        backgroundValue: "linear-gradient(120deg, #0A1628 0%, #122647 55%, #0F1F3D 100%)",
        textAlign: "center",
        paddingY: "5rem",
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
            nav({ id: "fl-pillars", label: "Capabilities", href: "#pillars" }),
            nav({ id: "fl-tools", label: "Tools", href: "#tools" }),
            nav({ id: "fl-features", label: "Why JustX", href: "#features" }),
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
        backgroundValue: "#0D1421",
        textAlign: "left",
        paddingY: "3.5rem",
        paddingX: "1.5rem",
        maxWidth: "1280px",
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

function parseHeroSlide(raw: unknown, i: number): HeroSlide {
  const o = asObj(raw);
  return heroSlide(
    {
      id: String(o.id ?? `slide-${i}`),
      eyebrow: String(o.eyebrow ?? ""),
      headline: String(o.headline ?? ""),
      subheadline: String(o.subheadline ?? ""),
      words: Array.isArray(o.words) ? o.words.map((w) => String(w ?? "")) : [],
      actions: parseCtas(o.actions),
      background: parseMedia(o.background),
    },
    `slide-${i}`,
  );
}

function parseStatItem(raw: unknown, i: number): StatItem {
  const o = asObj(raw);
  return statItem(
    {
      id: String(o.id ?? `stat-${i}`),
      value: String(o.value ?? ""),
      label: String(o.label ?? ""),
      icon: String(o.icon ?? ""),
      media: parseMedia(o.media),
    },
    `stat-${i}`,
  );
}

function parsePillarItem(raw: unknown, i: number): PillarItem {
  const o = asObj(raw);
  return pillarItem(
    {
      id: String(o.id ?? `pillar-${i}`),
      tag: String(o.tag ?? ""),
      title: String(o.title ?? ""),
      subtitle: String(o.subtitle ?? ""),
      bullets: Array.isArray(o.bullets) ? o.bullets.map((b) => String(b ?? "")) : [],
      href: String(o.href ?? ""),
      linkLabel: String(o.linkLabel ?? ""),
      icon: String(o.icon ?? ""),
      media: parseMedia(o.media),
      iconMedia: parseMedia(o.iconMedia),
    },
    `pillar-${i}`,
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
      brandLabel: String(o.brandLabel ?? "").trim(),
      eyebrow: String(o.eyebrow ?? "").trim(),
      headline: String(o.headline ?? "").trim(),
      subheadline: String(o.subheadline ?? "").trim(),
      actions: parseCtas(o.actions),
      media: parseMedia(o.media),
      mediaPosition:
        pos === "left" || pos === "bottom" || pos === "background" || pos === "right"
          ? pos
          : "right",
      slides: Array.isArray(o.slides) ? o.slides.map((s, i) => parseHeroSlide(s, i)) : [],
      chips: Array.isArray(o.chips)
        ? o.chips.map((c) => String(c ?? "").trim()).filter(Boolean)
        : [],
      autoplaySec: Math.min(30, Math.max(0, Number(o.autoplaySec) || 0)),
      style: baseStyle,
    };
  }
  if (type === "stats") {
    return {
      type: "stats",
      id,
      enabled,
      items: Array.isArray(o.items) ? o.items.map((item, i) => parseStatItem(item, i)) : [],
      style: baseStyle,
    };
  }
  if (type === "pillars") {
    return {
      type: "pillars",
      id,
      enabled,
      eyebrow: String(o.eyebrow ?? "").trim(),
      title: String(o.title ?? "").trim(),
      subtitle: String(o.subtitle ?? "").trim(),
      note: String(o.note ?? "").trim(),
      actions: parseCtas(o.actions),
      items: Array.isArray(o.items) ? o.items.map((item, i) => parsePillarItem(item, i)) : [],
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
      const slides = [];
      for (const slide of section.slides) {
        slides.push({
          ...slide,
          background: await hydrateMedia(slide.background, "public-home"),
        });
      }
      sections.push({
        ...section,
        style: nextStyle,
        media: await hydrateMedia(section.media, "public-home"),
        slides,
      });
      continue;
    }
    if (section.type === "stats") {
      const items = [];
      for (const item of section.items) {
        items.push({ ...item, media: await hydrateMedia(item.media, "public-home") });
      }
      sections.push({ ...section, style: nextStyle, items });
      continue;
    }
    if (section.type === "pillars") {
      const items = [];
      for (const item of section.items) {
        items.push({
          ...item,
          media: await hydrateMedia(item.media, "public-home"),
          iconMedia: await hydrateMedia(item.iconMedia, "public-home"),
        });
      }
      sections.push({ ...section, style: nextStyle, items });
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
        return {
          ...section,
          style: styleNext,
          media: signMedia(section.media),
          slides: section.slides.map((slide) => ({
            ...slide,
            background: signMedia(slide.background),
          })),
        };
      }
      if (section.type === "stats") {
        return {
          ...section,
          style: styleNext,
          items: section.items.map((item) => ({ ...item, media: signMedia(item.media) })),
        };
      }
      if (section.type === "pillars") {
        return {
          ...section,
          style: styleNext,
          items: section.items.map((item) => ({
            ...item,
            media: signMedia(item.media),
            iconMedia: signMedia(item.iconMedia),
          })),
        };
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

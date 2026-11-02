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

export const EMPTY_MEDIA: MediaRef = {
  kind: "none",
  url: "",
  alt: "",
  objectFit: "cover",
  posterUrl: "",
};

export const EMPTY_STYLE: SectionStyle = {
  backgroundType: "none",
  backgroundValue: "",
  backgroundOverlay: "",
  textColor: "",
  mutedColor: "",
  accentColor: "",
  fontFamily: "",
  fontSize: "",
  fontWeight: "",
  textAlign: "left",
  paddingY: "",
  paddingX: "",
  maxWidth: "",
  minHeight: "",
  customCss: "",
};

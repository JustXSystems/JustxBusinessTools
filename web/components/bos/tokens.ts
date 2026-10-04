/**
 * Justx BOS design tokens — single source of truth for documentation surfaces
 * (swatches, token reference) and for TypeScript unions used by the kit.
 * Every value here must also exist in `styles/bos.tokens.css`; the
 * `tokens.test.ts` suite fails the build when the two drift apart.
 */

export type BosTheme = "light" | "dark";

/** Semantic status tones — the only colors allowed to mean "state". */
export type BosTone = "blue" | "emerald" | "amber" | "coral";

/** Decorative pastels — category ("which"), never status ("what state") or actions. */
export type BosPastel = "sage" | "blue" | "rose" | "mint" | "lavender";

/** Icon-chip palette: the five pastels plus amber for "time / pending" context. */
export type BosChipColor = BosPastel | "amber";

export type BosTokenGroup = "neutrals" | "blue" | "emerald" | "amber" | "coral" | "pastels";

export type BosColorToken = {
  /** Human label used in swatches. */
  name: string;
  /** CSS custom property, always `--bos-*`. */
  cssVar: `--bos-${string}`;
  light: string;
  dark: string;
  /** Where the token is meant to be used. */
  role: string;
  group: BosTokenGroup;
};

export const BOS_TOKEN_GROUP_LABELS: Record<BosTokenGroup, string> = {
  neutrals: "Neutrals",
  blue: "Blue — action & info",
  emerald: "Emerald — success",
  amber: "Amber — warning",
  coral: "Coral — error / destructive",
  pastels: "Decorative pastels — never status, never actions",
};

export const BOS_COLOR_TOKENS: BosColorToken[] = [
  { group: "neutrals", name: "Canvas", cssVar: "--bos-bg", light: "#F5F6F8", dark: "#1C1C1E", role: "Page background" },
  { group: "neutrals", name: "Surface", cssVar: "--bos-surface", light: "#FFFFFF", dark: "#2C2C2E", role: "Cards, inputs, panels" },
  { group: "neutrals", name: "Surface-2", cssVar: "--bos-surface-2", light: "#FAFBFC", dark: "#262628", role: "Sidebar, table header" },
  { group: "neutrals", name: "Border", cssVar: "--bos-border", light: "#E5E8EC", dark: "#3A3A3D", role: "Input borders" },
  { group: "neutrals", name: "Border-soft", cssVar: "--bos-border-soft", light: "#EDEFF2", dark: "#333335", role: "Card edges" },
  { group: "neutrals", name: "Hairline", cssVar: "--bos-hairline", light: "#ECEEF1", dark: "#333335", role: "Row dividers" },
  { group: "neutrals", name: "Muted text", cssVar: "--bos-text-muted", light: "#667085", dark: "#98989D", role: "Secondary copy" },
  { group: "neutrals", name: "Faint text", cssVar: "--bos-text-faint", light: "#98A2B3", dark: "#6E6E73", role: "Timestamps, hints" },
  { group: "neutrals", name: "Text", cssVar: "--bos-text", light: "#1B1F27", dark: "#F2F2F7", role: "Primary copy" },

  { group: "blue", name: "Blue", cssVar: "--bos-blue", light: "#5B8DEF", dark: "#6E9BFF", role: "Links, focus ring" },
  { group: "blue", name: "Blue-100", cssVar: "--bos-blue-100", light: "#EAF0FE", dark: "#22314F", role: "DRAFT badge fill, active nav" },
  { group: "blue", name: "Blue-600", cssVar: "--bos-blue-600", light: "#4271D6", dark: "#8FB1FF", role: "Badge text, active labels" },
  { group: "blue", name: "Blue-btn", cssVar: "--bos-blue-btn", light: "#4271D6", dark: "#618DED", role: "Primary button fill" },

  { group: "emerald", name: "Emerald", cssVar: "--bos-emerald", light: "#34B27B", dark: "#3DCB8F", role: "Status dot, alert bar" },
  { group: "emerald", name: "Emerald-100", cssVar: "--bos-emerald-100", light: "#E6F7EF", dark: "#123626", role: "PAID badge fill" },
  { group: "emerald", name: "Emerald-600", cssVar: "--bos-emerald-600", light: "#268F62", dark: "#5BDBA4", role: "Badge / value text" },
  { group: "emerald", name: "Row hover", cssVar: "--bos-row-hover", light: "#E6F7EF", dark: "#343434", role: "Table row hover fill" },

  { group: "amber", name: "Amber", cssVar: "--bos-amber", light: "#E5A155", dark: "#F0B36B", role: "Status dot, alert bar" },
  { group: "amber", name: "Amber-100", cssVar: "--bos-amber-100", light: "#FDF1E3", dark: "#3A2A16", role: "PENDING badge fill" },
  { group: "amber", name: "Amber-600", cssVar: "--bos-amber-600", light: "#B97A34", dark: "#F5C88A", role: "Badge / value text" },

  { group: "coral", name: "Coral", cssVar: "--bos-coral", light: "#EE8B76", dark: "#FF9B85", role: "Status dot, alert bar" },
  { group: "coral", name: "Coral-100", cssVar: "--bos-coral-100", light: "#FCEBE7", dark: "#3D211C", role: "OVERDUE badge fill" },
  { group: "coral", name: "Coral-600", cssVar: "--bos-coral-600", light: "#D4664F", dark: "#FFB09E", role: "Badge text, destructive button" },

  { group: "pastels", name: "Sage", cssVar: "--bos-pastel-sage", light: "#C7D2C6", dark: "#C7D2C6", role: "My Tasks dot, FIELD OPS tag" },
  { group: "pastels", name: "Sage-ink", cssVar: "--bos-pastel-sage-ink", light: "#55624F", dark: "#55624F", role: "Text/icon on sage fill" },
  { group: "pastels", name: "Dusty blue", cssVar: "--bos-pastel-blue", light: "#C8D3DC", dark: "#C8D3DC", role: "Leave & attendance dot, chip" },
  { group: "pastels", name: "Dusty blue-ink", cssVar: "--bos-pastel-blue-ink", light: "#4C5D6B", dark: "#4C5D6B", role: "Text/icon on dusty-blue fill" },
  { group: "pastels", name: "Rose", cssVar: "--bos-pastel-rose", light: "#E5D2CE", dark: "#E5D2CE", role: "SALES tag, chip" },
  { group: "pastels", name: "Rose-ink", cssVar: "--bos-pastel-rose-ink", light: "#7A5148", dark: "#7A5148", role: "Text/icon on rose fill" },
  { group: "pastels", name: "Mint", cssVar: "--bos-pastel-mint", light: "#C6E6E0", dark: "#C6E6E0", role: "My Projects dot, DESIGN tag" },
  { group: "pastels", name: "Mint-ink", cssVar: "--bos-pastel-mint-ink", light: "#2E6259", dark: "#2E6259", role: "Text/icon on mint fill" },
  { group: "pastels", name: "Lavender", cssVar: "--bos-pastel-lavender", light: "#D2CEE5", dark: "#D2CEE5", role: "My Reports dot, SUPPORT tag" },
  { group: "pastels", name: "Lavender-ink", cssVar: "--bos-pastel-lavender-ink", light: "#5A5079", dark: "#5A5079", role: "Text/icon on lavender fill" },
];

export type BosScaleToken = { cssVar: `--bos-${string}`; value: string; role: string };

export const BOS_RADIUS_TOKENS: BosScaleToken[] = [
  { cssVar: "--bos-r-sm", value: "8px", role: "Inputs, skeleton bars" },
  { cssVar: "--bos-r-md", value: "10px", role: "Buttons, nav items, chips" },
  { cssVar: "--bos-r-lg", value: "14px", role: "Tables, alerts, swatches" },
  { cssVar: "--bos-r-xl", value: "16px", role: "Cards, dialogs, shells" },
  { cssVar: "--bos-r-full", value: "999px", role: "Pills, badges, avatars" },
];

export const BOS_SPACE_TOKENS: BosScaleToken[] = [
  { cssVar: "--bos-s-1", value: "4px", role: "Hairline gaps" },
  { cssVar: "--bos-s-2", value: "8px", role: "Inline gaps" },
  { cssVar: "--bos-s-3", value: "12px", role: "Control gaps" },
  { cssVar: "--bos-s-4", value: "16px", role: "Card grid gap" },
  { cssVar: "--bos-s-5", value: "20px", role: "Card padding" },
  { cssVar: "--bos-s-6", value: "24px", role: "Shell content padding" },
  { cssVar: "--bos-s-8", value: "32px", role: "Section head spacing" },
  { cssVar: "--bos-s-10", value: "40px", role: "Hero bottom" },
  { cssVar: "--bos-s-12", value: "48px", role: "Large gaps" },
  { cssVar: "--bos-s-16", value: "64px", role: "Section rhythm" },
  { cssVar: "--bos-s-20", value: "80px", role: "Page bottom" },
];

export const BOS_MOTION_TOKENS: BosScaleToken[] = [
  { cssVar: "--bos-ease", value: "cubic-bezier(.4,0,.2,1)", role: "Every transition" },
  { cssVar: "--bos-dur", value: "200ms", role: "Every transition (150–250ms band)" },
];

export type BosTypeStyle = {
  id: "display" | "h1" | "h2" | "body" | "caption" | "mono";
  label: string;
  className: string;
  sample: string;
};

export const BOS_TYPE_SCALE: BosTypeStyle[] = [
  { id: "display", label: "Display / 36·650", className: "bos-text-display", sample: "Operations, unified." },
  { id: "h1", label: "H1 / 27·600", className: "bos-text-h1", sample: "Sales pipeline overview" },
  { id: "h2", label: "H2 / 20·600", className: "bos-text-h2", sample: "Quarterly maintenance schedule" },
  {
    id: "body",
    label: "Body / 15·400",
    className: "bos-text-body",
    sample: "Purchase orders above ₹5,00,000 route to the finance approval queue automatically.",
  },
  { id: "caption", label: "Caption / 12.5·550", className: "bos-text-caption", sample: "Last synced 4 minutes ago" },
  { id: "mono", label: "Mono / Data 13·500", className: "bos-text-mono", sample: "INV-2026-04471 · ₹84,200.00" },
];

export function tokensByGroup(group: BosTokenGroup): BosColorToken[] {
  return BOS_COLOR_TOKENS.filter((t) => t.group === group);
}

export const BOS_TOKEN_GROUPS: BosTokenGroup[] = ["neutrals", "blue", "emerald", "amber", "coral", "pastels"];

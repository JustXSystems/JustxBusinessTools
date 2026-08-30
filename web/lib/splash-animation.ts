/** Splash motion presets — shared by operator splash + admin branding UI. */

export const SPLASH_ANIMATIONS = ["none", "elegant", "orbit", "spark", "dash", "signal"] as const;
export type SplashAnimation = (typeof SPLASH_ANIMATIONS)[number];

export const SPLASH_INTENSITIES = ["subtle", "balanced", "bold"] as const;
export type SplashIntensity = (typeof SPLASH_INTENSITIES)[number];

export const SPLASH_ANIMATION_LABELS: Record<SplashAnimation, string> = {
  none: "Off (static)",
  elegant: "Elegant rise",
  orbit: "Orbit pulse",
  spark: "Spark reveal",
  dash: "Dash cinema",
  signal: "Brand signal (JustXSystems)",
};

export const SPLASH_INTENSITY_LABELS: Record<SplashIntensity, string> = {
  subtle: "Subtle",
  balanced: "Balanced",
  bold: "Bold",
};

export function parseSplashAnimation(raw: unknown): SplashAnimation {
  const v = String(raw ?? "").trim().toLowerCase();
  // Legacy "nexus" maps to brand signal.
  if (v === "nexus") return "signal";
  return (SPLASH_ANIMATIONS as readonly string[]).includes(v)
    ? (v as SplashAnimation)
    : "dash";
}

export function parseSplashIntensity(raw: unknown): SplashIntensity {
  const v = String(raw ?? "").trim().toLowerCase();
  return (SPLASH_INTENSITIES as readonly string[]).includes(v)
    ? (v as SplashIntensity)
    : "balanced";
}

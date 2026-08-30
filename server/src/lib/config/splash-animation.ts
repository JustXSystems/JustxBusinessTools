/** Splash motion presets — mirrored on the web admin UI. */

export const SPLASH_ANIMATIONS = ["none", "elegant", "orbit", "spark", "dash", "signal"] as const;
export type SplashAnimation = (typeof SPLASH_ANIMATIONS)[number];

export const SPLASH_INTENSITIES = ["subtle", "balanced", "bold"] as const;
export type SplashIntensity = (typeof SPLASH_INTENSITIES)[number];

export function parseSplashAnimation(raw: unknown): SplashAnimation {
  const v = String(raw ?? "").trim().toLowerCase();
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

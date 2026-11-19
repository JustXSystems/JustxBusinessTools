"use client";

import type { CSSProperties } from "react";
import type { PlatformBranding } from "@/components/branding/BrandingProvider";
import { DEFAULT_BRANDING } from "@/components/branding/BrandingProvider";
import { AdminSection, AdminTabs } from "@/components/admin/ui";
import { themeTokensToCssVars, type ThemeTokens } from "@/lib/theme";

type FrameId = "splash" | "login" | "home";

const FRAME_OPTIONS: ReadonlyArray<{ value: FrameId; label: string }> = [
  { value: "splash", label: "Splash" },
  { value: "login", label: "Login" },
  { value: "home", label: "Home" },
];

type Props = {
  tokens: ThemeTokens;
  branding?: Partial<PlatformBranding>;
  activeFrame?: FrameId;
  onFrameChange?: (id: FrameId) => void;
};

export function ExperiencePreviewFrames({
  tokens,
  branding,
  activeFrame = "home",
  onFrameChange,
}: Props) {
  const b = { ...DEFAULT_BRANDING, ...branding };
  const vars = themeTokensToCssVars(tokens) as CSSProperties;

  return (
    <AdminSection
      className="xp-preview"
      title="Live preview"
      description="Draft tokens — not saved until you activate"
      actions={
        <AdminTabs
          aria-label="Preview frame"
          options={FRAME_OPTIONS}
          value={activeFrame}
          onChange={(id) => onFrameChange?.(id)}
        />
      }
    >
      <div className="xp-preview-stage">
        <div className="xp-phone" style={vars} data-pack={tokens.pack?.trim() || "default"}>
          <div className="xp-phone-notch" aria-hidden />
          <div className="xp-phone-screen">
            {activeFrame === "splash" ? (
              <div
                className={`xp-frame xp-splash splash-anim-${b.splashAnimation || "elegant"} splash-intensity-${b.splashIntensity || "balanced"}`}
                style={{ ["--splash-ms" as string]: `${Math.max(b.splashDurationMs || 1800, 600)}ms` }}
              >
                <div className="splash-atmosphere" aria-hidden>
                  <span className="splash-orb splash-orb-a" />
                  <span className="splash-orb splash-orb-b" />
                </div>
                <div className="xp-splash-mark splash-logo-core">
                  <img src={b.logoUrl} alt="" width={56} height={56} />
                </div>
                <strong className="xp-splash-name splash-name">{b.appName}</strong>
                <span className="xp-splash-tag splash-tagline">{b.tagline}</span>
                <span className="xp-splash-ms">
                  {b.splashAnimation || "elegant"} · {b.splashIntensity || "balanced"} · {b.splashDurationMs} ms
                </span>
                {b.splashShowProgress !== false ? (
                  <div className="splash-progress xp-splash-progress" aria-hidden>
                    <span className="splash-progress-bar" />
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeFrame === "login" ? (
              <div className="xp-frame xp-login">
                <div className="xp-login-brand">
                  <img src={b.logoUrl} alt="" width={36} height={36} />
                  <div>
                    <strong>{b.appName}</strong>
                    <span>{b.tagline}</span>
                  </div>
                </div>
                <label className="xp-field">
                  <span>Email</span>
                  <input readOnly value="operator@example.com" />
                </label>
                <label className="xp-field">
                  <span>Password</span>
                  <input readOnly type="password" value="••••••••" />
                </label>
                <button type="button" className="xp-btn-primary">
                  Sign in
                </button>
              </div>
            ) : null}

            {activeFrame === "home" ? (
              <div className="xp-frame xp-home">
                <header className="xp-home-top">
                  <img src={b.logoUrl} alt="" width={28} height={28} />
                  <strong>{b.appName}</strong>
                </header>
                <div className="xp-home-hero">
                  <span className="xp-home-greet">Good afternoon</span>
                  <strong>Your tools</strong>
                  <p>Quick access to the workspace.</p>
                </div>
                <div className="xp-home-grid">
                  {["Invoice", "GST", "Tracker", "QR"].map((label) => (
                    <div key={label} className="xp-tool-card">
                      <span className="xp-tool-icon" />
                      <em>{label}</em>
                    </div>
                  ))}
                </div>
                <nav className="xp-home-nav">
                  <span className="is-active">Home</span>
                  <span>Tools</span>
                  <span>Profile</span>
                </nav>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </AdminSection>
  );
}

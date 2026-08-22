"use client";

import type { CSSProperties } from "react";
import type { PlatformBranding } from "@/components/branding/BrandingProvider";
import { DEFAULT_BRANDING } from "@/components/branding/BrandingProvider";
import { themeTokensToCssVars, type ThemeTokens } from "@/lib/theme";

type FrameId = "splash" | "login" | "home";

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
    <section className="panel admin-card xp-preview">
      <div className="analytics-toolbar preview-pane-toolbar">
        <div>
          <span className="preview-pane-title">Live preview</span>
          <p className="muted preview-pane-sub" style={{ margin: "2px 0 0" }}>
            Draft tokens — not saved until you activate
          </p>
        </div>
        <div className="admin-tabs xp-preview-tabs" role="tablist">
          {(
            [
              ["splash", "Splash"],
              ["login", "Login"],
              ["home", "Home"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={activeFrame === id ? "active" : ""}
              onClick={() => onFrameChange?.(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="xp-preview-stage">
        <div className="xp-phone" style={vars}>
          <div className="xp-phone-notch" aria-hidden />
          <div className="xp-phone-screen">
            {activeFrame === "splash" ? (
              <div className="xp-frame xp-splash">
                <div className="xp-splash-mark">
                  <img src={b.logoUrl} alt="" width={56} height={56} />
                </div>
                <strong className="xp-splash-name">{b.appName}</strong>
                <span className="xp-splash-tag">{b.tagline}</span>
                <span className="xp-splash-ms">{b.splashDurationMs} ms</span>
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
    </section>
  );
}

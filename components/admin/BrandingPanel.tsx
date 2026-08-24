"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SplashMark } from "@/components/auth/SplashScreen";
import {
  DEFAULT_BRANDING,
  DEFAULT_POWERED_BY,
  invalidateBrandingCache,
  usePlatformBranding,
  type PlatformBranding,
  type PoweredByConfig,
} from "@/components/branding/BrandingProvider";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { PlatformBrandMark } from "@/components/branding/PlatformBrandMark";
import {
  SPLASH_ANIMATION_LABELS,
  SPLASH_ANIMATIONS,
  SPLASH_INTENSITIES,
  SPLASH_INTENSITY_LABELS,
  type SplashAnimation,
  type SplashIntensity,
} from "@/lib/splash-animation";

type PlatformConfig = {
  powered_by?: PoweredByConfig;
  branding?: PlatformBranding;
};

export function BrandingPanel() {
  const { refresh: refreshConfig } = usePlatformConfig();
  const { refresh: refreshBranding } = usePlatformBranding();
  const [form, setForm] = useState({
    appName: DEFAULT_BRANDING.appName,
    tagline: DEFAULT_BRANDING.tagline,
    splashDurationMs: String(DEFAULT_BRANDING.splashDurationMs),
    splashAnimation: DEFAULT_BRANDING.splashAnimation as SplashAnimation,
    splashIntensity: DEFAULT_BRANDING.splashIntensity as SplashIntensity,
    splashShowProgress: DEFAULT_BRANDING.splashShowProgress,
    logoUrl: DEFAULT_BRANDING.logoUrl,
  });
  const [footerText, setFooterText] = useState(DEFAULT_POWERED_BY.text);
  const [logoDraft, setLogoDraft] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingFooter, setSavingFooter] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewMode, setPreviewMode] = useState<"mark" | "splash">("splash");

  async function reload() {
    const d = await api<{ config: PlatformConfig }>("/admin/config/platform");
    const b = d.config.branding ?? DEFAULT_BRANDING;
    const footer = d.config.powered_by ?? DEFAULT_POWERED_BY;
    setForm({
      appName: b.appName || DEFAULT_BRANDING.appName,
      tagline: b.tagline || DEFAULT_BRANDING.tagline,
      splashDurationMs: String(b.splashDurationMs ?? DEFAULT_BRANDING.splashDurationMs),
      splashAnimation: b.splashAnimation || DEFAULT_BRANDING.splashAnimation,
      splashIntensity: b.splashIntensity || DEFAULT_BRANDING.splashIntensity,
      splashShowProgress:
        b.splashShowProgress == null
          ? DEFAULT_BRANDING.splashShowProgress
          : Boolean(b.splashShowProgress),
      logoUrl: b.logoUrl || DEFAULT_BRANDING.logoUrl,
    });
    setFooterText(footer.text || DEFAULT_POWERED_BY.text);
    setLogoDraft(null);
    setPreviewKey((k) => k + 1);
  }

  useEffect(() => {
    reload().catch((e: Error) => setMessage(e.message));
  }, []);

  async function onLogoFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Choose an image file (PNG, SVG, WebP, or JPEG).");
      return;
    }
    if (file.size > 2_000_000) {
      setMessage("Logo must be under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoDraft(String(reader.result || ""));
      setPreviewKey((k) => k + 1);
    };
    reader.readAsDataURL(file);
  }

  async function saveBranding(clearLogo = false) {
    setSaving(true);
    setMessage("");
    try {
      const splash = Math.round(Number(form.splashDurationMs));
      await api("/admin/config/branding", {
        method: "PUT",
        body: JSON.stringify({
          appName: form.appName.trim(),
          tagline: form.tagline.trim(),
          splashDurationMs: Number.isFinite(splash) ? splash : DEFAULT_BRANDING.splashDurationMs,
          splashAnimation: form.splashAnimation,
          splashIntensity: form.splashIntensity,
          splashShowProgress: form.splashShowProgress,
          logo: clearLogo ? undefined : logoDraft,
          clearLogo,
        }),
      });
      invalidateBrandingCache();
      await refreshBranding();
      await refreshConfig();
      await reload();
      setMessage(clearLogo ? "Logo reset to default." : "Branding saved. Splash will use the new settings.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveFooter() {
    setSavingFooter(true);
    setMessage("");
    try {
      await api("/admin/config/powered-by", {
        method: "PUT",
        body: JSON.stringify({ text: footerText.trim(), locked: true }),
      });
      invalidateBrandingCache();
      await refreshBranding();
      setMessage("Operator footer updated.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Footer save failed");
    } finally {
      setSavingFooter(false);
    }
  }

  const previewLogo = logoDraft || form.logoUrl;
  const draftBranding: PlatformBranding = {
    logoUrl: previewLogo,
    appName: form.appName || DEFAULT_BRANDING.appName,
    tagline: form.tagline || DEFAULT_BRANDING.tagline,
    splashDurationMs: Number.isFinite(Number(form.splashDurationMs))
      ? Math.max(0, Math.round(Number(form.splashDurationMs)))
      : DEFAULT_BRANDING.splashDurationMs,
    splashAnimation: form.splashAnimation,
    splashIntensity: form.splashIntensity,
    splashShowProgress: form.splashShowProgress,
  };

  return (
    <div className="preview-workspace">
      <div className="preview-editor">
        <section className="panel admin-card">
          <h2>Platform branding</h2>
          <p className="muted">Logo, app name, tagline, and splash motion used across operator and admin.</p>
          {message ? <p className="muted">{message}</p> : null}
          <div className="admin-form-grid">
            <label className="field">
              <span>App name</span>
              <input
                value={form.appName}
                onChange={(e) => {
                  setForm({ ...form, appName: e.target.value });
                  setPreviewKey((k) => k + 1);
                }}
              />
            </label>
            <label className="field">
              <span>Tagline</span>
              <input
                value={form.tagline}
                onChange={(e) => {
                  setForm({ ...form, tagline: e.target.value });
                  setPreviewKey((k) => k + 1);
                }}
              />
            </label>
            <label className="field">
              <span>Splash duration (ms)</span>
              <input
                type="number"
                min={0}
                max={15000}
                step={100}
                value={form.splashDurationMs}
                onChange={(e) => {
                  setForm({ ...form, splashDurationMs: e.target.value });
                  setPreviewKey((k) => k + 1);
                }}
              />
            </label>
            <label className="field">
              <span>Splash animation</span>
              <select
                value={form.splashAnimation}
                onChange={(e) => {
                  setForm({ ...form, splashAnimation: e.target.value as SplashAnimation });
                  setPreviewKey((k) => k + 1);
                }}
              >
                {SPLASH_ANIMATIONS.map((id) => (
                  <option key={id} value={id}>
                    {SPLASH_ANIMATION_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Motion intensity</span>
              <select
                value={form.splashIntensity}
                disabled={form.splashAnimation === "none"}
                onChange={(e) => {
                  setForm({ ...form, splashIntensity: e.target.value as SplashIntensity });
                  setPreviewKey((k) => k + 1);
                }}
              >
                {SPLASH_INTENSITIES.map((id) => (
                  <option key={id} value={id}>
                    {SPLASH_INTENSITY_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field-check">
              <span>Show splash progress bar</span>
              <input
                type="checkbox"
                checked={form.splashShowProgress}
                onChange={(e) => {
                  setForm({ ...form, splashShowProgress: e.target.checked });
                  setPreviewKey((k) => k + 1);
                }}
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Logo upload</span>
              <input type="file" accept="image/*" onChange={(e) => void onLogoFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <div className="admin-form-row">
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveBranding(false)}>
              {saving ? "Saving…" : "Save branding"}
            </button>
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void saveBranding(true)}>
              Reset logo
            </button>
          </div>
        </section>

        <section className="panel admin-card" style={{ marginTop: 16 }}>
          <h2>Operator footer</h2>
          <p className="muted">Shown at the bottom of the operator app (Powered by…).</p>
          <label className="field">
            <span>Footer text</span>
            <input value={footerText} onChange={(e) => setFooterText(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary" disabled={savingFooter} onClick={() => void saveFooter()}>
            {savingFooter ? "Saving…" : "Save footer"}
          </button>
        </section>
      </div>

      <aside className="preview-pane" aria-label="Branding preview">
        <div className="preview-pane-toolbar">
          <div>
            <span className="preview-pane-title">Live preview</span>
            <span className="preview-pane-sub">Draft splash — not saved until you click Save</span>
          </div>
          <div className="admin-tabs xp-preview-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className={previewMode === "splash" ? "active" : ""}
              onClick={() => setPreviewMode("splash")}
            >
              Splash
            </button>
            <button
              type="button"
              role="tab"
              className={previewMode === "mark" ? "active" : ""}
              onClick={() => setPreviewMode("mark")}
            >
              Mark
            </button>
          </div>
        </div>
        <div className="preview-pane-scroll">
          {previewMode === "splash" ? (
            <div className="preview-splash-stage">
              <SplashMark key={previewKey} branding={draftBranding} preview />
              <button
                type="button"
                className="btn btn-secondary btn-sm preview-splash-replay"
                onClick={() => setPreviewKey((k) => k + 1)}
              >
                Replay animation
              </button>
            </div>
          ) : (
            <div className="preview-brand-stage">
              <PlatformBrandMark
                size="xl"
                layout="stack"
                logoUrl={previewLogo}
                appName={form.appName || DEFAULT_BRANDING.appName}
                tagline={form.tagline || DEFAULT_BRANDING.tagline}
              />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

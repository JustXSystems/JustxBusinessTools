"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
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
import type { ExperienceSaveHandle } from "@/components/admin/experience-save";
import { invalidateAdminData } from "@/hooks/useLiveRefresh";
import { JUSTX_LOGO_URL, resolveInstallName } from "@/lib/install-branding";
import {
  SPLASH_ANIMATION_LABELS,
  SPLASH_ANIMATIONS,
  SPLASH_INTENSITIES,
  SPLASH_INTENSITY_LABELS,
  type SplashAnimation,
  type SplashIntensity,
} from "@/lib/splash-animation";
import { publicAssetUrl } from "@/lib/base-path";

type PlatformConfig = {
  powered_by?: PoweredByConfig;
  branding?: PlatformBranding;
};

export const BrandingPanel = forwardRef<ExperienceSaveHandle>(function BrandingPanel(_props, ref) {
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
    installName: DEFAULT_BRANDING.installName,
  });
  const [footerText, setFooterText] = useState(DEFAULT_POWERED_BY.text);
  const [logoDraft, setLogoDraft] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewMode, setPreviewMode] = useState<"splash" | "mark" | "install">("splash");

  const reload = useCallback(async () => {
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
      installName: b.installName || DEFAULT_BRANDING.installName,
    });
    setFooterText(footer.text || DEFAULT_POWERED_BY.text);
    setLogoDraft(null);
    setPreviewKey((k) => k + 1);
  }, []);

  useEffect(() => {
    reload().catch((e: Error) => setMessage(e.message));
  }, [reload]);

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

  const saveAll = useCallback(
    async (opts: { clearLogo?: boolean } = {}) => {
      setSaving(true);
      setMessage("");
      try {
        const splash = Math.round(Number(form.splashDurationMs));
        await api<{ branding: PlatformBranding }>("/admin/config/branding", {
          method: "PUT",
          body: JSON.stringify({
            appName: form.appName.trim(),
            tagline: form.tagline.trim(),
            splashDurationMs: Number.isFinite(splash) ? splash : DEFAULT_BRANDING.splashDurationMs,
            splashAnimation: form.splashAnimation,
            splashIntensity: form.splashIntensity,
            splashShowProgress: form.splashShowProgress,
            logo: opts.clearLogo ? undefined : logoDraft,
            clearLogo: Boolean(opts.clearLogo),
            installName: form.installName.trim() || form.appName.trim(),
            installIconUrl: JUSTX_LOGO_URL,
            installIconBg: "transparent",
            clearInstallIcon: true,
          }),
        });
        await api("/admin/config/powered-by", {
          method: "PUT",
          body: JSON.stringify({ text: footerText.trim(), locked: true }),
        });
        invalidateBrandingCache();
        invalidateAdminData("branding");
        await refreshBranding();
        await refreshConfig();
        await reload();
        setMessage(
          opts.clearLogo
            ? "Logo reset and branding saved."
            : "Branding, install name, and footer saved.",
        );
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Save failed");
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [form, footerText, logoDraft, refreshBranding, refreshConfig, reload],
  );

  useImperativeHandle(
    ref,
    () => ({
      save: () => saveAll(),
      isSaving: () => saving,
    }),
    [saveAll, saving],
  );

  const previewLogo = logoDraft || form.logoUrl;
  const previewInstallIcon = publicAssetUrl(JUSTX_LOGO_URL);
  const previewInstallName = resolveInstallName(form.appName, form.installName);
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
    installName: previewInstallName,
    installIconUrl: previewInstallIcon,
    installIconBg: "transparent",
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
                  setPreviewMode("splash");
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
              <span>Splash intensity</span>
              <select
                value={form.splashIntensity}
                onChange={(e) => {
                  setForm({ ...form, splashIntensity: e.target.value as SplashIntensity });
                  setPreviewKey((k) => k + 1);
                  setPreviewMode("splash");
                }}
              >
                {SPLASH_INTENSITIES.map((id) => (
                  <option key={id} value={id}>
                    {SPLASH_INTENSITY_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={form.splashShowProgress}
                onChange={(e) => {
                  setForm({ ...form, splashShowProgress: e.target.checked });
                  setPreviewKey((k) => k + 1);
                }}
              />
              <span>Show splash progress bar</span>
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Logo upload</span>
              <input type="file" accept="image/*" onChange={(e) => void onLogoFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <div className="admin-form-row">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={saving}
              onClick={() => void saveAll({ clearLogo: true })}
            >
              Reset logo to JustX
            </button>
          </div>
        </section>

        <section className="panel admin-card" style={{ marginTop: 16 }}>
          <h2>Desktop / PWA install</h2>
          <p className="muted">
            Install dialog name and icon. The icon is always the official JustX logo.
          </p>
          <div className="admin-form-grid">
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Install name</span>
              <input
                maxLength={40}
                placeholder={form.appName || "JustXSystems"}
                value={form.installName}
                onChange={(e) => {
                  setForm({ ...form, installName: e.target.value });
                  setPreviewKey((k) => k + 1);
                  setPreviewMode("install");
                }}
              />
            </label>
          </div>
          <div className="install-icon-custom-banner">
            <span className="install-icon-thumb install-icon-checker">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={publicAssetUrl(JUSTX_LOGO_URL)} alt="" />
            </span>
            <div>
              <strong>Official JustX logo</strong>
              <p className="muted" style={{ margin: "2px 0 0" }}>
                {JUSTX_LOGO_URL}
              </p>
            </div>
          </div>
        </section>

        <section className="panel admin-card" style={{ marginTop: 16 }}>
          <h2>Operator footer</h2>
          <p className="muted">Shown at the bottom of the operator app (Powered by…).</p>
          <label className="field">
            <span>Footer text</span>
            <input value={footerText} onChange={(e) => setFooterText(e.target.value)} />
          </label>
        </section>
      </div>

      <aside className="preview-pane" aria-label="Branding preview">
        <div className="preview-pane-toolbar">
          <div>
            <strong>Live preview</strong>
            <p className="muted">Updates as you edit — use Save changes to publish.</p>
          </div>
          <div className="preview-mode-tabs">
            {(
              [
                ["splash", "Splash"],
                ["mark", "Mark"],
                ["install", "Install"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`btn btn-sm${previewMode === id ? " btn-primary" : ""}`}
                onClick={() => setPreviewMode(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="preview-pane-stage" key={`${previewMode}-${previewKey}`}>
          {previewMode === "splash" ? <SplashMark branding={draftBranding} preview /> : null}
          {previewMode === "mark" ? (
            <div className="preview-install-stage">
              <PlatformBrandMark
                size="xl"
                layout="stack"
                showText
                logoUrl={previewLogo}
                appName={draftBranding.appName}
                tagline={draftBranding.tagline}
              />
            </div>
          ) : null}
          {previewMode === "install" ? (
            <div className="preview-install-stage">
              <div className="preview-install-card">
                <span className="preview-install-icon install-icon-checker">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewInstallIcon} alt="" style={{ objectFit: "contain" }} />
                </span>
                <div>
                  <strong>{previewInstallName}</strong>
                  <p>Install JustXSystems</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
});

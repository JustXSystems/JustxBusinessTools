"use client";

import { useCallback, useEffect, useState } from "react";
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
import { invalidateAdminData } from "@/hooks/useLiveRefresh";
import {
  INSTALL_ICON_BG_PRESETS,
  INSTALL_ICON_PRESETS,
  isTransparentInstallBg,
  parseInstallIconBg,
  resolveInstallIconDisplay,
  resolveInstallName,
} from "@/lib/install-branding";
import {
  SPLASH_ANIMATION_LABELS,
  SPLASH_ANIMATIONS,
  SPLASH_INTENSITIES,
  SPLASH_INTENSITY_LABELS,
  type SplashAnimation,
  type SplashIntensity,
} from "@/lib/splash-animation";
import { publicAssetUrl } from "@/lib/base-path";

/** Chrome requires square install icons — center-crop + scale to 512 PNG. */
function normalizeInstallIconDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 512;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Could not read install icon"));
    img.src = dataUrl;
  });
}

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
    installName: DEFAULT_BRANDING.installName,
    installIconUrl: DEFAULT_BRANDING.installIconUrl,
    installIconBg: DEFAULT_BRANDING.installIconBg,
  });
  const [footerText, setFooterText] = useState(DEFAULT_POWERED_BY.text);
  const [logoDraft, setLogoDraft] = useState<string | null>(null);
  const [installIconDraft, setInstallIconDraft] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingFooter, setSavingFooter] = useState(false);
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
      installIconUrl: b.installIconUrl || DEFAULT_BRANDING.installIconUrl,
      installIconBg: parseInstallIconBg(b.installIconBg ?? DEFAULT_BRANDING.installIconBg),
    });
    setFooterText(footer.text || DEFAULT_POWERED_BY.text);
    setLogoDraft(null);
    setInstallIconDraft(null);
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

  async function onInstallIconFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Choose an image file (PNG, WebP, or JPEG) for the desktop icon.");
      return;
    }
    if (file.type.includes("svg")) {
      setMessage("For custom desktop icons, upload PNG, WebP, or JPEG (SVG presets are available above).");
      return;
    }
    if (file.size > 2_000_000) {
      setMessage("Install icon must be under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        try {
          const raw = String(reader.result || "");
          const squared = await normalizeInstallIconDataUrl(raw);
          setInstallIconDraft(squared);
          setPreviewKey((k) => k + 1);
          setPreviewMode("install");
          setMessage("Custom icon cropped to a square 512×512 (required for Chrome install).");
        } catch {
          setMessage("Could not process that image. Try a PNG or JPEG.");
        }
      })();
    };
    reader.readAsDataURL(file);
  }

  async function saveBranding(opts: { clearLogo?: boolean; clearInstallIcon?: boolean } = {}) {
    setSaving(true);
    setMessage("");
    try {
      const splash = Math.round(Number(form.splashDurationMs));
      const hadCustomInstall = Boolean(installIconDraft) || Boolean(logoDraft && form.installIconUrl.startsWith("data:"));
      // If matching a not-yet-saved logo data URL, persist it as the install upload.
      const installPayload =
        opts.clearInstallIcon
          ? undefined
          : installIconDraft ||
            (form.installIconUrl.startsWith("data:") ? form.installIconUrl : undefined);
      const installUrlPayload =
        opts.clearInstallIcon || installPayload
          ? undefined
          : form.installIconUrl.startsWith("data:")
            ? undefined
            : form.installIconUrl;

      const result = await api<{ branding: PlatformBranding }>("/admin/config/branding", {
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
          installIcon: installPayload,
          installIconUrl: installUrlPayload,
          installIconBg: parseInstallIconBg(form.installIconBg),
          clearInstallIcon: Boolean(opts.clearInstallIcon),
        }),
      });
      invalidateBrandingCache();
      invalidateAdminData("branding");
      await refreshBranding();
      await refreshConfig();
      await reload();
      if (opts.clearInstallIcon) setMessage("Desktop icon reset to default.");
      else if (opts.clearLogo) setMessage("Logo reset to default.");
      else if (hadCustomInstall || result.branding?.installIconUrl?.startsWith("/api/files/")) {
        setMessage(
          "Install icon saved. Hard-refresh this tab, then uninstall & reinstall the app so the OS shortcut updates.",
        );
      } else {
        setMessage("Branding saved. Reinstall the app to refresh the OS desktop icon.");
      }
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
      invalidateAdminData("branding");
      await refreshBranding();
      setMessage("Operator footer updated.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Footer save failed");
    } finally {
      setSavingFooter(false);
    }
  }

  const previewLogo = logoDraft || form.logoUrl;
  const previewInstallIcon = publicAssetUrl(
    installIconDraft || resolveInstallIconDisplay(previewLogo, form.installIconUrl),
  );
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
    installIconBg: parseInstallIconBg(form.installIconBg),
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
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void saveBranding()}
            >
              {saving ? "Saving…" : "Save branding"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => void saveBranding({ clearLogo: true })}
            >
              Reset logo
            </button>
          </div>
        </section>

        <section className="panel admin-card" style={{ marginTop: 16 }}>
          <h2>Desktop / PWA install</h2>
          <p className="muted">
            Name and icon for the browser Install dialog and desktop shortcut. Use a square PNG
            (512×512 recommended). After saving: hard-refresh, then uninstall the existing app and
            Install again — Windows/Chrome keep the old shortcut icon until reinstall.
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
          <p className="muted" style={{ marginTop: 12, marginBottom: 8 }}>
            Brand icon presets
          </p>
          <div className="install-icon-presets" role="listbox" aria-label="Install icon presets">
            {INSTALL_ICON_PRESETS.map((preset) => {
              const selected =
                !installIconDraft && form.installIconUrl === preset.url;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`install-icon-preset${selected ? " is-selected" : ""}`}
                  onClick={() => {
                    setInstallIconDraft(null);
                    setForm({ ...form, installIconUrl: preset.url });
                    setPreviewKey((k) => k + 1);
                    setPreviewMode("install");
                  }}
                >
                  <span className="install-icon-preset-thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={publicAssetUrl(preset.url)} alt="" />
                  </span>
                  <span className="install-icon-preset-meta">
                    <strong>{preset.label}</strong>
                    <span>{preset.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {(installIconDraft ||
            (!INSTALL_ICON_PRESETS.some((p) => p.url === form.installIconUrl) &&
              form.installIconUrl)) && (
            <div className="install-icon-custom-banner">
              <span className="install-icon-preset-thumb install-icon-checker">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewInstallIcon} alt="" />
              </span>
              <div>
                <strong>{installIconDraft ? "New custom icon ready to save" : "Custom install icon active"}</strong>
                <p className="muted" style={{ margin: "2px 0 0" }}>
                  {installIconDraft
                    ? "Click Save install branding to apply it to the Install dialog and desktop shortcut."
                    : form.installIconUrl}
                </p>
              </div>
            </div>
          )}
          <p className="muted" style={{ marginTop: 14, marginBottom: 8 }}>
            Icon background
          </p>
          <div className="install-bg-presets" role="listbox" aria-label="Install icon background">
            {INSTALL_ICON_BG_PRESETS.map((preset) => {
              const selected = parseInstallIconBg(form.installIconBg) === preset.value;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`install-bg-preset${selected ? " is-selected" : ""}${
                    preset.value === "transparent" ? " is-transparent" : ""
                  }${
                    preset.id === "white" || preset.id === "paper" ? " is-light" : ""
                  }`}
                  style={
                    preset.value === "transparent"
                      ? undefined
                      : { background: preset.value }
                  }
                  title={preset.label}
                  onClick={() => {
                    setForm({ ...form, installIconBg: preset.value });
                    setPreviewKey((k) => k + 1);
                    setPreviewMode("install");
                  }}
                >
                  <span>{preset.label}</span>
                </button>
              );
            })}
            <label className="install-bg-custom" title="Custom color">
              <input
                type="color"
                value={
                  isTransparentInstallBg(form.installIconBg)
                    ? "#0B2E2F"
                    : parseInstallIconBg(form.installIconBg)
                }
                onChange={(e) => {
                  setForm({ ...form, installIconBg: e.target.value.toUpperCase() });
                  setPreviewKey((k) => k + 1);
                  setPreviewMode("install");
                }}
              />
              <span>Custom</span>
            </label>
          </div>
          <div className="admin-form-row" style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                // Data URLs must go through installIcon upload, not installIconUrl.
                if (logoDraft || previewLogo.startsWith("data:")) {
                  setInstallIconDraft(logoDraft || previewLogo);
                } else {
                  setInstallIconDraft(null);
                  setForm({ ...form, installIconUrl: previewLogo });
                }
                setPreviewKey((k) => k + 1);
                setPreviewMode("install");
              }}
            >
              Match app logo
            </button>
            <label className="field" style={{ margin: 0, flex: 1, minWidth: 180 }}>
              <span>Custom install icon (PNG / JPEG / WebP)</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => void onInstallIconFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <div className="admin-form-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void saveBranding()}
            >
              {saving ? "Saving…" : "Save install branding"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => void saveBranding({ clearInstallIcon: true })}
            >
              Reset install icon
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
            <span className="preview-pane-sub">Draft — not saved until you click Save</span>
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
            <button
              type="button"
              role="tab"
              className={previewMode === "install" ? "active" : ""}
              onClick={() => setPreviewMode("install")}
            >
              Install
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
          ) : previewMode === "mark" ? (
            <div className="preview-brand-stage">
              <PlatformBrandMark
                size="xl"
                layout="stack"
                logoUrl={previewLogo}
                appName={form.appName || DEFAULT_BRANDING.appName}
                tagline={form.tagline || DEFAULT_BRANDING.tagline}
              />
            </div>
          ) : (
            <div className="preview-install-stage">
              <div className="preview-install-card">
                <div
                  className={`preview-install-icon${
                    isTransparentInstallBg(form.installIconBg) ? " install-icon-checker" : ""
                  }`}
                  style={
                    isTransparentInstallBg(form.installIconBg)
                      ? undefined
                      : { background: parseInstallIconBg(form.installIconBg) }
                  }
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewInstallIcon} alt="" style={{ objectFit: "contain" }} />
                </div>
                <div>
                  <strong>Install {previewInstallName}</strong>
                  <p>Add to your desktop or home screen for quick access.</p>
                </div>
              </div>
              <p className="muted preview-install-hint">
                Desktop shortcut preview
                {isTransparentInstallBg(form.installIconBg)
                  ? " · transparent background"
                  : ` · bg ${parseInstallIconBg(form.installIconBg)}`}
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

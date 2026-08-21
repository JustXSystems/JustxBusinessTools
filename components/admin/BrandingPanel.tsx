"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
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
    logoUrl: DEFAULT_BRANDING.logoUrl,
  });
  const [footerText, setFooterText] = useState(DEFAULT_POWERED_BY.text);
  const [logoDraft, setLogoDraft] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingFooter, setSavingFooter] = useState(false);

  async function reload() {
    const d = await api<{ config: PlatformConfig }>("/admin/config/platform");
    const b = d.config.branding ?? DEFAULT_BRANDING;
    const footer = d.config.powered_by ?? DEFAULT_POWERED_BY;
    setForm({
      appName: b.appName || DEFAULT_BRANDING.appName,
      tagline: b.tagline || DEFAULT_BRANDING.tagline,
      splashDurationMs: String(b.splashDurationMs ?? DEFAULT_BRANDING.splashDurationMs),
      logoUrl: b.logoUrl || DEFAULT_BRANDING.logoUrl,
    });
    setFooterText(footer.text || DEFAULT_POWERED_BY.text);
    setLogoDraft(null);
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
    reader.onload = () => setLogoDraft(String(reader.result || ""));
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

  return (
    <div className="admin-split">
      <section className="panel admin-card">
        <h2>Platform branding</h2>
        <p className="muted">Logo, app name, tagline, and splash duration used across operator and admin.</p>
        {message ? <p className="muted">{message}</p> : null}
        <div className="admin-form-grid">
          <label className="field">
            <span>App name</span>
            <input value={form.appName} onChange={(e) => setForm({ ...form, appName: e.target.value })} />
          </label>
          <label className="field">
            <span>Tagline</span>
            <input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
          </label>
          <label className="field">
            <span>Splash duration (ms)</span>
            <input
              type="number"
              min={0}
              max={15000}
              step={100}
              value={form.splashDurationMs}
              onChange={(e) => setForm({ ...form, splashDurationMs: e.target.value })}
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

      <div className="admin-pane-stack">
        <section className="panel admin-card">
          <h2>Preview</h2>
          <div className="admin-form-row" style={{ alignItems: "center" }}>
            <PlatformBrandMark
              size="lg"
              layout="stack"
              logoUrl={previewLogo}
              appName={form.appName || DEFAULT_BRANDING.appName}
              tagline={form.tagline || DEFAULT_BRANDING.tagline}
            />
          </div>
        </section>
        <section className="panel admin-card">
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
    </div>
  );
}

"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api } from "@/lib/api";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { usePlatformBranding } from "@/components/branding/BrandingProvider";
import { ExperiencePreviewFrames } from "@/components/admin/ExperiencePreviewFrames";
import type { ExperienceSaveHandle } from "@/components/admin/experience-save";
import {
  applyThemeTokens,
  buildThemeExport,
  JUSTX_ELECTRIC,
  JUSTX_LIGHT,
  parseThemeImport,
  type ThemeTokens,
} from "@/lib/theme";

type Theme = { id: number; name: string; isActive: boolean; tokens: ThemeTokens };
type Preset = { name: string; tokens: ThemeTokens };
type PreviewFrame = "splash" | "login" | "home";

export const ThemeStudioPanel = forwardRef<ExperienceSaveHandle>(function ThemeStudioPanel(_props, ref) {
  const { refresh } = usePlatformConfig();
  const { branding } = usePlatformBranding();
  const fileRef = useRef<HTMLInputElement>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [draft, setDraft] = useState<ThemeTokens>({ ...JUSTX_ELECTRIC });
  const [name, setName] = useState("JustXSystems Electric");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewFrame, setPreviewFrame] = useState<PreviewFrame>("home");

  async function reload() {
    const data = await api<{ themes: Theme[]; presets: Preset[] }>("/admin/themes");
    setThemes(data.themes);
    setPresets(data.presets);
    const active = data.themes.find((t) => t.isActive);
    if (active?.tokens) {
      setDraft({ ...JUSTX_ELECTRIC, ...active.tokens });
      setName(active.name);
      applyThemeTokens(active.tokens);
    }
  }

  useEffect(() => {
    reload().catch((e: Error) => setMessage(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectPreset(p: Preset) {
    setDraft({ ...JUSTX_ELECTRIC, ...p.tokens });
    setName(p.name);
    applyThemeTokens(p.tokens);
  }

  function updateDraft(next: ThemeTokens) {
    setDraft(next);
    applyThemeTokens(next);
  }

  const saveAndActivate = useCallback(async () => {
    setSaving(true);
    setMessage("");
    try {
      const created = await api<{ id: number }>("/admin/themes", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() || "Custom theme", tokens: draft }),
      });
      await api(`/admin/themes/${created.id}/activate`, { method: "POST" });
      applyThemeTokens(draft);
      await refresh();
      setMessage("Theme saved and applied to the operator app.");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
      throw err;
    } finally {
      setSaving(false);
    }
  }, [draft, name, refresh]);

  useImperativeHandle(
    ref,
    () => ({
      save: () => saveAndActivate(),
      isSaving: () => saving,
    }),
    [saveAndActivate, saving],
  );

  function exportTheme() {
    const payload = buildThemeExport(name, draft);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${payload.name.replace(/[^\w.-]+/g, "-").toLowerCase() || "theme"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage("Theme JSON downloaded.");
  }

  function onImportFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseThemeImport(String(reader.result ?? ""));
      if ("error" in parsed) {
        setMessage(parsed.error);
        return;
      }
      setName(parsed.name);
      updateDraft(parsed.tokens);
      setMessage(`Imported “${parsed.name}”. Use Save & activate to publish.`);
    };
    reader.readAsText(file);
  }

  return (
    <div className="preview-workspace">
      <div className="preview-editor">
        {message ? <p className="muted">{message}</p> : null}
        <div className="admin-pane-stack">
          <section className="panel admin-card">
            <h2>Presets</h2>
            <div className="admin-theme-presets">
              {presets.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className="admin-theme-swatch"
                  style={{
                    background: `linear-gradient(135deg, ${p.tokens.bg1} 0%, ${p.tokens.bg2} 55%, ${p.tokens.accent} 100%)`,
                    borderColor: p.tokens.accent,
                  }}
                  onClick={() => selectPreset(p)}
                >
                  <span style={{ color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>{p.name}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="panel admin-card">
            <h2>Saved themes</h2>
            <div className="tracker-list">
              {themes.length === 0 ? (
                <p className="muted">No saved themes yet — save &amp; activate a preset to create one.</p>
              ) : null}
              {themes.map((t) => (
                <div key={t.id} className="tracker-row">
                  <div>
                    <strong>{t.name}</strong>
                    {t.isActive ? <span className="pill pill-success">Active</span> : null}
                  </div>
                  <div className="admin-form-row">
                    {!t.isActive ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={async () => {
                          await api(`/admin/themes/${t.id}/activate`, { method: "POST" });
                          applyThemeTokens(t.tokens);
                          await refresh();
                          await reload();
                        }}
                      >
                        Activate
                      </button>
                    ) : null}
                    {!t.isActive ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={async () => {
                          await api(`/admin/themes/${t.id}`, { method: "DELETE" });
                          await reload();
                        }}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="panel admin-card">
            <h2>Tokens</h2>
            <div className="admin-form-grid">
              {(["accent", "teal", "bg0", "bg1", "bg2"] as const).map((key) => (
                <label key={key} className="field">
                  <span>{key}</span>
                  <input
                    type="color"
                    value={draft[key]}
                    onChange={(e) => updateDraft({ ...draft, [key]: e.target.value })}
                  />
                </label>
              ))}
              <label className="field">
                <span>Accent strong (optional)</span>
                <input
                  type="color"
                  value={draft.accentStrong || draft.accent}
                  onChange={(e) => updateDraft({ ...draft, accentStrong: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Radius</span>
                <input value={draft.radius} onChange={(e) => updateDraft({ ...draft, radius: e.target.value })} />
              </label>
              <label className="field">
                <span>Font</span>
                <input value={draft.font} onChange={(e) => updateDraft({ ...draft, font: e.target.value })} />
              </label>
              <label className="field">
                <span>Color scheme</span>
                <select
                  value={draft.scheme === "light" ? "light" : "dark"}
                  onChange={(e) => {
                    const scheme = e.target.value === "light" ? "light" : "dark";
                    const base = scheme === "light" ? JUSTX_LIGHT : JUSTX_ELECTRIC;
                    updateDraft({
                      ...draft,
                      scheme,
                      bg0: base.bg0,
                      bg1: base.bg1,
                      bg2: base.bg2,
                      accent: scheme === draft.scheme ? draft.accent : base.accent,
                      teal: scheme === draft.scheme ? draft.teal : base.teal,
                      accentStrong: scheme === draft.scheme ? draft.accentStrong : base.accentStrong,
                    });
                  }}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </label>
              <label className="field">
                <span>Theme name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
            </div>
            <div className="admin-form-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => selectPreset({ name: "JustXSystems Electric", tokens: JUSTX_ELECTRIC })}
              >
                Reset JustXSystems Electric
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => selectPreset({ name: "JustXSystems Light", tokens: JUSTX_LIGHT })}
              >
                JustXSystems Light
              </button>
              <button type="button" className="btn btn-ghost" onClick={exportTheme}>
                Export JSON
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
                Import JSON
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  onImportFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
            </div>
          </section>
        </div>
      </div>

      <aside className="preview-pane" aria-label="Theme live preview">
        <ExperiencePreviewFrames
          tokens={draft}
          branding={branding}
          activeFrame={previewFrame}
          onFrameChange={setPreviewFrame}
        />
      </aside>
    </div>
  );
});

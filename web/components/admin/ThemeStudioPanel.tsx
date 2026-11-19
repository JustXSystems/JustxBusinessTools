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
import { AdminOrgSelect } from "@/components/admin/AdminOrgSelect";
import { Alert, Badge, Button, Field, FormGrid, Grid } from "@/components/bos";
import { AdminEmpty, AdminSection } from "@/components/admin/ui";
import { SelectField, TextField } from "@/components/admin/ui/AdminFields";

type Theme = {
  id: number;
  name: string;
  isActive: boolean;
  tokens: ThemeTokens;
  organizationId?: number;
  organizationName?: string | null;
};
type Preset = { name: string; tokens: ThemeTokens };
type PreviewFrame = "splash" | "login" | "home";

export const ThemeStudioPanel = forwardRef<ExperienceSaveHandle>(function ThemeStudioPanel(_props, ref) {
  const { refresh } = usePlatformConfig();
  const { branding } = usePlatformBranding();
  const fileRef = useRef<HTMLInputElement>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ThemeTokens>({ ...JUSTX_ELECTRIC });
  const [name, setName] = useState("Justxsystems Electric");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewFrame, setPreviewFrame] = useState<PreviewFrame>("home");

  async function reload(orgId = organizationId) {
    const qs = orgId != null ? `?organizationId=${orgId}` : "";
    const data = await api<{ themes: Theme[]; presets: Preset[] }>(`/admin/themes${qs}`);
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
  }, [organizationId]);

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
    if (organizationId == null) {
      setMessage("Select an organization before saving a theme");
      throw new Error("organizationId required");
    }
    setSaving(true);
    setMessage("");
    try {
      const created = await api<{ id: number }>("/admin/themes", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim() || "Custom theme",
          tokens: draft,
          organizationId,
        }),
      });
      await api(`/admin/themes/${created.id}/activate`, { method: "POST" });
      applyThemeTokens(draft);
      await refresh();
      setMessage("Theme saved and applied for the selected organization.");
      await reload(organizationId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
      throw err;
    } finally {
      setSaving(false);
    }
  }, [draft, name, organizationId, refresh]);

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
    <Grid template="minmax(0, 1.05fr) minmax(320px, 0.95fr)" min={320} gap={14}>
      <div className="admin-cc-split-stack">
        {message ? <Alert tone="blue" title={message} /> : null}

        <AdminSection
          title="Organization"
          description="Admin Console themes are per organization. Operator Business Profile selection is ignored."
        >
          <FormGrid>
            <AdminOrgSelect
              value={organizationId}
              onChange={setOrganizationId}
              emptyLabel="Select organization to edit themes…"
              full
            />
          </FormGrid>
        </AdminSection>

        <AdminSection title="Presets" description="Start from a preset, then tune tokens below.">
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
        </AdminSection>

        <AdminSection title="Saved themes" description={`${themes.length} saved`}>
          {themes.length === 0 ? (
            <AdminEmpty title="No saved themes yet" icon="sparkle">
              Save &amp; activate a preset to create one.
            </AdminEmpty>
          ) : (
            <div className="admin-cc-stack">
              {themes.map((t) => (
                <div key={t.id} className="admin-cc-row" style={{ cursor: "default" }}>
                  <div className="admin-cc-row-main">
                    <div className="admin-cc-cell-title">{t.name}</div>
                    {t.organizationName ? <div className="admin-cc-cell-sub">{t.organizationName}</div> : null}
                  </div>
                  <div className="admin-cc-actions">
                    {t.isActive ? (
                      <Badge auto tone="emerald">
                        Active
                      </Badge>
                    ) : (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={async () => {
                            await api(`/admin/themes/${t.id}/activate`, { method: "POST" });
                            applyThemeTokens(t.tokens);
                            await refresh();
                            await reload();
                          }}
                        >
                          Activate
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={async () => {
                            await api(`/admin/themes/${t.id}`, { method: "DELETE" });
                            await reload();
                          }}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </AdminSection>

        <AdminSection title="Tokens" description="Colors, radius, font, and scheme apply live to the preview.">
          <div className="admin-cc-form">
            <FormGrid>
              {(["accent", "teal", "bg0", "bg1", "bg2"] as const).map((key) => (
                <Field key={key} label={key}>
                  {({ id, describedBy }) => (
                    <div className="admin-cc-color-row">
                      <input
                        id={id}
                        aria-describedby={describedBy}
                        type="color"
                        value={draft[key]}
                        onChange={(e) => updateDraft({ ...draft, [key]: e.target.value })}
                      />
                      <code className="admin-cc-code">{draft[key]}</code>
                    </div>
                  )}
                </Field>
              ))}
              <Field label="Accent strong (optional)">
                {({ id, describedBy }) => (
                  <div className="admin-cc-color-row">
                    <input
                      id={id}
                      aria-describedby={describedBy}
                      type="color"
                      value={draft.accentStrong || draft.accent}
                      onChange={(e) => updateDraft({ ...draft, accentStrong: e.target.value })}
                    />
                    <code className="admin-cc-code">{draft.accentStrong || draft.accent}</code>
                  </div>
                )}
              </Field>
              <TextField
                label="Radius"
                value={draft.radius}
                onChange={(e) => updateDraft({ ...draft, radius: e.target.value })}
              />
              <TextField
                label="Font"
                value={draft.font}
                onChange={(e) => updateDraft({ ...draft, font: e.target.value })}
              />
              <SelectField
                label="Color scheme"
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
              </SelectField>
              <TextField label="Theme name" value={name} onChange={(e) => setName(e.target.value)} />
            </FormGrid>
            <div className="admin-cc-actions" style={{ justifyContent: "flex-start" }}>
              <Button
                variant="secondary"
                onClick={() => selectPreset({ name: "Justxsystems Electric", tokens: JUSTX_ELECTRIC })}
              >
                Reset Justxsystems Electric
              </Button>
              <Button
                variant="secondary"
                onClick={() => selectPreset({ name: "Justxsystems Light", tokens: JUSTX_LIGHT })}
              >
                Justxsystems Light
              </Button>
              <Button variant="ghost" onClick={exportTheme}>
                Export JSON
              </Button>
              <Button variant="ghost" onClick={() => fileRef.current?.click()}>
                Import JSON
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                aria-label="Import theme JSON"
                onChange={(e) => {
                  onImportFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        </AdminSection>
      </div>

      <aside aria-label="Theme live preview" className="admin-cc-split-stack">
        <ExperiencePreviewFrames
          tokens={draft}
          branding={branding}
          activeFrame={previewFrame}
          onFrameChange={setPreviewFrame}
        />
      </aside>
    </Grid>
  );
});

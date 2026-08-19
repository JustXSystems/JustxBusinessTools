"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { usePlatformConfig } from "@/components/config/ConfigProvider";

type Tokens = {
  accent: string;
  teal: string;
  bg0: string;
  bg1: string;
  bg2: string;
  radius: string;
  font: string;
};

type Theme = { id: number; name: string; isActive: boolean; tokens: Tokens };
type Preset = { name: string; tokens: Tokens };

export default function AdminThemePage() {
  const { refresh } = usePlatformConfig();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [draft, setDraft] = useState<Tokens>({
    accent: "#00dfff",
    teal: "#2dd4bf",
    bg0: "#0a0b0f",
    bg1: "#12141c",
    bg2: "#1a1d28",
    radius: "14px",
    font: "system-ui",
  });
  const [name, setName] = useState("Studio custom");
  const [message, setMessage] = useState("");

  async function reload() {
    const data = await api<{ themes: Theme[]; presets: Preset[] }>("/admin/themes");
    setThemes(data.themes);
    setPresets(data.presets);
    const active = data.themes.find((t) => t.isActive);
    if (active?.tokens) setDraft({ ...draft, ...active.tokens });
  }

  useEffect(() => {
    reload().catch((e) => setMessage(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreview(tokens: Tokens) {
    const root = document.documentElement;
    root.style.setProperty("--accent", tokens.accent);
    root.style.setProperty("--teal", tokens.teal);
    root.style.setProperty("--bg-0", tokens.bg0);
    root.style.setProperty("--bg-1", tokens.bg1);
    root.style.setProperty("--bg-2", tokens.bg2);
    root.style.setProperty("--radius", tokens.radius);
  }

  return (
    <div className="admin-page">
      <div className="admin-split">
        <div className="admin-pane-stack">
          <section className="panel admin-card">
            <h2>Theme studio</h2>
            <p className="muted">Live-preview tokens, save named themes, and activate one for the whole organization.</p>
            <div className="admin-theme-presets">
              {presets.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className="admin-theme-swatch"
                  style={{ background: p.tokens.bg1, borderColor: p.tokens.accent }}
                  onClick={() => {
                    setDraft(p.tokens);
                    setName(p.name);
                    applyPreview(p.tokens);
                  }}
                >
                  <span style={{ color: p.tokens.accent }}>{p.name}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="panel admin-card">
            <h2>Saved themes</h2>
            <div className="tracker-list">
              {themes.map((t) => (
                <div key={t.id} className="tracker-row">
                  <div>
                    <strong>{t.name}</strong>
                    {t.isActive ? <span className="pill pill-success">Active</span> : null}
                  </div>
                  <div className="admin-form-row">
                    {!t.isActive ? (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={async () => {
                        await api(`/admin/themes/${t.id}/activate`, { method: "POST" });
                        await refresh();
                        await reload();
                      }}>Activate</button>
                    ) : null}
                    {!t.isActive ? (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={async () => {
                        await api(`/admin/themes/${t.id}`, { method: "DELETE" });
                        await reload();
                      }}>Delete</button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="panel admin-card">
          <h2>Tokens</h2>
          <div className="admin-form-grid">
            {(["accent", "teal", "bg0", "bg1", "bg2"] as const).map((key) => (
              <label key={key} className="field">
                <span>{key}</span>
                <input
                  type="color"
                  value={draft[key]}
                  onChange={(e) => {
                    const next = { ...draft, [key]: e.target.value };
                    setDraft(next);
                    applyPreview(next);
                  }}
                />
              </label>
            ))}
            <label className="field">
              <span>Radius</span>
              <input value={draft.radius} onChange={(e) => setDraft({ ...draft, radius: e.target.value })} />
            </label>
            <label className="field">
              <span>Font</span>
              <input value={draft.font} onChange={(e) => setDraft({ ...draft, font: e.target.value })} />
            </label>
            <label className="field">
              <span>Theme name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <div className="admin-form-row">
            <button type="button" className="btn btn-primary" onClick={async () => {
              const created = await api<{ id: number }>("/admin/themes", {
                method: "POST",
                body: JSON.stringify({ name, tokens: draft }),
              });
              await api(`/admin/themes/${created.id}/activate`, { method: "POST" });
              await refresh();
              setMessage("Theme saved and activated.");
              await reload();
            }}>Save & activate</button>
          </div>
          {message ? <p className="muted">{message}</p> : null}
        </section>
      </div>
    </div>
  );
}

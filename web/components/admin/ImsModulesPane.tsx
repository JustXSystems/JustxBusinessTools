"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import type { ToolsSaveHandle } from "@/components/admin/tools-actions";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { api } from "@/lib/api";

type ProfileOption = { id: number; businessName: string; isDefault: boolean };

type CatalogRow = { key: string; label: string; section: string; required?: boolean };

type ModulesState = {
  businessProfileId: number;
  profiles: ProfileOption[];
  unrestricted: boolean;
  enabled: string[];
  alwaysOn: string[];
  catalog: CatalogRow[];
};

function clampWidthPct(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 90;
  return Math.min(100, Math.max(50, Math.round(n)));
}

export const ImsModulesPane = forwardRef<
  ToolsSaveHandle,
  {
    profiles: ProfileOption[];
    businessProfileId: number | null;
    onBusinessProfileChange: (id: number) => void;
    onSaved: (msg: string) => void;
  }
>(function ImsModulesPane({ profiles, businessProfileId, onBusinessProfileChange, onSaved }, ref) {
  const { refresh: refreshConfig } = usePlatformConfig();
  const [state, setState] = useState<ModulesState | null>(null);
  const [unrestricted, setUnrestricted] = useState(true);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [contentWidthPct, setContentWidthPct] = useState(90);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async (profileId: number | null) => {
    setLoadError("");
    const qs = profileId != null ? `?businessProfileId=${profileId}` : "";
    try {
      const [data, layout] = await Promise.all([
        api<ModulesState>(`/admin/ims-modules${qs}`),
        api<{ imsLayout: { contentWidthPct: number } }>("/admin/config/ims-layout"),
      ]);
      setState(data);
      setUnrestricted(data.unrestricted);
      setEnabled(new Set(data.enabled));
      setContentWidthPct(clampWidthPct(layout.imsLayout?.contentWidthPct));
      if (data.businessProfileId !== profileId) onBusinessProfileChange(data.businessProfileId);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load IMS modules");
      setState(null);
    }
  }, [onBusinessProfileChange]);

  useEffect(() => {
    void load(businessProfileId);
  }, [businessProfileId, load]);

  const alwaysOn = useMemo(() => new Set(state?.alwaysOn ?? ["dashboard", "settings", "more", "helpdesk"]), [state]);

  const sections = useMemo(() => {
    const catalog = state?.catalog ?? [];
    const map = new Map<string, CatalogRow[]>();
    for (const row of catalog) {
      const list = map.get(row.section) ?? [];
      list.push(row);
      map.set(row.section, list);
    }
    return [...map.entries()];
  }, [state]);

  function toggle(key: string, on: boolean) {
    if (alwaysOn.has(key)) return;
    setEnabled((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      for (const k of alwaysOn) next.add(k);
      return next;
    });
  }

  function selectSection(section: string, on: boolean) {
    const rows = sections.find(([s]) => s === section)?.[1] ?? [];
    setEnabled((prev) => {
      const next = new Set(prev);
      for (const row of rows) {
        if (alwaysOn.has(row.key)) continue;
        if (on) next.add(row.key);
        else next.delete(row.key);
      }
      for (const k of alwaysOn) next.add(k);
      return next;
    });
  }

  async function save() {
    if (!state) return;
    setBusy(true);
    try {
      const width = clampWidthPct(contentWidthPct);
      const [data, layout] = await Promise.all([
        api<ModulesState>("/admin/ims-modules", {
          method: "PUT",
          body: JSON.stringify({
            businessProfileId: state.businessProfileId,
            unrestricted,
            enabled: unrestricted ? undefined : [...enabled],
          }),
        }),
        api<{ imsLayout: { contentWidthPct: number } }>("/admin/config/ims-layout", {
          method: "PUT",
          body: JSON.stringify({ contentWidthPct: width }),
        }),
      ]);
      setState(data);
      setUnrestricted(data.unrestricted);
      setEnabled(new Set(data.enabled));
      setContentWidthPct(clampWidthPct(layout.imsLayout.contentWidthPct));
      await refreshConfig().catch(() => undefined);
      onSaved(
        unrestricted
          ? `IMS layout ${width}% · all left-nav modules available for this profile.`
          : `IMS layout ${width}% · ${data.enabled.length} modules enabled for this profile.`,
      );
    } catch (err) {
      onSaved(err instanceof Error ? err.message : "Save failed");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      save,
      isBusy: () => busy,
      label: () => "Save modules",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latest form state closed over on each render
    [busy, state, unrestricted, enabled, contentWidthPct],
  );

  const profileList = state?.profiles?.length ? state.profiles : profiles;

  return (
    <section className="panel admin-card tm-pane" aria-label="IMS modules">
      <h2>Layout &amp; modules</h2>
      <p className="muted">
        Full-screen IMS (`/ims`) uses a configurable share of the browser width. Per profile, choose which left-nav
        items are available — team roles can only further restrict within that list.
      </p>

      <label className="field" style={{ maxWidth: 420, marginTop: 16 }}>
        <span>Full-screen content width ({contentWidthPct}% of window)</span>
        <input
          type="range"
          min={50}
          max={100}
          step={1}
          value={contentWidthPct}
          disabled={busy}
          onChange={(e) => setContentWidthPct(clampWidthPct(e.target.value))}
          aria-label="IMS full-screen content width percent"
        />
        <span className="muted small">Applies org-wide to `/ims`. Default 90%. Sidebar can still be collapsed inside the app.</span>
      </label>

      <label className="field" style={{ maxWidth: 360, marginTop: 12 }}>
        <span>Business profile</span>
        <select
          value={businessProfileId ?? state?.businessProfileId ?? ""}
          onChange={(e) => onBusinessProfileChange(Number(e.target.value))}
          aria-label="Business profile for IMS modules"
        >
          {profileList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.businessName}
              {p.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
      </label>

      {loadError ? <p className="muted">{loadError}</p> : null}
      {!state && !loadError ? <p className="muted">Loading modules…</p> : null}

      {state ? (
        <>
          <label className="integ-switch" style={{ marginTop: 16 }}>
            <input
              type="checkbox"
              checked={unrestricted}
              disabled={busy}
              onChange={(e) => {
                const on = e.target.checked;
                setUnrestricted(on);
                if (on) setEnabled(new Set(state.catalog.map((c) => c.key)));
              }}
            />
            <span className="integ-switch-copy">
              <strong>All modules</strong>
              <span>Leave unrestricted — every left-nav item is available (subject to IMS roles).</span>
            </span>
          </label>

          <fieldset disabled={unrestricted || busy} style={{ border: 0, padding: 0, margin: "16px 0 0", opacity: unrestricted ? 0.55 : 1 }}>
            <legend className="sr-only">Module selection</legend>
            <div style={{ display: "grid", gap: 18 }}>
              {sections.map(([section, rows]) => {
                const optional = rows.filter((r) => !alwaysOn.has(r.key));
                const allOn = optional.every((r) => enabled.has(r.key));
                return (
                  <div key={section}>
                    <div className="admin-form-row" style={{ alignItems: "center", marginBottom: 8 }}>
                      <h3 style={{ margin: 0, fontSize: 15 }}>{section}</h3>
                      {optional.length ? (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => selectSection(section, !allOn)}>
                          {allOn ? "Clear section" : "Select section"}
                        </button>
                      ) : null}
                    </div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {rows.map((row) => {
                        const locked = alwaysOn.has(row.key);
                        return (
                          <label key={row.key} className="integ-switch">
                            <input
                              type="checkbox"
                              checked={locked || enabled.has(row.key)}
                              disabled={locked || unrestricted || busy}
                              onChange={(e) => toggle(row.key, e.target.checked)}
                            />
                            <span className="integ-switch-copy">
                              <strong>
                                {row.label}
                                {locked ? " · always on" : ""}
                              </strong>
                              <span>{row.key}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        </>
      ) : null}
    </section>
  );
});

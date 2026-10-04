"use client";

import { useEffect, useState } from "react";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { api } from "@/lib/api";

type AdminSwitch = { key: string; tool: string; label: string; description: string; enabled: boolean };

/**
 * Per-tool feature switches (Admin → Tools → <tool> → Placement). Each switch gates a change to a
 * screen customers already use, so all of them start off.
 */
export function FeatureSwitchesPanel({ toolId, toolName, toolLive }: { toolId: string; toolName: string; toolLive: boolean }) {
  const { refresh } = usePlatformConfig();
  const [switches, setSwitches] = useState<AdminSwitch[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    api<{ switches: AdminSwitch[] }>("/admin/features").then(
      (r) => alive && setSwitches(r.switches),
      () => alive && setSwitches([]),
    );
    return () => {
      alive = false;
    };
  }, []);

  const mine = switches?.filter((s) => s.tool === toolId) ?? [];
  if (!mine.length) return null;

  async function toggle(s: AdminSwitch, enabled: boolean) {
    setBusyKey(s.key);
    setMessage("");
    try {
      const r = await api<{ switches: AdminSwitch[] }>(`/admin/features/${encodeURIComponent(s.key)}`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      setSwitches(r.switches);
      setMessage(`${s.label} is ${enabled ? "on" : "off"}. Users see the change within a minute or on refresh.`);
      await refresh().catch(() => undefined);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not update the switch");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="panel admin-card tm-pane" style={{ marginTop: 16 }} aria-label={`${toolName} switches`}>
      <h2>Switches</h2>
      <p className="muted">
        Optional changes to screens your team already uses. Everything starts off — turn a switch on when this organization is ready. Each switch saves as soon as you flip it.
      </p>
      {toolLive ? null : <p className="muted small">These take effect once {toolName} is Live (Visible on home → Live, then Save placement).</p>}
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {mine.map((s) => (
          <label key={s.key} className="integ-switch">
            <input type="checkbox" checked={s.enabled} disabled={busyKey !== null} onChange={(e) => void toggle(s, e.target.checked)} />
            <span className="integ-switch-copy">
              <strong>{s.label}</strong>
              <span>{s.description}</span>
            </span>
          </label>
        ))}
      </div>
      {message ? <p className="muted small">{message}</p> : null}
    </section>
  );
}

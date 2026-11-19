"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Switch } from "@/components/bos";
import { AdminEmpty, AdminSection } from "@/components/admin/ui";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { api } from "@/lib/api";

type AdminSwitch = { key: string; tool: string; label: string; description: string; enabled: boolean };

/**
 * Per-tool feature switches (Admin → Tools → <tool> → Placement). Each switch gates a change to a
 * screen customers already use, so all of them start off.
 */
export function FeatureSwitchesPanel({
  toolId,
  toolName,
  toolLive,
  businessProfileId,
}: {
  toolId: string;
  toolName: string;
  toolLive: boolean;
  businessProfileId: number | null;
}) {
  const { refresh } = usePlatformConfig();
  const [switches, setSwitches] = useState<AdminSwitch[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    if (businessProfileId == null) {
      setSwitches([]);
      return () => {
        alive = false;
      };
    }
    const qs = `?businessProfileId=${businessProfileId}`;
    api<{ switches: AdminSwitch[] }>(`/admin/features${qs}`).then(
      (r) => alive && setSwitches(r.switches),
      () => alive && setSwitches([]),
    );
    return () => {
      alive = false;
    };
  }, [businessProfileId]);

  const mine = switches?.filter((s) => s.tool === toolId) ?? [];
  if (businessProfileId == null) {
    return (
      <AdminSection title="Switches" description="Select a Business Profile above to manage org feature switches.">
        <AdminEmpty title="No Business Profile selected" icon="search" />
      </AdminSection>
    );
  }
  if (switches == null) {
    return (
      <AdminSection title="Switches" description="Loading feature switches…">
        <div aria-busy="true" aria-label="Loading feature switches" className="bos-text-muted">
          Loading…
        </div>
      </AdminSection>
    );
  }
  if (!mine.length) {
    return (
      <AdminSection title="Switches" description={`No feature switches registered for ${toolName}.`}>
        <AdminEmpty title="No switches for this tool" />
      </AdminSection>
    );
  }

  async function toggle(s: AdminSwitch, enabled: boolean) {
    if (businessProfileId == null) return;
    setBusyKey(s.key);
    setMessage("");
    try {
      const r = await api<{ switches: AdminSwitch[] }>(`/admin/features/${encodeURIComponent(s.key)}`, {
        method: "PUT",
        body: JSON.stringify({ enabled, businessProfileId }),
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
    <AdminSection
      title="Switches"
      description="Optional changes to screens your team already uses. Everything starts off — turn a switch on when this organization is ready. Each switch saves as soon as you flip it."
      actions={
        <Badge auto tone={mine.some((s) => s.enabled) ? "emerald" : "neutral"}>
          {mine.filter((s) => s.enabled).length}/{mine.length} on
        </Badge>
      }
    >
      <div aria-label={`${toolName} switches`} className="admin-cc-stack">
        {toolLive ? null : (
          <Alert tone="amber" title={`${toolName} is not Live yet`}>
            These take effect once {toolName} is Live (Visible on home → Live, then Save placement).
          </Alert>
        )}
        {mine.map((s) => (
          <div key={s.key} className="admin-cc-row" style={{ cursor: "default" }}>
            <div className="admin-cc-row-main">
              <div className="admin-cc-cell-title">{s.label}</div>
              <div className="admin-cc-cell-sub">{s.description}</div>
            </div>
            <Switch
              checked={s.enabled}
              disabled={busyKey !== null}
              onChange={(next) => void toggle(s, next)}
              aria-label={`${s.label} (${s.enabled ? "on" : "off"})`}
            />
          </div>
        ))}
        {message ? <Alert tone="blue" title={message} /> : null}
      </div>
    </AdminSection>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Button, Card, useToast } from "@/components/bos";
import { useOptionalPlatformConfig, useClockDisplaySettings, usePoweredByText } from "@/components/config/ConfigProvider";
import { ClockDisplaySettingsPanel } from "@/components/profile/ClockDisplaySettingsPanel";
import { api } from "@/lib/api";
import { normalizeClockDisplaySettings, type ClockDisplaySettings } from "@/lib/clock-display";

/**
 * Reusable Footer & Clock display control for any tool's Settings page
 * (BOS Settings, IMS Settings, etc.). Updates the same business-profile
 * clock settings that JBT Business Profile controls.
 */
export function FooterClockSettingsCard({ disabled = false }: { disabled?: boolean }) {
  const ctx = useOptionalPlatformConfig();
  const activeClock = useClockDisplaySettings();
  const poweredByText = usePoweredByText();
  const { show } = useToast();
  const [draft, setDraft] = useState<ClockDisplaySettings>(() => normalizeClockDisplaySettings(activeClock));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(normalizeClockDisplaySettings(activeClock));
  }, [activeClock.visible, activeClock.format]);

  const dirty = draft.visible !== activeClock.visible || draft.format !== activeClock.format;

  async function save() {
    setBusy(true);
    try {
      const res = await api<{ clockDisplay: ClockDisplaySettings }>("/profile/clock-display", {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      setDraft(normalizeClockDisplaySettings(res.clockDisplay));
      await ctx?.refresh?.().catch(() => undefined);
      show({ title: "Footer & clock saved", description: "Applied across JBT and all tools." });
    } catch (err) {
      show({
        title: "Could not save footer settings",
        description: err instanceof Error ? err.message : "Request failed",
        tone: "amber",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card interactive={false} style={{ maxWidth: 760 }}>
      <div className="bos-row-between" style={{ marginBottom: 14 }}>
        <div>
          <div className="bos-kpi-label">JBT Footer &amp; Live Clock</div>
          <div className="bos-text-faint" style={{ fontSize: 12, marginTop: 4 }}>
            Controls the bottom status bar (date, time &amp; Powered by) across JBT and all standalone tools. Synced with your JBT Business Profile.
          </div>
        </div>
      </div>

      <ClockDisplaySettingsPanel
        value={draft}
        poweredByText={poweredByText}
        disabled={disabled || busy}
        onChange={setDraft}
      />

      {!disabled ? (
        <div className="bos-row" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          {dirty ? (
            <Button
              size="sm"
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => setDraft(normalizeClockDisplaySettings(activeClock))}
            >
              Reset
            </Button>
          ) : null}
          <Button size="sm" variant="primary" type="button" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save footer settings"}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

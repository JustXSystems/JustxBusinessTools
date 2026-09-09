"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CLOCK_DISPLAY_FORMATS,
  CLOCK_DISPLAY_TZ_LABEL,
  CLOCK_FORMAT_GROUPS,
  clockDisplayNeedsSeconds,
  getClockChromeParts,
  normalizeClockDisplaySettings,
  type ClockDisplayFormatId,
  type ClockDisplaySettings,
} from "@/lib/clock-display";

type Props = {
  value: ClockDisplaySettings;
  disabled?: boolean;
  poweredByText?: string;
  onChange: (next: ClockDisplaySettings) => void;
};

function StatusClockPreview({
  format,
  visible,
  poweredByText,
}: {
  format: ClockDisplayFormatId;
  visible: boolean;
  poweredByText: string;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const ms = clockDisplayNeedsSeconds(format) ? 1000 : 15_000;
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [format]);

  const parts = getClockChromeParts(now, format);

  return (
    <div
      className={`clock-status-mock${visible ? "" : " is-off"}`}
      aria-hidden={!visible}
      aria-label="Footer status bar preview"
    >
      <div className="clock-status-mock-bar">
        {visible ? (
          <span className={`status-clock${parts.live ? " is-live" : ""}`}>
            {parts.live ? <span className="status-clock-pulse" /> : null}
            {parts.weekday ? <span className="status-clock-weekday">{parts.weekday}</span> : null}
            {parts.weekday && (parts.dateLine || parts.timeLine) ? (
              <span className="status-clock-sep" />
            ) : null}
            {parts.dateLine ? <span className="status-clock-date">{parts.dateLine}</span> : null}
            {parts.dateLine && parts.timeLine ? <span className="status-clock-sep" /> : null}
            {parts.timeLine ? <span className="status-clock-time">{parts.timeLine}</span> : null}
            {!parts.dateLine && !parts.timeLine ? (
              <span className="status-clock-time">{parts.stamp}</span>
            ) : null}
            {parts.showTzChip ? (
              <span className="status-clock-tz">{CLOCK_DISPLAY_TZ_LABEL}</span>
            ) : null}
          </span>
        ) : (
          <span className="clock-status-mock-empty">Status clock hidden</span>
        )}
        <span className="clock-status-mock-end">
          {visible ? <span className="powered-by-footer-divider" /> : null}
          <span className="clock-status-mock-brand">{poweredByText}</span>
        </span>
      </div>
      <p className="clock-status-mock-caption">
        Desktop status bar · India Standard Time · not shown on mobile bottom nav
      </p>
    </div>
  );
}

export function ClockDisplaySettingsPanel({
  value,
  disabled,
  poweredByText = "Powered by JustXSystems",
  onChange,
}: Props) {
  const settings = normalizeClockDisplaySettings(value);

  const grouped = useMemo(
    () =>
      CLOCK_FORMAT_GROUPS.map((g) => ({
        ...g,
        formats: CLOCK_DISPLAY_FORMATS.filter((f) => f.group === g.id),
      })),
    [],
  );

  function patch(partial: Partial<ClockDisplaySettings>) {
    if (disabled) return;
    onChange(normalizeClockDisplaySettings({ ...settings, ...partial }));
  }

  return (
    <div className="clock-display-panel">
      <div className="clock-display-panel-head">
        <div>
          <h3 className="panel-title" style={{ marginBottom: 4 }}>
            Status bar date &amp; time
          </h3>
          <p className="section-note" style={{ margin: 0 }}>
            A quiet corporate clock in the desktop footer — left of Powered by. Staff see the same
            format across this Business Profile.
          </p>
        </div>
      </div>

      <label className={`clock-display-switch${settings.visible ? " is-on" : ""}${disabled ? " is-disabled" : ""}`}>
        <span className="clock-display-switch-track" aria-hidden>
          <span className="clock-display-switch-thumb" />
        </span>
        <input
          type="checkbox"
          className="sr-only"
          checked={settings.visible}
          disabled={disabled}
          onChange={(e) => patch({ visible: e.target.checked })}
        />
        <span className="clock-display-switch-copy">
          <strong>{settings.visible ? "Visible on desktop status bar" : "Hidden from status bar"}</strong>
          <span>
            {settings.visible
              ? "Live IST clock for every signed-in user on this profile."
              : "Footer shows branding only. Turn on when field teams need a shared wall clock."}
          </span>
        </span>
      </label>

      <StatusClockPreview
        format={settings.format}
        visible={settings.visible}
        poweredByText={poweredByText}
      />

      <div className={`clock-format-gallery${settings.visible ? "" : " is-dimmed"}`}>
        <div className="clock-format-gallery-head">
          <span className="label">Presentation format</span>
          <span className="clock-format-gallery-hint">Tap a card — preview updates instantly</span>
        </div>

        {grouped.map((group) => (
          <div key={group.id} className="clock-format-group">
            <div className="clock-format-group-label">
              <span>{group.label}</span>
              <span>{group.hint}</span>
            </div>
            <div className="clock-format-grid" role="radiogroup" aria-label={group.label}>
              {group.formats.map((f) => {
                const selected = settings.format === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={disabled || !settings.visible}
                    className={`clock-format-card${selected ? " is-selected" : ""}`}
                    onClick={() => patch({ format: f.id })}
                  >
                    <span className="clock-format-card-top">
                      <span className="clock-format-card-name">{f.label}</span>
                      {selected ? <span className="clock-format-card-check" aria-hidden>✓</span> : null}
                    </span>
                    <span className="clock-format-card-sample">{f.example}</span>
                    <span className="clock-format-card-tone">{f.tone}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

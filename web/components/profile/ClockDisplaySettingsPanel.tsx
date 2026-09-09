"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CLOCK_DISPLAY_FORMATS,
  CLOCK_DISPLAY_TZ_LABEL,
  CLOCK_FORMAT_GROUPS,
  clockDisplayNeedsSeconds,
  formatClockDisplay,
  getClockChromeParts,
  getClockDisplayFormatMeta,
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

function useLiveNow(format: ClockDisplayFormatId, active: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const ms = clockDisplayNeedsSeconds(format) ? 1000 : 15_000;
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, ms);
    return () => window.clearInterval(id);
  }, [format, active]);
  return now;
}

function StatusClockPreview({
  format,
  visible,
  poweredByText,
}: {
  format: ClockDisplayFormatId;
  visible: boolean;
  poweredByText: string;
}) {
  const now = useLiveNow(format, true);
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
        Desktop status bar · IST · hidden on mobile bottom nav
      </p>
    </div>
  );
}

function FormatPicker({
  value,
  disabled,
  onChange,
}: {
  value: ClockDisplayFormatId;
  disabled?: boolean;
  onChange: (id: ClockDisplayFormatId) => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const now = useLiveNow(value, true);
  const meta = getClockDisplayFormatMeta(value);

  const grouped = useMemo(
    () =>
      CLOCK_FORMAT_GROUPS.map((g) => ({
        ...g,
        formats: CLOCK_DISPLAY_FORMATS.filter((f) => f.group === g.id),
      })),
    [],
  );

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      className={`clock-format-picker${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}
      ref={rootRef}
    >
      <span className="label" id={`${listId}-label`}>
        Presentation format
      </span>
      <button
        type="button"
        className="clock-format-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${listId}-label`}
        aria-controls={listId}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
      >
        <span className="clock-format-trigger-main">
          <span className="clock-format-trigger-name">{meta.label}</span>
          <span className="clock-format-trigger-sample">{formatClockDisplay(now, value)}</span>
        </span>
        <span className="clock-format-trigger-meta">
          <span className="clock-format-trigger-group">
            {CLOCK_FORMAT_GROUPS.find((g) => g.id === meta.group)?.label}
          </span>
          <span className="clock-format-chevron" aria-hidden />
        </span>
      </button>

      {open ? (
        <div className="clock-format-menu" role="listbox" id={listId} aria-labelledby={`${listId}-label`}>
          {grouped.map((group) => (
            <div key={group.id} className="clock-format-menu-group" role="group" aria-label={group.label}>
              <div className="clock-format-menu-heading">{group.label}</div>
              {group.formats.map((f) => {
                const selected = value === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`clock-format-option${selected ? " is-selected" : ""}`}
                    onClick={() => {
                      onChange(f.id);
                      setOpen(false);
                    }}
                  >
                    <span className="clock-format-option-copy">
                      <span className="clock-format-option-name">{f.label}</span>
                      <span className="clock-format-option-tone">{f.tone}</span>
                    </span>
                    <span className="clock-format-option-sample">{formatClockDisplay(now, f.id)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
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

  function patch(partial: Partial<ClockDisplaySettings>) {
    if (disabled) return;
    onChange(normalizeClockDisplaySettings({ ...settings, ...partial }));
  }

  return (
    <div className="clock-display-panel">
      <div className="clock-display-panel-head">
        <h3 className="panel-title" style={{ marginBottom: 4 }}>
          Status bar date &amp; time
        </h3>
        <p className="section-note" style={{ margin: 0 }}>
          Quiet IST clock on the desktop footer, left of Powered by. Same format for every user on
          this Business Profile.
        </p>
      </div>

      <label
        className={`clock-display-switch${settings.visible ? " is-on" : ""}${disabled ? " is-disabled" : ""}`}
      >
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
              ? "Live clock for signed-in users on this profile."
              : "Footer shows branding only."}
          </span>
        </span>
      </label>

      <StatusClockPreview
        format={settings.format}
        visible={settings.visible}
        poweredByText={poweredByText}
      />

      <div className={settings.visible ? undefined : "clock-format-picker-wrap is-dimmed"}>
        <FormatPicker
          value={settings.format}
          disabled={disabled || !settings.visible}
          onChange={(format) => patch({ format })}
        />
      </div>
    </div>
  );
}

"use client";

import {
  FLASH_ERROR_SECOND_OPTIONS,
  FLASH_OK_SECOND_OPTIONS,
  normalizeFlashDisplaySettings,
  type FlashDisplaySettings,
} from "@/lib/flash-display";

type Props = {
  value: FlashDisplaySettings;
  disabled?: boolean;
  onChange: (next: FlashDisplaySettings) => void;
};

export function FlashDisplaySettingsPanel({ value, disabled, onChange }: Props) {
  const settings = normalizeFlashDisplaySettings(value);

  function patch(partial: Partial<FlashDisplaySettings>) {
    onChange(normalizeFlashDisplaySettings({ ...settings, ...partial }));
  }

  return (
    <div>
      <h3 className="panel-title">On-screen messages</h3>
      <p className="section-note">
        How long error and success banners stay visible in the top-right corner. Staff can always
        dismiss earlier with the Close (✕) control.
      </p>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="field">
          <span className="label">Error / warning display time</span>
          <select
            value={settings.errorSeconds}
            disabled={disabled}
            onChange={(e) => patch({ errorSeconds: Number(e.target.value) })}
          >
            {!FLASH_ERROR_SECOND_OPTIONS.includes(
              settings.errorSeconds as (typeof FLASH_ERROR_SECOND_OPTIONS)[number],
            ) ? (
              <option value={settings.errorSeconds}>{settings.errorSeconds} seconds</option>
            ) : null}
            {FLASH_ERROR_SECOND_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s} seconds
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Success message display time</span>
          <select
            value={settings.okSeconds}
            disabled={disabled}
            onChange={(e) => patch({ okSeconds: Number(e.target.value) })}
          >
            {!FLASH_OK_SECOND_OPTIONS.includes(
              settings.okSeconds as (typeof FLASH_OK_SECOND_OPTIONS)[number],
            ) ? (
              <option value={settings.okSeconds}>{settings.okSeconds} seconds</option>
            ) : null}
            {FLASH_OK_SECOND_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s} seconds
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="section-note" style={{ marginTop: 10 }}>
        Default: errors 60s · success 8s. Save the Business Profile to apply for all staff on this
        branch.
      </p>
    </div>
  );
}

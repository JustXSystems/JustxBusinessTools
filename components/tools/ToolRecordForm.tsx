"use client";

import type { TrackerConfig, TrackerField } from "@/config/tools.config";
import { validateTrackerData, ValidationError } from "@jbt/shared";
import { todayISO } from "@/lib/format";

type Props = {
  config: TrackerConfig;
  initial?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  saving?: boolean;
};

function defaultValue(field: TrackerField, initial?: Record<string, unknown>): string | number {
  const existing = initial?.[field.key];
  if (existing != null && existing !== "") {
    return field.type === "number" ? Number(existing) : String(existing);
  }
  if (field.type === "date") return todayISO();
  if (field.type === "number") return 0;
  if (field.type === "select" && field.options?.length) return field.options[0];
  return "";
}

export function ToolRecordForm({ config, initial, onSubmit, onCancel, saving }: Props) {
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const missing: string[] = [];
    const data: Record<string, unknown> = {};

    for (const field of config.fields) {
      const el = form.elements.namedItem(field.key) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
      const raw = el?.value ?? "";
      if (field.required && !String(raw).trim()) {
        missing.push(field.label);
      }
      data[field.key] = field.type === "number" ? Number(raw) || 0 : raw;
    }

    if (missing.length) {
      alert(`Please fill in: ${missing.join(", ")}`);
      return;
    }

    try {
      const validated = validateTrackerData(
        config.fields.map((f) => ({
          key: f.key,
          type: f.type,
          required: f.required,
          options: f.options,
        })),
        data,
      );
      onSubmit(validated);
    } catch (err) {
      if (err instanceof ValidationError) {
        alert(err.details.join("\n"));
      } else {
        alert(err instanceof Error ? err.message : "Validation failed");
      }
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {config.fields.map((field) => {
        const value = defaultValue(field, initial);
        if (field.type === "select") {
          return (
            <label key={field.key} className="field">
              <span className="label">{field.label}</span>
              <select name={field.key} defaultValue={String(value)} required={field.required}>
                {field.options?.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </label>
          );
        }
        if (field.type === "textarea") {
          return (
            <label key={field.key} className="field">
              <span className="label">{field.label}</span>
              <textarea
                name={field.key}
                rows={3}
                defaultValue={String(value)}
                placeholder={field.placeholder ?? ""}
                required={field.required}
              />
            </label>
          );
        }
        return (
          <label key={field.key} className="field">
            <span className="label">{field.label}</span>
            <input
              name={field.key}
              type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
              defaultValue={String(value)}
              placeholder={field.placeholder ?? ""}
              required={field.required}
            />
          </label>
        );
      })}
      <div className="modal-btns">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

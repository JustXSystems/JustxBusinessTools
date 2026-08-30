"use client";

import { useEffect, useMemo, useState } from "react";
import type { TrackerConfig, TrackerField } from "@/config/tools.config";
import { applyComputedFields, validateTrackerData, ValidationError } from "@jbt/shared";
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
    return field.type === "number" || field.type === "computed"
      ? Number(existing)
      : String(existing);
  }
  if (field.type === "date") return todayISO();
  if (field.type === "number" || field.type === "computed") return 0;
  if (field.type === "select" && field.options?.length) return field.options[0];
  return "";
}

export function ToolRecordForm({ config, initial, onSubmit, onCancel, saving }: Props) {
  const inputFields = useMemo(
    () => config.fields.filter((f) => f.type !== "computed"),
    [config.fields],
  );
  const computedFields = useMemo(
    () => config.fields.filter((f) => f.type === "computed"),
    [config.fields],
  );

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of config.fields) {
      if (f.type === "computed") continue;
      init[f.key] = String(defaultValue(f, initial));
    }
    return init;
  });

  useEffect(() => {
    const init: Record<string, string> = {};
    for (const f of config.fields) {
      if (f.type === "computed") continue;
      init[f.key] = String(defaultValue(f, initial));
    }
    setValues(init);
  }, [config, initial]);

  const computedPreview = useMemo(() => {
    const data: Record<string, unknown> = {};
    for (const f of inputFields) {
      const raw = values[f.key] ?? "";
      data[f.key] = f.type === "number" ? Number(raw) || 0 : raw;
    }
    try {
      return applyComputedFields(
        config.fields.map((f) => ({
          key: f.key,
          type: f.type,
          required: f.required,
          options: f.options,
          formula: f.formula,
        })),
        data,
      );
    } catch {
      return data;
    }
  }, [config.fields, inputFields, values]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const missing: string[] = [];
    const data: Record<string, unknown> = {};

    for (const field of inputFields) {
      const raw = values[field.key] ?? "";
      if (field.required && !String(raw).trim()) missing.push(field.label);
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
          formula: f.formula,
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
      {inputFields.map((field) => {
        const value = values[field.key] ?? "";
        if (field.type === "select") {
          return (
            <label key={field.key} className="field">
              <span className="label">{field.label}</span>
              <select
                name={field.key}
                value={value}
                required={field.required}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
              >
                {field.options?.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
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
                value={value}
                placeholder={field.placeholder ?? ""}
                required={field.required}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
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
              value={value}
              placeholder={field.placeholder ?? ""}
              required={field.required}
              onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
            />
          </label>
        );
      })}

      {computedFields.map((field) => (
        <label key={field.key} className="field">
          <span className="label">
            {field.label}
            <span className="muted"> · computed</span>
          </span>
          <input
            type="text"
            readOnly
            value={
              computedPreview[field.key] == null ? "—" : String(computedPreview[field.key])
            }
          />
          {field.formula ? <span className="section-note">{field.formula}</span> : null}
        </label>
      ))}

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

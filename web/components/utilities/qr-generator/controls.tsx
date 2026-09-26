"use client";

import { useState, type ReactNode } from "react";
import type { QrFieldDef } from "@/lib/qr-generator/payloads";
import { normalizeHex } from "@/lib/qr-generator/render";

export function ColorField({
  label,
  value,
  onChange,
  action,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  action?: ReactNode;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  if (syncedValue !== value) {
    setSyncedValue(value);
    setDraft(value);
  }
  return (
    <div className="field qrg-color-field">
      <span className="label">
        {label}
        {action}
      </span>
      <div className="qrg-color-row">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={normalizeHex(value) ?? "#000000"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="text"
          aria-label={`${label} hex`}
          value={draft}
          maxLength={7}
          spellCheck={false}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            const hex = normalizeHex(e.target.value);
            if (hex) onChange(hex);
          }}
          onBlur={() => setDraft(value)}
        />
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="qrg-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={value === o.value ? "is-active" : ""}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FieldInput({
  def,
  value,
  onChange,
  idPrefix = "qrg",
}: {
  def: QrFieldDef;
  value: string;
  onChange: (v: string) => void;
  idPrefix?: string;
}) {
  const id = `${idPrefix}-${def.key}`;
  const span = def.half ? "" : " qrg-span-2";

  if (def.type === "checkbox") {
    return (
      <label className={`qrg-check${span}`}>
        <input type="checkbox" checked={value === "1"} onChange={(e) => onChange(e.target.checked ? "1" : "")} />
        <span>{def.label}</span>
      </label>
    );
  }

  const common = {
    id,
    value,
    placeholder: def.placeholder,
    maxLength: def.maxLength,
    required: def.required,
    autoComplete: "off",
  };

  let control: ReactNode;
  if (def.type === "textarea") {
    control = <textarea {...common} rows={3} onChange={(e) => onChange(e.target.value)} />;
  } else if (def.type === "select") {
    control = (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {def.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        {...common}
        type={def.type === "number" ? "text" : def.type}
        inputMode={def.type === "number" ? "decimal" : undefined}
        spellCheck={def.type === "text" ? undefined : false}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <label className={`field${span}`} htmlFor={id}>
      <span className="label">
        {def.label}
        {def.required ? <span className="qrg-req"> *</span> : null}
      </span>
      {control}
      {def.hint ? <span className="qrg-hint">{def.hint}</span> : null}
    </label>
  );
}

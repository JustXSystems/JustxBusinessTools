"use client";

import { useState, type ReactNode } from "react";
import { Button, Card, Checkbox, Input, Switch } from "@/components/bos";
import type { ImsSettings } from "@/lib/ims/api";
import { parseNumberList } from "@/lib/ims/settings";

export type SetDraft = <K extends keyof ImsSettings>(key: K, value: ImsSettings[K]) => void;
export type SettingsErrors = Partial<Record<string, string>>;
export type TabProps = { draft: ImsSettings; set: SetDraft; errors: SettingsErrors; readOnly: boolean };

export function SectionCard({ title, desc, actions, children }: { title: ReactNode; desc?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card interactive={false} className="ims-set-card">
      <div className="ims-set-head">
        <div>
          <h3 className="ims-set-title">{title}</h3>
          {desc ? <p className="ims-set-desc">{desc}</p> : null}
        </div>
        {actions ? <div className="ims-row">{actions}</div> : null}
      </div>
      {children}
    </Card>
  );
}

export function ToggleRow({ label, desc, checked, onChange, disabled }: { label: ReactNode; desc?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="ims-toggle-row">
      <div>
        <div className="ims-toggle-row-label">{label}</div>
        {desc ? <div className="ims-toggle-row-desc">{desc}</div> : null}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} aria-label={typeof label === "string" ? label : undefined} />
    </div>
  );
}

/** Editable, reorderable list of short strings (case-insensitive unique). */
export function ChipList({ values, onChange, placeholder, readOnly, label, max = 200 }: { values: string[]; onChange: (next: string[]) => void; placeholder?: string; readOnly: boolean; label: string; max?: number }) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const duplicate = trimmed !== "" && values.some((v) => v.toLowerCase() === trimmed.toLowerCase());
  const add = () => {
    if (!trimmed || duplicate || values.length >= max) return;
    onChange([...values, trimmed.slice(0, 80)]);
    setText("");
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...values];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };

  return (
    <div>
      {values.length ? (
        <ul className="ims-chips" aria-label={label} style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {values.map((v, i) => (
            <li key={v} className="ims-chip">
              <span>{v}</span>
              {readOnly ? null : (
                <>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${v} earlier`}>
                    ‹
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === values.length - 1} aria-label={`Move ${v} later`}>
                    ›
                  </button>
                  <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} aria-label={`Remove ${v}`}>
                    ×
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ims-faint" style={{ margin: 0 }}>
          Nothing added yet.
        </p>
      )}
      {readOnly ? null : (
        <div className="ims-chip-add">
          <Input
            size="sm"
            value={text}
            placeholder={placeholder}
            aria-label={`Add to ${label}`}
            aria-invalid={duplicate || undefined}
            maxLength={80}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button size="sm" icon="plus" onClick={add} disabled={!trimmed || duplicate}>
            Add
          </Button>
        </div>
      )}
      {duplicate ? <div className="bos-field-error">“{trimmed}” is already in the list.</div> : null}
    </div>
  );
}

/** Comma-separated number list (e.g. “0, 7, 15, 30”). Keeps the raw text while typing; commits parsed numbers. */
export function NumberListInput({ id, values, onChange, readOnly, invalid, describedBy, placeholder }: { id?: string; values: ReadonlyArray<number>; onChange: (next: number[]) => void; readOnly?: boolean; invalid?: boolean; describedBy?: string; placeholder?: string }) {
  const [text, setText] = useState(values.join(", "));
  const [prev, setPrev] = useState(values);
  // Re-sync when the list changes from outside (save / reset) rather than from typing here.
  if (prev !== values) {
    setPrev(values);
    if (JSON.stringify(parseNumberList(text)) !== JSON.stringify(values)) setText(values.join(", "));
  }
  return (
    <Input
      id={id}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      value={text}
      readOnly={readOnly}
      placeholder={placeholder}
      inputMode="decimal"
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseNumberList(e.target.value));
      }}
    />
  );
}

/** Check-list of payment methods; the last remaining method cannot be switched off. */
export function MethodPicker({ options, values, onChange, readOnly, label }: { options: ReadonlyArray<{ value: string; label: string }>; values: ReadonlyArray<string>; onChange: (next: string[]) => void; readOnly?: boolean; label: string }) {
  return (
    <div className="ims-chips" role="group" aria-label={label}>
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <label key={o.value} className="ims-chip" style={{ gap: 8, paddingRight: 10, cursor: readOnly ? "default" : "pointer" }}>
            <Checkbox
              checked={on}
              disabled={readOnly || (on && values.length <= 1)}
              onChange={(v) => onChange(options.map((x) => x.value).filter((m) => (m === o.value ? v : values.includes(m))))}
              aria-label={`${label}: ${o.label}`}
            />
            <span>{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}
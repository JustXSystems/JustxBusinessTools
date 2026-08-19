"use client";

import { useEffect, useState } from "react";
import type { TrackerField } from "@/config/tools.config";
import { TRACKER_CONFIGS } from "@/config/tools.config";

type TrackerDefinition = {
  type: "tracker";
  key?: string;
  title?: string;
  subtitle?: string;
  addLabel?: string;
  fields: TrackerField[];
  titleField?: string;
  subtitleFields?: string[];
  statusField?: string | null;
};

const FIELD_TYPES: TrackerField["type"][] = ["text", "number", "date", "select", "textarea"];

function emptyField(): TrackerField {
  return { key: "", label: "", type: "text", required: false };
}

function parseDefinition(jsonText: string, toolId: string): TrackerDefinition {
  try {
    const parsed = JSON.parse(jsonText) as Partial<TrackerDefinition>;
    const base = TRACKER_CONFIGS[toolId];
    return {
      type: "tracker",
      key: toolId,
      title: parsed.title ?? base?.title,
      subtitle: parsed.subtitle ?? base?.subtitle,
      addLabel: parsed.addLabel ?? base?.addLabel,
      fields: Array.isArray(parsed.fields) ? parsed.fields : base?.fields ?? [],
      titleField: parsed.titleField ?? base?.titleField,
      subtitleFields: parsed.subtitleFields ?? base?.subtitleFields ?? [],
      statusField: parsed.statusField ?? base?.statusField ?? null,
    };
  } catch {
    const base = TRACKER_CONFIGS[toolId];
    return {
      type: "tracker",
      key: toolId,
      fields: base?.fields ?? [],
      titleField: base?.titleField,
      subtitleFields: base?.subtitleFields ?? [],
      statusField: base?.statusField ?? null,
    };
  }
}

type Props = {
  toolId: string;
  jsonText: string;
  onChange: (json: string) => void;
};

export function TrackerSchemaDesigner({ toolId, jsonText, onChange }: Props) {
  const [def, setDef] = useState<TrackerDefinition>(() => parseDefinition(jsonText, toolId));
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<TrackerField>(emptyField());

  useEffect(() => {
    setDef(parseDefinition(jsonText, toolId));
  }, [toolId, jsonText]);

  function emit(next: TrackerDefinition) {
    setDef(next);
    onChange(JSON.stringify(next, null, 2));
  }

  function saveField() {
    if (!draft.key.trim() || !draft.label.trim()) return;
    const fields = [...def.fields];
    if (editIdx != null) {
      fields[editIdx] = { ...draft, key: draft.key.trim(), label: draft.label.trim() };
    } else {
      fields.push({ ...draft, key: draft.key.trim(), label: draft.label.trim() });
    }
    emit({ ...def, fields });
    setEditIdx(null);
    setDraft(emptyField());
  }

  function removeField(idx: number) {
    const fields = def.fields.filter((_, i) => i !== idx);
    emit({ ...def, fields });
  }

  function editField(idx: number) {
    setEditIdx(idx);
    setDraft({ ...def.fields[idx] });
  }

  return (
    <div className="schema-designer">
      <p className="muted">Visual editor for tracker fields. Changes sync to JSON below.</p>

      <ul className="schema-field-list">
        {def.fields.map((field, idx) => (
          <li key={`${field.key}-${idx}`} className="schema-field-row">
            <div>
              <strong>{field.label}</strong>
              <span className="muted">
                {field.key} · {field.type}
                {field.required ? " · required" : ""}
              </span>
            </div>
            <div className="admin-form-row">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => editField(idx)}>
                Edit
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeField(idx)}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="panel schema-field-editor">
        <h3>{editIdx != null ? "Edit field" : "Add field"}</h3>
        <div className="admin-form-grid">
          <label className="field">
            <span>Key</span>
            <input
              value={draft.key}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
              placeholder="e.g. party"
            />
          </label>
          <label className="field">
            <span>Label</span>
            <input
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="Display label"
            />
          </label>
          <label className="field">
            <span>Type</span>
            <select
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value as TrackerField["type"] })}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Required</span>
            <select
              value={draft.required ? "yes" : "no"}
              onChange={(e) => setDraft({ ...draft, required: e.target.value === "yes" })}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          {draft.type === "select" ? (
            <label className="field">
              <span>Options (comma-separated)</span>
              <input
                value={(draft.options ?? []).join(", ")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </label>
          ) : null}
        </div>
        <div className="admin-form-row">
          <button type="button" className="btn btn-secondary btn-sm" onClick={saveField}>
            {editIdx != null ? "Update field" : "Add field"}
          </button>
          {editIdx != null ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setEditIdx(null);
                setDraft(emptyField());
              }}
            >
              Cancel edit
            </button>
          ) : null}
        </div>
      </div>

      <label className="field">
        <span>Title field key</span>
        <input
          value={def.titleField ?? ""}
          onChange={(e) => emit({ ...def, titleField: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Status field key</span>
        <input
          value={def.statusField ?? ""}
          onChange={(e) => emit({ ...def, statusField: e.target.value || null })}
        />
      </label>
    </div>
  );
}

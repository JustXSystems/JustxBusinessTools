"use client";

import { useEffect, useMemo, useState } from "react";
import type { TrackerField } from "@/config/tools.config";
import { TRACKER_CONFIGS } from "@/config/tools.config";
import { evaluateFormula, validateFormula } from "@jbt/shared";

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

const FIELD_TYPES: TrackerField["type"][] = [
  "text",
  "number",
  "date",
  "select",
  "textarea",
  "computed",
];

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
  const [testVars, setTestVars] = useState<Record<string, string>>({});
  const [testMsg, setTestMsg] = useState("");

  useEffect(() => {
    const next = parseDefinition(jsonText, toolId);
    setDef(next);
    try {
      const raw = JSON.parse(jsonText) as { fields?: unknown };
      if (!Array.isArray(raw.fields) && next.fields.length > 0) {
        onChange(JSON.stringify(next, null, 2));
      }
    } catch {
      /* keep local parse */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolId, jsonText]);

  function emit(next: TrackerDefinition) {
    setDef(next);
    onChange(JSON.stringify(next, null, 2));
  }

  function saveField() {
    if (!draft.key.trim() || !draft.label.trim()) return;
    if (draft.type === "computed") {
      const allowed = def.fields
        .map((f) => f.key)
        .filter((k) => k && k !== draft.key.trim());
      const err = validateFormula(String(draft.formula ?? ""), allowed);
      if (err) {
        setTestMsg(err);
        return;
      }
    }
    const cleaned: TrackerField = {
      ...draft,
      key: draft.key.trim(),
      label: draft.label.trim(),
      required: draft.type === "computed" ? false : draft.required,
      formula: draft.type === "computed" ? String(draft.formula ?? "").trim() : undefined,
    };
    const fields = [...def.fields];
    if (editIdx != null) fields[editIdx] = cleaned;
    else fields.push(cleaned);
    emit({ ...def, fields });
    setEditIdx(null);
    setDraft(emptyField());
    setTestMsg("");
  }

  function removeField(idx: number) {
    emit({ ...def, fields: def.fields.filter((_, i) => i !== idx) });
  }

  function editField(idx: number) {
    setEditIdx(idx);
    setDraft({ ...def.fields[idx] });
    setTestMsg("");
  }

  const numberKeys = useMemo(
    () =>
      def.fields
        .filter((f) => f.type === "number" || f.type === "computed")
        .map((f) => f.key)
        .filter(Boolean),
    [def.fields],
  );

  function runFormulaTest() {
    const expr = String(draft.formula ?? "").trim();
    if (!expr) {
      setTestMsg("Enter a formula first.");
      return;
    }
    const vars: Record<string, number> = {};
    for (const k of numberKeys) {
      if (k === draft.key.trim()) continue;
      const n = Number(testVars[k] ?? "0");
      vars[k] = Number.isFinite(n) ? n : 0;
    }
    const result = evaluateFormula(expr, vars);
    setTestMsg(result.ok ? `Result: ${result.value}` : result.error);
  }

  return (
    <div className="schema-designer">
      <p className="muted">
        Visual editor for tracker fields. Use type <strong>computed</strong> with formulas like{" "}
        <code>qty * rate * (1 + gst / 100)</code>. Functions: abs, min, max, round.
      </p>

      <ul className="schema-field-list">
        {def.fields.map((field, idx) => (
          <li key={`${field.key}-${idx}`} className="schema-field-row">
            <div>
              <strong>{field.label}</strong>
              <span className="muted">
                {field.key} · {field.type}
                {field.required ? " · required" : ""}
                {field.type === "computed" && field.formula ? ` · ${field.formula}` : ""}
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
              placeholder="e.g. amount"
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
              onChange={(e) => {
                const type = e.target.value as TrackerField["type"];
                setDraft({
                  ...draft,
                  type,
                  required: type === "computed" ? false : draft.required,
                  formula: type === "computed" ? draft.formula ?? "qty * rate" : undefined,
                });
              }}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          {draft.type !== "computed" ? (
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
          ) : null}
          {draft.type === "select" ? (
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Options (comma-separated)</span>
              <input
                value={(draft.options ?? []).join(", ")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    options: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
          ) : null}
          {draft.type === "computed" ? (
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Formula</span>
              <input
                value={draft.formula ?? ""}
                onChange={(e) => setDraft({ ...draft, formula: e.target.value })}
                placeholder="qty * rate * (1 + gst / 100)"
              />
            </label>
          ) : null}
        </div>

        {draft.type === "computed" ? (
          <div className="admin-stack" style={{ marginTop: 12 }}>
            <h4>Test harness</h4>
            <p className="muted">Sample values for number/computed siblings.</p>
            <div className="admin-form-grid">
              {numberKeys
                .filter((k) => k !== draft.key.trim())
                .map((k) => (
                  <label key={k} className="field">
                    <span>{k}</span>
                    <input
                      type="number"
                      value={testVars[k] ?? ""}
                      onChange={(e) => setTestVars({ ...testVars, [k]: e.target.value })}
                      placeholder="0"
                    />
                  </label>
                ))}
            </div>
            <div className="admin-form-row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={runFormulaTest}>
                Test formula
              </button>
              {testMsg ? <span className="muted">{testMsg}</span> : null}
            </div>
          </div>
        ) : null}

        <div className="admin-form-row" style={{ marginTop: 12 }}>
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
                setTestMsg("");
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

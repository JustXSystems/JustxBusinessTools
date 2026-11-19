"use client";

import { useEffect, useMemo, useState } from "react";
import type { TrackerField } from "@/config/tools.config";
import { TRACKER_CONFIGS } from "@/config/tools.config";
import { BlockLabel, Button, Card, FormGrid } from "@/components/bos";
import { AdminEmpty } from "@/components/admin/ui";
import { SelectField, TextField } from "@/components/admin/ui/AdminFields";
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

  const otherNumberKeys = numberKeys.filter((k) => k !== draft.key.trim());

  return (
    <div className="admin-cc-form">
      <p className="admin-cc-note-text">
        Visual editor for tracker fields. Use type <strong>computed</strong> with formulas like{" "}
        <code className="admin-cc-code">qty * rate * (1 + gst / 100)</code>. Functions: abs, min, max, round.
      </p>

      {def.fields.length === 0 ? (
        <AdminEmpty title="No fields yet" icon="layers">
          Add a field below to start building this tracker form.
        </AdminEmpty>
      ) : (
        <ul className="admin-cc-stack admin-cc-scroll-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {def.fields.map((field, idx) => (
            <li key={`${field.key}-${idx}`} className="admin-cc-row" style={{ cursor: "default" }}>
              <div className="admin-cc-row-main">
                <div className="admin-cc-cell-title">{field.label}</div>
                <div className="admin-cc-cell-sub">
                  {field.key} · {field.type}
                  {field.required ? " · required" : ""}
                  {field.type === "computed" && field.formula ? ` · ${field.formula}` : ""}
                </div>
              </div>
              <div className="admin-cc-actions">
                <Button variant="ghost" size="sm" onClick={() => editField(idx)}>
                  Edit
                </Button>
                <Button variant="destructive" size="sm" onClick={() => removeField(idx)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Card flat className="admin-cc-form">
        <BlockLabel>{editIdx != null ? "Edit field" : "Add field"}</BlockLabel>
        <FormGrid>
          <TextField
            label="Key"
            value={draft.key}
            onChange={(e) => setDraft({ ...draft, key: e.target.value })}
            placeholder="e.g. amount"
          />
          <TextField
            label="Label"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="Display label"
          />
          <SelectField
            label="Type"
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
          </SelectField>
          {draft.type !== "computed" ? (
            <SelectField
              label="Required"
              value={draft.required ? "yes" : "no"}
              onChange={(e) => setDraft({ ...draft, required: e.target.value === "yes" })}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </SelectField>
          ) : null}
          {draft.type === "select" ? (
            <TextField
              full
              label="Options (comma-separated)"
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
          ) : null}
          {draft.type === "computed" ? (
            <TextField
              full
              label="Formula"
              value={draft.formula ?? ""}
              onChange={(e) => setDraft({ ...draft, formula: e.target.value })}
              placeholder="qty * rate * (1 + gst / 100)"
            />
          ) : null}
        </FormGrid>

        {draft.type === "computed" ? (
          <div className="admin-cc-form">
            <BlockLabel>Test harness</BlockLabel>
            <p className="admin-cc-note-text">Sample values for number/computed siblings.</p>
            {otherNumberKeys.length > 0 ? (
              <FormGrid>
                {otherNumberKeys.map((k) => (
                  <TextField
                    key={k}
                    label={k}
                    type="number"
                    value={testVars[k] ?? ""}
                    onChange={(e) => setTestVars({ ...testVars, [k]: e.target.value })}
                    placeholder="0"
                  />
                ))}
              </FormGrid>
            ) : null}
            <div className="admin-cc-actions" style={{ justifyContent: "flex-start" }}>
              <Button variant="secondary" size="sm" onClick={runFormulaTest}>
                Test formula
              </Button>
              {testMsg ? (
                <span className="admin-cc-note-text" role="status">
                  {testMsg}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="admin-cc-actions" style={{ justifyContent: "flex-start" }}>
          <Button variant="secondary" size="sm" onClick={saveField}>
            {editIdx != null ? "Update field" : "Add field"}
          </Button>
          {editIdx != null ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditIdx(null);
                setDraft(emptyField());
                setTestMsg("");
              }}
            >
              Cancel edit
            </Button>
          ) : null}
        </div>
      </Card>

      <FormGrid>
        <TextField
          label="Title field key"
          value={def.titleField ?? ""}
          onChange={(e) => emit({ ...def, titleField: e.target.value })}
        />
        <TextField
          label="Status field key"
          value={def.statusField ?? ""}
          onChange={(e) => emit({ ...def, statusField: e.target.value || null })}
        />
      </FormGrid>
    </div>
  );
}

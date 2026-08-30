import type { TrackerFieldMeta } from "../validation/fields";
import { evaluateFormula, validateFormula } from "./evaluate";

export { evaluateFormula, validateFormula, formulaRefs, type FormulaResult } from "./evaluate";

function toNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

/** Apply computed fields in schema order. Computed fields may reference earlier computed fields. */
export function applyComputedFields(
  fields: TrackerFieldMeta[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  const vars: Record<string, number> = {};

  for (const f of fields) {
    if (f.type === "computed") continue;
    const n = toNumber(out[f.key]);
    if (Number.isFinite(n)) vars[f.key] = n;
  }

  for (const f of fields) {
    if (f.type !== "computed") continue;
    const expr = String(f.formula ?? "").trim();
    if (!expr) {
      out[f.key] = null;
      continue;
    }
    const result = evaluateFormula(expr, vars);
    if (!result.ok) {
      throw new Error(`${f.key}: ${result.error}`);
    }
    out[f.key] = result.value;
    vars[f.key] = result.value;
  }
  return out;
}

/** Validate all computed formulas against sibling field keys. */
export function validateComputedFormulas(fields: TrackerFieldMeta[]): string[] {
  const errors: string[] = [];
  const keys = fields.map((f) => f.key).filter(Boolean);
  for (const f of fields) {
    if (f.type !== "computed") continue;
    const expr = String(f.formula ?? "").trim();
    if (!expr) {
      errors.push(`${f.key}: computed fields need a formula`);
      continue;
    }
    const allowed = keys.filter((k) => k !== f.key);
    const err = validateFormula(expr, allowed);
    if (err) errors.push(`${f.key}: ${err}`);
  }
  return errors;
}

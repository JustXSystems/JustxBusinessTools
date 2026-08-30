import { z } from "zod";
import { applyComputedFields } from "../formula/index";
import type { TrackerFieldMeta } from "./fields";

export class ValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly details: string[];

  constructor(details: string[]) {
    super(details.join("; "));
    this.details = details;
  }
}

function fieldSchema(field: TrackerFieldMeta): z.ZodTypeAny {
  let base: z.ZodTypeAny;

  switch (field.type) {
    case "computed":
      // Computed values are filled server-side; accept optional number if client sends them.
      return z.union([z.number(), z.string(), z.null()]).optional();
    case "number":
      base = z.union([
        z.number(),
        z.string().transform((v) => (v === "" ? undefined : Number(v))),
      ]);
      break;
    case "date":
      base = z.string();
      break;
    case "select":
      if (field.options?.length) {
        base = z.enum(field.options as [string, ...string[]]);
      } else {
        base = z.string();
      }
      break;
    case "textarea":
      base = z.string();
      break;
    default:
      base = z.string();
  }

  if (!field.required) {
    base = base.optional();
  } else if (field.type === "text" || field.type === "textarea" || field.type === "select") {
    base = z.string().min(1, `${field.key} is required`);
  } else if (field.type === "number") {
    base = z.union([z.number(), z.string().transform(Number)]).refine(
      (v) => v !== undefined && !Number.isNaN(v as number),
      { message: `${field.key} is required` },
    );
  }

  return base;
}

export function buildTrackerDataSchema(fields: TrackerFieldMeta[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    if (!field.key) continue;
    shape[field.key] = fieldSchema(field);
  }
  return z.object(shape).passthrough();
}

export function validateTrackerData(
  fields: TrackerFieldMeta[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (!fields.length) {
    throw new ValidationError(["Unknown tracker tool or missing field schema"]);
  }

  const inputKeys = new Set(fields.filter((f) => f.type !== "computed").map((f) => f.key));
  const knownKeys = new Set(fields.map((f) => f.key));
  const extras = Object.keys(data).filter((k) => !knownKeys.has(k));
  if (extras.length) {
    throw new ValidationError(extras.map((k) => `Unknown field: ${k}`));
  }

  const inputData: Record<string, unknown> = {};
  for (const k of Object.keys(data)) {
    if (inputKeys.has(k)) inputData[k] = data[k];
  }

  const inputFields = fields.filter((f) => f.type !== "computed");
  const schema = buildTrackerDataSchema(inputFields);
  const result = schema.safeParse(inputData);
  if (!result.success) {
    const details = result.error.issues.map((i) => i.message);
    throw new ValidationError(details);
  }

  try {
    return applyComputedFields(fields, result.data as Record<string, unknown>);
  } catch (err) {
    throw new ValidationError([err instanceof Error ? err.message : "Formula evaluation failed"]);
  }
}

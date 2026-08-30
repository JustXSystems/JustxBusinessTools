import { z } from "zod";
import { ValidationError } from "./tracker";

const documentItemSchema = z.object({
  id: z.union([z.string(), z.number().transform(String)]).optional(),
  name: z.string().min(1, "Item name is required"),
  hsn: z.string().optional(),
  qty: z.union([z.number(), z.string().transform(Number)]),
  unit: z.string().optional(),
  rate: z.union([z.number(), z.string().transform(Number)]),
});

const partySchema = z.object({
  name: z.string().min(1, "Party name is required"),
  address: z.string().optional(),
  phone: z.string().optional(),
  gstin: z.string().optional(),
  state: z.string().optional(),
});

export const documentStateSchema = z.object({
  id: z.string().optional(),
  docNo: z.string().optional(),
  docDate: z.string().optional(),
  extraDate: z.string().optional(),
  party: partySchema,
  items: z.array(documentItemSchema).min(1, "At least one item is required"),
  igstPct: z.union([z.number(), z.string().transform(Number)]).optional(),
  cgstPct: z.union([z.number(), z.string().transform(Number)]).optional(),
  sgstPct: z.union([z.number(), z.string().transform(Number)]).optional(),
  cgstSgstEnabled: z.boolean().optional(),
  notes: z.string().optional(),
  status: z.string().optional(),
});

export function validateDocumentState(data: Record<string, unknown>): Record<string, unknown> {
  const result = documentStateSchema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => i.message);
    throw new ValidationError(details);
  }

  const parsed = result.data;
  const invalidItem = parsed.items.find((it) => !it.name?.trim() || Number(it.rate) <= 0);
  if (invalidItem) {
    throw new ValidationError(["Each item needs a name and rate greater than zero"]);
  }

  return parsed as Record<string, unknown>;
}

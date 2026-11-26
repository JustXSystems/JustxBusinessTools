import { conflict } from "./host.js";

export const DOC_REQUIRED_FIELD_SPEC = {
  bom: {
    label: "BOM",
    fields: [
      "quotationRef",
      "projectRef",
      "preparedBy",
      "validUntil",
      "paymentTerms",
      "deliveryTerms",
      "location",
    ] as const,
  },
  dc: {
    label: "Delivery Challan",
    fields: ["transporter", "vehicleNo", "shipTo"] as const,
  },
  returns: {
    label: "Returns",
    fields: ["reason", "refDocNo", "partyId", "notes"] as const,
  },
  po: {
    label: "Purchase Order",
    fields: ["expectedDate", "deliveryAddress", "paymentTermsDays", "terms"] as const,
  },
  invoice: {
    label: "Invoice",
    fields: ["customerPoNo", "placeOfSupply", "shipToAddress"] as const,
  },
} as const;

export type DocRequiredType = keyof typeof DOC_REQUIRED_FIELD_SPEC;
export type DocRequiredFieldMap = {
  [K in DocRequiredType]: (typeof DOC_REQUIRED_FIELD_SPEC)[K]["fields"][number][];
};

export const DOC_REQUIRED_FIELD_LABELS: Record<string, string> = {
  quotationRef: "Quotation reference",
  projectRef: "Project reference",
  preparedBy: "Prepared by",
  validUntil: "Valid until",
  paymentTerms: "Payment terms",
  deliveryTerms: "Delivery terms",
  location: "Location",
  transporter: "Transporter",
  vehicleNo: "Vehicle number",
  shipTo: "Ship-to address",
  reason: "Reason",
  refDocNo: "Reference doc number",
  partyId: "Linked party",
  notes: "Notes",
  expectedDate: "Expected delivery date",
  deliveryAddress: "Delivery address",
  paymentTermsDays: "Payment terms (days)",
  terms: "Terms & conditions",
  customerPoNo: "Customer PO number",
  placeOfSupply: "Place of supply",
  shipToAddress: "Ship-to address",
};

const NUMERIC_FIELDS = new Set<string>(["paymentTermsDays"]);

export function emptyDocRequiredFields(): DocRequiredFieldMap {
  return { bom: [], dc: [], returns: [], po: [], invoice: [] };
}

/**
 * Parse tenant doc_required_fields_json; when unset (null/undefined), seeds
 * `bom: ["quotationRef"]` if the legacy `bom_require_quotation_ref` flag is on.
 */
export function normalizeDocRequiredFieldsSetting(
  v: unknown,
  legacyBomRequireQuotationRef = false,
): DocRequiredFieldMap {
  const out = emptyDocRequiredFields();
  let obj: Record<string, unknown> | null = null;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    obj = v as Record<string, unknown>;
  } else if (typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      obj = null;
    }
  }

  if (!obj) {
    if (legacyBomRequireQuotationRef) out.bom = ["quotationRef"];
    return out;
  }

  for (const docType of Object.keys(DOC_REQUIRED_FIELD_SPEC) as DocRequiredType[]) {
    const allowed = DOC_REQUIRED_FIELD_SPEC[docType].fields as readonly string[];
    const allowedSet = new Set(allowed);
    const raw = obj[docType];
    const picked = new Set<string>();
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const key = String(item ?? "").trim();
        if (allowedSet.has(key)) picked.add(key);
      }
    }
    (out as Record<string, string[]>)[docType] = allowed.filter((f) => picked.has(f));
  }
  return out;
}

/**
 * Enforce configured required fields at a document's final step.
 * Throws 409 Conflict listing every missing field's human label.
 */
export function assertDocRequiredFields(
  docType: DocRequiredType,
  config: DocRequiredFieldMap | undefined,
  values: Record<string, unknown>,
  actionLabel: string,
): void {
  const required = config?.[docType] ?? [];
  if (!required.length) return;
  const missing: string[] = [];
  for (const field of required) {
    const val = values[field];
    const ok = NUMERIC_FIELDS.has(field)
      ? val !== null && val !== undefined && val !== "" && Number.isFinite(Number(val))
      : Boolean(String(val ?? "").trim());
    if (!ok) missing.push(DOC_REQUIRED_FIELD_LABELS[field] ?? field);
  }
  if (missing.length) {
    throw conflict(
      `Required before ${actionLabel}: ${missing.join(", ")} (Settings → Documents).`,
    );
  }
}

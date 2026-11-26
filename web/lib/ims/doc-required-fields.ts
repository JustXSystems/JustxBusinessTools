export const DOC_REQUIRED_FIELD_SPEC = {
  bom: {
    label: "BOM",
    stage: "confirm",
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
    stage: "approve",
    fields: ["transporter", "vehicleNo", "shipTo"] as const,
  },
  returns: {
    label: "Returns",
    stage: "record",
    fields: ["reason", "refDocNo", "partyId", "notes"] as const,
  },
  po: {
    label: "Purchase Order",
    stage: "submit / send",
    fields: ["expectedDate", "deliveryAddress", "paymentTermsDays", "terms"] as const,
  },
  invoice: {
    label: "Invoice",
    stage: "issue",
    fields: ["customerPoNo", "placeOfSupply", "shipToAddress"] as const,
  },
} as const;

export const DOC_REQUIRED_TYPES = Object.keys(DOC_REQUIRED_FIELD_SPEC) as DocRequiredType[];

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

export function emptyDocRequiredFields(): DocRequiredFieldMap {
  return { bom: [], dc: [], returns: [], po: [], invoice: [] };
}

export function normalizeDocRequiredFields(
  v: Partial<Record<DocRequiredType, readonly string[]>> | null | undefined,
  legacyBomRequireQuotationRef = false,
): DocRequiredFieldMap {
  const out = emptyDocRequiredFields();
  if (!v) {
    if (legacyBomRequireQuotationRef) out.bom = ["quotationRef"];
    return out;
  }
  for (const docType of DOC_REQUIRED_TYPES) {
    const allowed = DOC_REQUIRED_FIELD_SPEC[docType].fields as readonly string[];
    const picked = new Set((v[docType] ?? []).map((x) => String(x).trim()));
    (out as Record<string, string[]>)[docType] = allowed.filter((f) => picked.has(f));
  }
  return out;
}

export function isDocFieldRequired(
  settings: { docRequiredFields?: DocRequiredFieldMap; bomRequireQuotationRef?: boolean } | null | undefined,
  docType: DocRequiredType,
  field: string,
): boolean {
  const map = normalizeDocRequiredFields(settings?.docRequiredFields, Boolean(settings?.bomRequireQuotationRef));
  return (map[docType] as readonly string[]).includes(field);
}

export function docRequiredFieldsSummary(
  v: Partial<Record<DocRequiredType, readonly string[]>> | null | undefined,
  legacyBomRequireQuotationRef = false,
): string {
  const map = normalizeDocRequiredFields(v, legacyBomRequireQuotationRef);
  const parts: string[] = [];
  for (const docType of DOC_REQUIRED_TYPES) {
    const fields = map[docType];
    if (!fields.length) continue;
    parts.push(`${DOC_REQUIRED_FIELD_SPEC[docType].label}: ${fields.map((f) => DOC_REQUIRED_FIELD_LABELS[f] ?? f).join(", ")}`);
  }
  return parts.length ? parts.join(" · ") : "None";
}

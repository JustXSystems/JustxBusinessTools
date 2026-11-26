/** Quotation V1 statuses BOM quotation-reference suggestions can include (IMS settings). */
export const BOM_QUOTATION_STATUSES = ["submitted", "sent", "approved"] as const;
export type BomQuotationStatus = (typeof BOM_QUOTATION_STATUSES)[number];

export const BOM_QUOTATION_STATUS_LABEL: Record<BomQuotationStatus, string> = {
  submitted: "Submitted",
  sent: "Sent",
  approved: "Approved",
};

export const BOM_QUOTATION_STATUS_DEFAULT: BomQuotationStatus[] = ["approved"];

/** Human label for a quotation status; unknown values are title-cased. */
export function bomQuotationStatusLabel(status: string): string {
  const s = status.trim().toLowerCase() as BomQuotationStatus;
  if (s in BOM_QUOTATION_STATUS_LABEL) return BOM_QUOTATION_STATUS_LABEL[s];
  return s ? s[0]!.toUpperCase() + s.slice(1) : "";
}

/** Canonical order, no duplicates, never empty. */
export function normalizeBomQuotationStatuses(v: readonly string[] | null | undefined): BomQuotationStatus[] {
  const picked = new Set((v ?? []).map((x) => String(x).trim().toLowerCase()));
  const out = BOM_QUOTATION_STATUSES.filter((s) => picked.has(s));
  return out.length ? out : [...BOM_QUOTATION_STATUS_DEFAULT];
}

/** Human summary like "Submitted, Approved". */
export function bomQuotationStatusesSummary(v: readonly string[] | null | undefined): string {
  return normalizeBomQuotationStatuses(v)
    .map((s) => BOM_QUOTATION_STATUS_LABEL[s])
    .join(", ");
}

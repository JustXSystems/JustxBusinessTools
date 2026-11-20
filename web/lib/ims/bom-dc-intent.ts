export type BomDcWorkspaceIntent = { kind: "create" } | { kind: "manage"; dcId: string };

export type BomDcView =
  | { mode: "list" }
  | { mode: "pick-bom" }
  | { mode: "workspace"; bomId: string; workspace: BomDcWorkspaceIntent };

/**
 * Return/reverse must stay blocked when a live draft/issued invoice references the DC.
 * Builder also blocks while the DC is ticked for “Link on invoice” (pre-save selection).
 */
export function isDcReturnBlocked(
  dc: { id: string; invoiceLinked?: boolean },
  opts: { allowInvoiceLink?: boolean; selectedDcIds?: ReadonlyArray<string> },
): boolean {
  if (dc.invoiceLinked) return true;
  if (opts.allowInvoiceLink && (opts.selectedDcIds ?? []).includes(dc.id)) return true;
  return false;
}

/** Deep-link / command-palette intents for Bill of Materials → DC & Returns. */
export function parseBomDcIntent(raw: string | null): BomDcView | null {
  if (!raw) return null;
  if (raw === "new") return { mode: "pick-bom" };
  if (raw.startsWith("new:")) {
    const bomId = raw.slice(4).trim();
    if (bomId) return { mode: "workspace", bomId, workspace: { kind: "create" } };
  }
  if (raw.startsWith("open:")) {
    const dcId = raw.slice(5).trim();
    if (dcId) return { mode: "workspace", bomId: "", workspace: { kind: "manage", dcId } };
  }
  if (/^[0-9a-f-]{36}$/i.test(raw)) return { mode: "workspace", bomId: "", workspace: { kind: "manage", dcId: raw } };
  return null;
}

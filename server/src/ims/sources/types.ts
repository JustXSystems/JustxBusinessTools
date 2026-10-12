/**
 * Sources adapt other tools' records into IMS. Sources only *read* the other
 * tool; IMS keeps its own copy plus an `ims_links` row, so imports are
 * idempotent and the source tool is never modified.
 *
 * A document source is structurally the same shape as a BOS connector, so the
 * Quotation V1 / Site Survey connectors plug straight in.
 */

export type SourceParty = {
  name: string;
  company?: string | null;
  gstin?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
};

export type SourceLine = {
  description: string;
  hsn?: string | null;
  unit?: string | null;
  quantity: number;
  rate: number;
  discountPct?: number;
  taxRate: number;
};

export type SourceRecord = {
  ref: string;
  docNo: string;
  date: string;
  status: string;
  amount: number;
  title: string;
  party: SourceParty;
  lines?: SourceLine[];
  placeOfSupply?: string | null;
  notes?: string | null;
  updatedAt?: string | null;
};

/** Another tool's documents (quotations, surveys…) → IMS customers and draft sales invoices. */
export interface ImsDocumentSource {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly description: string;
  readonly href: string;
  list(tenantId: number): Promise<SourceRecord[]>;
  get(tenantId: number, ref: string): Promise<SourceRecord | null>;
}

export type CatalogItem = {
  ref: string;
  name: string;
  sku: string | null;
  hsn: string | null;
  unit: string | null;
  rate: number;
  gstRate: number;
  kind: "goods" | "service";
};

export type CatalogParty = SourceParty & { ref: string; kind: "customer" | "supplier" | "both" };

/** Another tool's master data (product catalog, customer & vendor book) → IMS items and parties. */
export interface ImsCatalogSource {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly description: string;
  readonly href: string;
  items(tenantId: number): Promise<CatalogItem[]>;
  parties(tenantId: number): Promise<CatalogParty[]>;
}

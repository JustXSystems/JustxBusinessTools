import type { BosLineInput } from "../logic.js";

/**
 * A connector adapts another tool's records into BOS. Connectors only *read* the
 * source tool; BOS keeps its own copy plus a `bos_links` row, so imports are
 * idempotent and the source tool is never modified.
 */

export type ConnectorTarget = "party" | "invoice" | "project";

export type ConnectorParty = {
  name: string;
  company?: string | null;
  gstin?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
};

export type ConnectorRecord = {
  ref: string;
  docNo: string;
  date: string;
  status: string;
  amount: number;
  title: string;
  party: ConnectorParty;
  /** Invoice lines when the record can become an invoice. */
  lines?: BosLineInput[];
  placeOfSupply?: string | null;
  siteAddress?: string | null;
  notes?: string | null;
  updatedAt?: string | null;
};

export interface BosConnector {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly description: string;
  /** Where the source tool lives (deep link back). */
  readonly href: string;
  /** Imports a user can trigger. */
  readonly targets: ReadonlyArray<ConnectorTarget>;
  /** Imports auto-sync performs for this record (empty → skip). */
  autoTargets(record: ConnectorRecord): ConnectorTarget[];
  list(tenantId: number): Promise<ConnectorRecord[]>;
  get(tenantId: number, ref: string): Promise<ConnectorRecord | null>;
}

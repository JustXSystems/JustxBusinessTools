import type { Pool } from "mysql2/promise";
import { num } from "../logic.js";
import { listDocuments, str, type DocumentRow } from "./document-records.js";
import type { BosConnector, ConnectorRecord } from "./types.js";

const TOOL_ID = "sitesurveyv1";

function field(values: unknown, key: string): string {
  const obj = values && typeof values === "object" ? (values as Record<string, unknown>) : {};
  const v = obj[key];
  return Array.isArray(v) ? str(v[0]) : str(v);
}

function toRecord(row: DocumentRow & { payload: Record<string, unknown> }): ConnectorRecord {
  const s = row.payload;
  const values = s.values;
  const city = field(values, "f_city");
  const address = field(values, "f_address");
  const kind = str(s.installationType);
  return {
    ref: row.id,
    docNo: row.doc_no,
    date: row.doc_date,
    status: row.status,
    amount: num(row.grand_total),
    title: [kind || "Site survey", city].filter(Boolean).join(" · "),
    party: {
      name: field(values, "f_name") || row.party_name || "Customer",
      email: field(values, "f_email") || null,
      phone: field(values, "f_phone") || null,
      address: address || null,
      city: city || null,
    },
    siteAddress: [address, city].filter(Boolean).join(", ") || null,
    notes: [`From site survey ${row.doc_no}`, field(values, "f_notes")].filter(Boolean).join(" — "),
    updatedAt: row.updated_at,
  };
}

/** Site Survey V1 → BOS: surveyed customers plus a project lead carrying the estimate and site. */
export function siteSurveyV1Connector(db: Pool): BosConnector {
  return {
    id: TOOL_ID,
    label: "Site Survey V1",
    icon: "☀️",
    description: "Submitted surveys open a project lead with the site address and estimate, and add the customer to BOS.",
    href: "/tools/sitesurveyv1",
    targets: ["party", "project"],
    autoTargets: (r) => (["saved", "submitted", "sent"].includes(r.status) ? ["party", "project"] : []),
    async list(tenantId) {
      return (await listDocuments(db, tenantId, TOOL_ID)).filter((r) => r.status !== "draft").map(toRecord);
    },
    async get(tenantId, ref) {
      const [row] = await listDocuments(db, tenantId, TOOL_ID, ref);
      return row ? toRecord(row) : null;
    },
  };
}

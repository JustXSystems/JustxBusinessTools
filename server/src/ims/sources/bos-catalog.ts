import type { Pool } from "mysql2/promise";
import { money, rows } from "../db.js";
import type { CatalogItem, CatalogParty, ImsCatalogSource } from "./types.js";

/** Justx BOS → IMS: the BOS product & service catalog and customer / vendor book (read-only). */
export function bosCatalogSource(db: Pool): ImsCatalogSource {
  return {
    id: "bos",
    label: "Justx BOS",
    icon: "🏢",
    description: "Pull your BOS products into the IMS item master and your BOS customers & vendors into IMS parties.",
    href: "/tools/bos",
    async items(tenantId) {
      try {
        const list = await rows<{ id: string; name: string; sku: string | null; hsn: string | null; unit: string | null; rate: string; tax_rate: string; kind: string }>(
          db,
          `SELECT id, name, sku, hsn, unit, rate, tax_rate, kind FROM bos_items WHERE tenant_id = :tenantId AND active = 1 ORDER BY name LIMIT 2000`,
          { tenantId },
        );
        return list.map<CatalogItem>((r) => ({
          ref: r.id,
          name: r.name,
          sku: r.sku,
          hsn: r.hsn,
          unit: r.unit,
          rate: money(r.rate),
          gstRate: money(r.tax_rate),
          kind: r.kind === "service" ? "service" : "goods",
        }));
      } catch (err) {
        if ((err as { code?: string }).code === "ER_NO_SUCH_TABLE") return [];
        throw err;
      }
    },
    async parties(tenantId) {
      try {
        const list = await rows<{ id: string; kind: string; name: string; company: string | null; gstin: string | null; email: string | null; phone: string | null; address: string | null; city: string | null; state: string | null }>(
          db,
          `SELECT id, kind, name, company, gstin, email, phone, address, city, state FROM bos_parties
           WHERE tenant_id = :tenantId AND archived_at IS NULL ORDER BY name LIMIT 5000`,
          { tenantId },
        );
        return list.map<CatalogParty>((r) => ({
          ref: r.id,
          kind: r.kind === "vendor" ? "supplier" : r.kind === "both" ? "both" : "customer",
          name: r.name,
          company: r.company,
          gstin: r.gstin,
          email: r.email,
          phone: r.phone,
          address: r.address,
          city: r.city,
          state: r.state,
        }));
      } catch (err) {
        if ((err as { code?: string }).code === "ER_NO_SUCH_TABLE") return [];
        throw err;
      }
    },
  };
}

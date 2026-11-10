/**
 * Client-side documentation of BOM Excel → Inventory Items mapping.
 * Server (`item-invent.ts`) is the source of truth when creating rows.
 *
 * Mapped from template:
 *   Item Description → Item name
 *   Vendor OR Make    → Brand
 *   Unit              → Unit
 *   Price Per Unit    → Selling price
 *
 * Invented on create: SKU, barcode, category, HSN, GST %, estimated purchase,
 * MRP, min stock, notes.
 */

export const BOM_TO_INVENTORY_MAP = [
  { excel: "Item Description", inventory: "Item name" },
  { excel: "Vendor / Make", inventory: "Brand" },
  { excel: "Unit", inventory: "Unit" },
  { excel: "Price Per Unit", inventory: "Selling price" },
] as const;

export type BomInventorySeed = {
  name: string;
  brand?: string | null;
  unit?: string | null;
  sellingPrice?: number | null;
  sku?: string | null;
  section?: string | null;
  remarks?: string | null;
  typicalQty?: number | null;
};

/** Payload shape sent to POST /items/ensure for one stock line. */
export function bomLineToEnsurePayload(seed: BomInventorySeed) {
  return {
    name: seed.name.trim(),
    brand: seed.brand?.trim() || null,
    unit: seed.unit?.trim() || "nos",
    sellingPrice: Math.max(0, Number(seed.sellingPrice) || 0),
    sku: seed.sku?.trim() || null,
    section: seed.section?.trim() || null,
    remarks: seed.remarks?.trim() || null,
    typicalQty: Math.max(0, Number(seed.typicalQty) || 0) || undefined,
  };
}

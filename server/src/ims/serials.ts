/**
 * Pure domain helpers for serialized (unit-level) inventory tracking and
 * moving weighted-average cost calculation.
 */
import { round2 } from "./logic.js";

export type SerialStatus = "in_stock" | "out" | "damaged" | "returned";

export const SERIAL_STATUSES: ReadonlySet<SerialStatus> = new Set(["in_stock", "out", "damaged", "returned"]);

const normText = (v: unknown): string =>
  String(v ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

/** Normalized product identity for grouping physical units into one `ims_items` product. */
export function productGroupKey(input: { name: string; category?: string | null; brand?: string | null }): string {
  return `${normText(input.name)}||${normText(input.category)}||${normText(input.brand)}`;
}

/**
 * Moving weighted-average unit cost when receiving stock.
 * Preserves existing cost when no positive unitCost is given; uses `addedUnitCost`
 * directly when existing stock is zero or negative.
 */
export function movingWeightedAvgCost(existingQty: number, existingCost: number, addedQty: number, addedUnitCost: number | null | undefined): number {
  const addCost = addedUnitCost == null ? NaN : Number(addedUnitCost);
  if (!(addedQty > 0) || !Number.isFinite(addCost) || addCost <= 0) return round2(Math.max(0, existingCost));
  const prevQty = Math.max(0, existingQty);
  const prevCost = Math.max(0, existingCost);
  if (prevQty <= 0) return round2(addCost);
  return round2((prevQty * prevCost + addedQty * addCost) / (prevQty + addedQty));
}

export type SerializedUnitRow = {
  rowNumber: number;
  serialNo: string;
  name: string;
  sku: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  hsn: string | null;
  gstRate: number;
  purchasePrice: number;
  sellingPrice: number;
  mrp: number | null;
  minStock: number;
  maxStock: number | null;
  reorderQty: number | null;
  location: string | null;
  notes: string | null;
};

export type SerializedProductGroup = {
  key: string;
  name: string;
  sku: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  hsn: string | null;
  gstRate: number;
  /** Weighted average purchase price across units in this group. */
  purchasePrice: number;
  sellingPrice: number;
  mrp: number | null;
  minStock: number;
  maxStock: number | null;
  reorderQty: number | null;
  location: string | null;
  notes: string | null;
  units: Array<{ rowNumber: number; serialNo: string; purchasePrice: number; notes: string | null }>;
};

const optStr = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

const nonNeg = (v: unknown, fallback = 0): number => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const optNonNeg = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Groups 1-row-per-physical-unit import rows into product groups.
 * - Extracts the unique scan code from `serialNo`, else `barcode`, else `sku`.
 * - Rejects rows missing a name or scan code, and rejects duplicate scan codes within the batch.
 * - Groups units with the same `(name, category, brand)` into one product with weighted-average purchase price.
 */
export type SerializedBulkRow = {
  rowNumber: number;
  name: string;
  sku: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  hsn: string | null;
  gstRate: number;
  purchasePrice: number;
  sellingPrice: number;
  mrp: number | null;
  minStock: number;
  maxStock: number | null;
  reorderQty: number | null;
  location: string | null;
  notes: string | null;
  openingStock: number;
};

const isNumericUnit = (u: string | null) => Boolean(u && /^\d+(?:\.\d+)?$/.test(u.trim()));

export function groupSerializedImportRows(rawRows: ReadonlyArray<Record<string, unknown>>): {
  groups: SerializedProductGroup[];
  bulkRows: SerializedBulkRow[];
  errors: string[];
} {
  const errors: string[] = [];
  const bulkRows: SerializedBulkRow[] = [];
  const seenSerials = new Map<string, number>();
  const byProduct = new Map<string, { first: SerializedUnitRow; units: SerializedProductGroup["units"] }>();

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i] ?? {};
    const rowNumber = i + 1;
    const name = optStr(raw.name, 200);
    if (!name) {
      errors.push(`Row ${rowNumber}: Item name is required`);
      continue;
    }

    const explicitSerial = optStr(raw.serialNo, 100);
    const barcode = optStr(raw.barcode, 100);
    const sku = optStr(raw.sku, 64);
    const serialNo = explicitSerial ?? barcode ?? sku;
    const rawUnit = optStr(raw.unit, 20);
    const safeUnit = !rawUnit || isNumericUnit(rawUnit) ? "pcs" : rawUnit;
    const gstRate = nonNeg(raw.gstRate, 18);
    if (gstRate > 100) {
      errors.push(`Row ${rowNumber}: GST % must be 0–100`);
      continue;
    }

    if (!serialNo) {
      const openingStock = nonNeg(raw.openingStock ?? raw.currentStock, 0);
      if (openingStock > 0) {
        bulkRows.push({
          rowNumber,
          name,
          sku: null,
          category: optStr(raw.category, 80),
          brand: optStr(raw.brand, 80),
          unit: safeUnit,
          hsn: optStr(raw.hsn, 20),
          gstRate,
          purchasePrice: round2(nonNeg(raw.purchasePrice, 0)),
          sellingPrice: round2(nonNeg(raw.sellingPrice, 0)),
          mrp: optNonNeg(raw.mrp),
          minStock: nonNeg(raw.minStock, 0),
          maxStock: optNonNeg(raw.maxStock),
          reorderQty: optNonNeg(raw.reorderQty),
          location: optStr(raw.location, 80),
          notes: optStr(raw.notes, 500),
          openingStock,
        });
        continue;
      }
      errors.push(`Row ${rowNumber}: Scan code / serial number is required in unit-per-row import`);
      continue;
    }

    const serialKey = serialNo.toLowerCase();
    const prevRow = seenSerials.get(serialKey);
    if (prevRow !== undefined) {
      errors.push(`Row ${rowNumber}: Duplicate scan code "${serialNo}" (already on row ${prevRow})`);
      continue;
    }
    seenSerials.set(serialKey, rowNumber);

    // Keep product SKU only if the user gave a separate SKU distinct from the unit's serial/scan code.
    const productSku = sku && sku.toLowerCase() !== serialKey ? sku : null;

    const unitRow: SerializedUnitRow = {
      rowNumber,
      serialNo,
      name,
      sku: productSku,
      category: optStr(raw.category, 80),
      brand: optStr(raw.brand, 80),
      unit: safeUnit,
      hsn: optStr(raw.hsn, 20),
      gstRate,
      purchasePrice: round2(nonNeg(raw.purchasePrice, 0)),
      sellingPrice: round2(nonNeg(raw.sellingPrice, 0)),
      mrp: optNonNeg(raw.mrp),
      minStock: nonNeg(raw.minStock, 0),
      maxStock: optNonNeg(raw.maxStock),
      reorderQty: optNonNeg(raw.reorderQty),
      location: optStr(raw.location, 80),
      notes: optStr(raw.notes, 500),
    };

    const key = productGroupKey(unitRow);
    const existing = byProduct.get(key);
    if (!existing) {
      byProduct.set(key, {
        first: unitRow,
        units: [{ rowNumber, serialNo: unitRow.serialNo, purchasePrice: unitRow.purchasePrice, notes: unitRow.notes }],
      });
    } else {
      // Fill optional product-level metadata if the first row was blank.
      if (!existing.first.sku && unitRow.sku) existing.first.sku = unitRow.sku;
      if (!existing.first.hsn && unitRow.hsn) existing.first.hsn = unitRow.hsn;
      if (!existing.first.location && unitRow.location) existing.first.location = unitRow.location;
      if (!existing.first.sellingPrice && unitRow.sellingPrice) existing.first.sellingPrice = unitRow.sellingPrice;
      if (existing.first.mrp == null && unitRow.mrp != null) existing.first.mrp = unitRow.mrp;
      existing.units.push({ rowNumber, serialNo: unitRow.serialNo, purchasePrice: unitRow.purchasePrice, notes: unitRow.notes });
    }
  }

  const groups: SerializedProductGroup[] = [];
  for (const [key, { first, units }] of byProduct.entries()) {
    const priced = units.filter((u) => u.purchasePrice > 0);
    const avgCost = priced.length ? round2(priced.reduce((s, u) => s + u.purchasePrice, 0) / priced.length) : first.purchasePrice;
    groups.push({
      key,
      name: first.name,
      sku: first.sku,
      category: first.category,
      brand: first.brand,
      unit: first.unit,
      hsn: first.hsn,
      gstRate: first.gstRate,
      purchasePrice: avgCost,
      sellingPrice: first.sellingPrice,
      mrp: first.mrp,
      minStock: first.minStock,
      maxStock: first.maxStock,
      reorderQty: first.reorderQty,
      location: first.location,
      notes: first.notes,
      units,
    });
  }

  return { groups, bulkRows, errors };
}

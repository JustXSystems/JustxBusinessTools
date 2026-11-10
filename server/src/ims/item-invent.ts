/**
 * Invent catalogue fields when seeding Inventory Items from BOM templates.
 * Mapped from Excel: description→name, make/vendor→brand, unit→unit, price→sellingPrice.
 * Everything else is inferred so Items stay usable for stock, GST and search.
 */

export type BomItemSeed = {
  name: string;
  brand?: string | null;
  unit?: string | null;
  sellingPrice?: number | null;
  sku?: string | null;
  barcode?: string | null;
  category?: string | null;
  section?: string | null;
  remarks?: string | null;
  typicalQty?: number | null;
  source?: string | null;
  defaultGstRate?: number;
};

export type InventedItemFields = {
  name: string;
  brand: string | null;
  unit: string;
  sellingPrice: number;
  sku: string;
  barcode: string;
  category: string;
  hsn: string | null;
  gstRate: number;
  purchasePrice: number;
  mrp: number | null;
  minStock: number;
  notes: string;
};

function clip(s: string, max: number): string {
  return s.trim().slice(0, max);
}

function normUnit(raw: string | null | undefined): string {
  const u = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "");
  if (!u) return "nos";
  if (/^(nos|no|number|numbers|pcs|pc|piece|pieces)$/.test(u)) return "nos";
  if (/^(mtr|mtrs|meter|metre|meters|metres|m)$/.test(u)) return "mtr";
  if (/^(set|sets)$/.test(u)) return "set";
  if (/^(kg|kgs|kilogram|kilograms)$/.test(u)) return "kg";
  if (/^(ltr|ltrs|liter|litre|liters|litres|l)$/.test(u)) return "ltr";
  if (/^(job|jobs|lot|lots|kit|kits)$/.test(u)) return u.replace(/s$/, "") || u;
  if (/^(wp|watt|watts)$/.test(u)) return "wp";
  if (/^(kw|kilowatt)$/.test(u)) return "kw";
  return clip(u, 20) || "nos";
}

/** Stable 32-bit hash so re-imports invent the same SKU/barcode for the same name+brand. */
function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** Restricted-circulation EAN-13 derived from a stable seed (never random). */
export function inventBarcode(seed: string): string {
  const digits = String(hash32(seed)).padStart(10, "0");
  const body = `2${digits}`.slice(0, 12).padEnd(12, "0");
  return `${body}${ean13CheckDigit(body)}`;
}

export function inventSku(name: string, brand: string | null): string {
  const brandPart = (brand || "GEN")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 4) || "GEN";
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w.slice(0, 3));
  const namePart = words.join("-") || "ITEM";
  const suffix = String(hash32(`${name.toLowerCase()}|${(brand || "").toLowerCase()}`) % 10000).padStart(4, "0");
  return clip(`${brandPart}-${namePart}-${suffix}`, 64);
}

type TaxonomyHit = { category: string; hsn: string | null; gstRate: number };

const TAXONOMY: Array<{ test: RegExp; hit: TaxonomyHit }> = [
  { test: /\b(panel|module|pv\b|solar\s*mod)/i, hit: { category: "Solar Modules", hsn: "854142", gstRate: 12 } },
  { test: /\b(inverter|hybrid\s*inv|ongrid|offgrid|microinv)/i, hit: { category: "Inverters", hsn: "850440", gstRate: 18 } },
  { test: /\b(battery|lithium|lfp|tubular|inverter\s*batt)/i, hit: { category: "Batteries", hsn: "850760", gstRate: 18 } },
  { test: /\b(cable|wire|conductor|dc\s*cable|ac\s*cable)/i, hit: { category: "Cables & Wiring", hsn: "854449", gstRate: 18 } },
  { test: /\b(structure|rail|mount|racking|gi\s*pipe|purlin)/i, hit: { category: "Mounting Structure", hsn: "730890", gstRate: 18 } },
  { test: /\b(earthing|lightning|spd|surge|mccb|mcb|isolator|db\b|fuse)/i, hit: { category: "Electrical Protection", hsn: "853540", gstRate: 18 } },
  { test: /\b(connector|mc4|lugs|gland|conduit|trunking)/i, hit: { category: "Connectors & Accessories", hsn: "853690", gstRate: 18 } },
  { test: /\b(meter|energy\s*meter|bi[\s-]?directional)/i, hit: { category: "Meters", hsn: "902830", gstRate: 18 } },
  { test: /\b(fastener|bolt|nut|screw|clamp|clip)/i, hit: { category: "Hardware", hsn: "731815", gstRate: 18 } },
  { test: /\b(pipe|elbow|valve|fitting)/i, hit: { category: "Pipes & Fittings", hsn: "391723", gstRate: 18 } },
  { test: /\b(tool|drill|kit\b)/i, hit: { category: "Tools & Kits", hsn: "820790", gstRate: 18 } },
];

function inventTaxonomy(name: string, section: string | null, categoryHint: string | null, defaultGst: number): TaxonomyHit {
  if (categoryHint?.trim()) {
    for (const row of TAXONOMY) {
      if (row.test.test(name)) return { ...row.hit, category: clip(categoryHint, 80) };
    }
    return { category: clip(categoryHint, 80), hsn: null, gstRate: defaultGst };
  }
  for (const row of TAXONOMY) {
    if (row.test.test(name)) return row.hit;
  }
  const sec = (section || "").trim();
  if (sec && !/main items|accessories?\s*&\s*services|services/i.test(sec)) {
    return { category: clip(sec, 80), hsn: null, gstRate: defaultGst };
  }
  return { category: "BOM Materials", hsn: null, gstRate: defaultGst };
}

/**
 * Build a full Items payload from the four BOM Excel anchors + intelligent defaults.
 * Does not invent over explicit sku/barcode/category when provided.
 */
export function inventItemFromBomLine(seed: BomItemSeed): InventedItemFields {
  const name = clip(seed.name || "Item", 200) || "Item";
  const brand = seed.brand?.trim() ? clip(seed.brand, 80) : null;
  const unit = normUnit(seed.unit);
  const sellingPrice = Math.max(0, Math.round((Number(seed.sellingPrice) || 0) * 100) / 100);
  const defaultGst = Number.isFinite(seed.defaultGstRate) ? Math.min(100, Math.max(0, seed.defaultGstRate!)) : 18;
  const tax = inventTaxonomy(name, seed.section ?? null, seed.category ?? null, defaultGst);

  const sku = seed.sku?.trim() ? clip(seed.sku, 64) : inventSku(name, brand);
  const barcode = seed.barcode?.trim() ? clip(seed.barcode, 64) : inventBarcode(`sku:${sku}`);

  // Estimated landable cost ~78% of BOM sell rate — editable in Items; never claimed as invoice cost.
  const purchasePrice = sellingPrice > 0 ? Math.round(sellingPrice * 0.78 * 100) / 100 : 0;
  const mrp = sellingPrice > 0 ? Math.round(sellingPrice * 1.08 * 100) / 100 : null;

  const qty = Math.max(0, Number(seed.typicalQty) || 0);
  const minStock = qty > 0 ? Math.max(1, Math.min(1000, Math.ceil(qty * 0.5))) : 1;

  const source = seed.source?.trim() || "BOM template";
  const remarkBit = seed.remarks?.trim() ? ` · ${clip(seed.remarks, 120)}` : "";
  const notes = clip(
    `Seeded from ${source}. Mapped: description→name, make/vendor→brand, unit, price/unit→selling.${remarkBit} Estimated purchase (${Math.round(0.78 * 100)}% of sell) — refine in Items.`,
    2000,
  );

  return {
    name,
    brand,
    unit,
    sellingPrice,
    sku,
    barcode,
    category: tax.category,
    hsn: tax.hsn,
    gstRate: tax.gstRate,
    purchasePrice,
    mrp,
    minStock,
    notes,
  };
}

/**
 * Keep BOM stock lines inventory-backed: link existing catalogue items, create when missing.
 */
import { ims, type ImsItem } from "./api";
import type { BomPackageInput, BomPackageLineInput } from "./bom";
import {
  applyCatalogMatches,
  matchCatalogItem,
  type CatalogMatchItem,
  type CatalogMatchSummary,
} from "./bom-excel";
import { bomLineToEnsurePayload } from "./bom-item-invent";

export type CatalogEnsureSummary = CatalogMatchSummary & { created: number };

export type EnsureableStockLine = {
  description: string;
  makeText?: string | null;
  skuHint?: string | null;
  unit?: string;
  rate?: number | null;
  itemId?: string | null;
  lineKind?: string;
};

function toCatalog(items: ReadonlyArray<ImsItem>): CatalogMatchItem[] {
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    sku: i.sku,
    barcode: i.barcode,
    brand: i.brand,
    unit: i.unit,
    sellingPrice: i.sellingPrice,
  }));
}

/** Resolve one stock line against catalogue + ensure API (create when clearly missing). */
export async function ensureStockLineItem(
  line: EnsureableStockLine,
  catalog: ReadonlyArray<CatalogMatchItem>,
  opts: { source?: string; mutateCatalog?: (item: CatalogMatchItem) => void } = {},
): Promise<{ itemId: string | null; status: "linked" | "created" | "ambiguous" | "skipped"; item?: CatalogMatchItem }> {
  if (line.itemId) return { itemId: line.itemId, status: "skipped" };
  if (line.lineKind && line.lineKind !== "stock") return { itemId: null, status: "skipped" };
  const desc = line.description?.trim();
  if (!desc) return { itemId: null, status: "skipped" };

  const hit = matchCatalogItem(
    { description: desc, makeText: line.makeText, skuHint: line.skuHint },
    catalog,
  );
  if (hit.item && (hit.confidence === "exact" || hit.confidence === "strong")) {
    return { itemId: hit.item.id, status: "linked", item: hit.item };
  }
  if (hit.confidence === "ambiguous") {
    return { itemId: null, status: "ambiguous" };
  }

  const ensured = await ims.ensureItems({
    source: opts.source ?? "BOM",
    items: [
      bomLineToEnsurePayload({
        name: desc,
        brand: line.makeText,
        sku: line.skuHint,
        unit: line.unit,
        sellingPrice: line.rate,
      }),
    ],
  });
  const row = ensured.results[0];
  if (!row) return { itemId: null, status: "skipped" };
  const item: CatalogMatchItem = {
    id: row.id,
    name: desc,
    sku: line.skuHint?.trim() || null,
    barcode: null,
    brand: line.makeText?.trim() || null,
    unit: line.unit?.trim() || "nos",
    sellingPrice: Math.max(0, Number(line.rate) || 0),
  };
  opts.mutateCatalog?.(item);
  return { itemId: row.id, status: row.status, item };
}

/**
 * Link exact/strong matches, then create missing stock catalogue rows.
 * Ambiguous matches are left for the picker (never invent a duplicate).
 */
export async function ensureBomPackageCatalog(
  packages: BomPackageInput[],
  opts: { catalog?: ReadonlyArray<ImsItem | CatalogMatchItem>; source?: string } = {},
): Promise<{ packages: BomPackageInput[]; summary: CatalogEnsureSummary }> {
  const live =
    opts.catalog ??
    (await ims.items({ includeInactive: false }).then((r) => r.items));
  const catalog = toCatalog(live as ImsItem[]);
  const { packages: matched, summary: matchSummary } = applyCatalogMatches(packages, catalog);
  const summary: CatalogEnsureSummary = { ...matchSummary, created: 0 };

  const createQueue: Array<{
    pkgIdx: number;
    lineIdx: number;
    name: string;
    brand: string | null;
    sku: string | null;
    unit: string;
    sellingPrice: number;
    section: string | null;
    remarks: string | null;
    typicalQty: number;
  }> = [];

  matched.forEach((pkg, pkgIdx) => {
    (pkg.lines ?? []).forEach((line, lineIdx) => {
      if (line.itemId || line.lineKind !== "stock") return;
      const desc = line.description?.trim();
      if (!desc) return;
      const hit = matchCatalogItem(
        { description: desc, makeText: line.makeText, skuHint: (line as { skuHint?: string | null }).skuHint },
        catalog,
      );
      if (hit.confidence === "ambiguous") return;
      createQueue.push({
        pkgIdx,
        lineIdx,
        name: desc,
        brand: line.makeText?.trim() || null,
        sku: (line as { skuHint?: string | null }).skuHint?.trim() || null,
        unit: line.unit?.trim() || "nos",
        sellingPrice: Math.max(0, Number(line.defaultRate) || 0),
        section: line.section?.trim() || null,
        remarks: line.remarks?.trim() || null,
        typicalQty: Math.max(0, Number(line.qty) || 0),
      });
    });
  });

  if (!createQueue.length) {
    // Rematch may have counted unmatched that we couldn't create (empty desc) — keep counts honest.
    return { packages: matched, summary };
  }

  // Deduplicate ensure payloads while preserving first occurrence mapping
  const uniqueKeys: string[] = [];
  const uniqueItems: Array<ReturnType<typeof bomLineToEnsurePayload>> = [];
  const queueToUnique = createQueue.map((q) => {
    const key = `${q.name.toLowerCase()}|${(q.brand ?? "").toLowerCase()}|${(q.sku ?? "").toLowerCase()}`;
    let u = uniqueKeys.indexOf(key);
    if (u < 0) {
      u = uniqueKeys.length;
      uniqueKeys.push(key);
      uniqueItems.push(
        bomLineToEnsurePayload({
          name: q.name,
          brand: q.brand,
          sku: q.sku,
          unit: q.unit,
          sellingPrice: q.sellingPrice,
          section: q.section,
          remarks: q.remarks,
          typicalQty: q.typicalQty,
        }),
      );
    }
    return u;
  });

  const ensured = await ims.ensureItems({
    source: opts.source ?? "BOM package import",
    items: uniqueItems,
  });

  const idByUnique = new Map<number, { id: string; status: "linked" | "created" }>();
  for (const row of ensured.results) {
    idByUnique.set(row.index, { id: row.id, status: row.status });
  }

  let resolvedUnmatched = 0;
  const nextPackages = matched.map((pkg, pkgIdx) => ({
    ...pkg,
    lines: (pkg.lines ?? []).map((line, lineIdx) => {
      if (line.itemId || line.lineKind !== "stock") return line;
      const qi = createQueue.findIndex((q) => q.pkgIdx === pkgIdx && q.lineIdx === lineIdx);
      if (qi < 0) return line;
      const u = queueToUnique[qi]!;
      const hit = idByUnique.get(u);
      if (!hit) return line;
      resolvedUnmatched += 1;
      const seeded = uniqueItems[u]!;
      if (!catalog.some((c) => c.id === hit.id)) {
        catalog.push({
          id: hit.id,
          name: seeded.name,
          sku: seeded.sku ?? null,
          barcode: null,
          brand: seeded.brand ?? null,
          unit: seeded.unit || "nos",
          sellingPrice: seeded.sellingPrice ?? 0,
        });
      }
      return {
        ...line,
        itemId: hit.id,
        unit: line.unit || seeded.unit || "nos",
        defaultRate: line.defaultRate != null && line.defaultRate > 0 ? line.defaultRate : seeded.sellingPrice || 0,
        makeText: line.makeText || seeded.brand || null,
      };
    }),
  }));

  summary.created = ensured.created;
  summary.matched += ensured.linked;
  summary.unmatched = Math.max(0, summary.unmatched - resolvedUnmatched);

  return { packages: nextPackages, summary };
}

/** Ensure every stock line with a description is linked before save. Mutates a copy of lines. */
export async function ensureStockLinesForSave<T extends BomPackageLineInput & { key?: string; rate?: number }>(
  lines: T[],
  opts: { source?: string; rateKey?: "defaultRate" | "rate" } = {},
): Promise<{ lines: T[]; summary: CatalogEnsureSummary }> {
  const rateKey = opts.rateKey ?? "defaultRate";
  const pkgs: BomPackageInput[] = [
    {
      name: "tmp",
      lines: lines.map((l) => ({
        section: l.section,
        lineKind: l.lineKind,
        itemId: l.itemId,
        description: l.description,
        makeText: l.makeText,
        qty: l.qty,
        unit: l.unit,
        scaleByCapacity: l.scaleByCapacity,
        defaultRate: rateKey === "rate" ? Number((l as { rate?: number }).rate) || 0 : Number(l.defaultRate) || 0,
        remarks: l.remarks,
      })),
    },
  ];
  const { packages, summary } = await ensureBomPackageCatalog(pkgs, { source: opts.source ?? "BOM line sync" });
  const ensured = packages[0]?.lines ?? [];
  const next = lines.map((l, i) => {
    const e = ensured[i];
    if (!e?.itemId || l.itemId) return l;
    const patch: T = {
      ...l,
      itemId: e.itemId,
      unit: e.unit || l.unit,
      makeText: l.makeText || e.makeText || null,
    };
    if (rateKey === "rate") {
      const rate = Number((l as { rate?: number }).rate) || 0;
      (patch as { rate?: number }).rate = rate > 0 ? rate : Number(e.defaultRate) || 0;
    } else if (!(Number(l.defaultRate) > 0) && e.defaultRate) {
      patch.defaultRate = e.defaultRate;
    }
    return patch;
  });
  return { lines: next, summary };
}

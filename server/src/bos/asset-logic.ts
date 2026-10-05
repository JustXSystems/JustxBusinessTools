/**
 * Fixed-asset rules: category presets, depreciation by financial year and
 * book value on any date. Pure, so it is unit-tested.
 */
import { addDaysISO, daysBetween, fiscalYearLabel, fiscalYearStart, round2 } from "./logic.js";

export const DEPRECIATION_METHODS = ["slm", "wdv", "none"] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

export const ASSET_STATUSES = ["in_use", "maintenance", "disposed"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * Suggested yearly rates. WDV follows the Income-tax Act blocks; SLM spreads 95% of cost
 * over the Companies Act (Schedule II) useful life. Managers can change any rate.
 */
export const ASSET_CATEGORIES: ReadonlyArray<{ name: string; wdv: number; slm: number }> = [
  { name: "Computers & IT", wdv: 40, slm: 31.67 },
  { name: "Furniture & fittings", wdv: 10, slm: 9.5 },
  { name: "Vehicles", wdv: 15, slm: 11.88 },
  { name: "Plant & machinery", wdv: 15, slm: 6.33 },
  { name: "Tools & equipment", wdv: 15, slm: 6.33 },
  { name: "Office equipment", wdv: 15, slm: 19 },
  { name: "Renewable energy equipment", wdv: 40, slm: 4.75 },
  { name: "Buildings", wdv: 10, slm: 3.17 },
  { name: "Software", wdv: 25, slm: 31.67 },
  { name: "Land", wdv: 0, slm: 0 },
  { name: "Other", wdv: 15, slm: 10 },
];

export type DepreciableAsset = {
  cost: number;
  salvage: number;
  method: DepreciationMethod;
  /** % a year */
  rate: number;
  purchaseDate: string;
  disposedOn?: string | null;
};

export type ScheduleRow = {
  fyStart: string;
  fyEnd: string;
  label: string;
  opening: number;
  depreciation: number;
  closing: number;
  /** Days depreciated in this year (fewer in the first, last and disposal years). */
  days: number;
};

const fyEndOf = (fyStart: string) => addDaysISO(`${Number(fyStart.slice(0, 4)) + 1}${fyStart.slice(4)}`, -1);

/**
 * Depreciation per financial year from the purchase date up to `upTo` (or the disposal date, if earlier).
 * Each year's charge is pro-rata to the days the asset was held:
 * - SLM: cost × rate;
 * - WDV: book value at the start of the year × rate;
 * and never takes the book value below the salvage value.
 */
export function depreciationSchedule(asset: DepreciableAsset, upTo: string, fyStartMonth = 4): ScheduleRow[] {
  const end = asset.disposedOn && asset.disposedOn < upTo ? asset.disposedOn : upTo;
  if (end < asset.purchaseDate) return [];
  const rows: ScheduleRow[] = [];
  const floor = Math.min(Math.max(0, asset.salvage), asset.cost);
  let book = asset.cost;
  let fyStart = fiscalYearStart(asset.purchaseDate, fyStartMonth);
  while (fyStart <= end && rows.length < 200) {
    const fyEnd = fyEndOf(fyStart);
    const from = asset.purchaseDate > fyStart ? asset.purchaseDate : fyStart;
    const to = end < fyEnd ? end : fyEnd;
    const days = daysBetween(from, to) + 1;
    const share = days / (daysBetween(fyStart, fyEnd) + 1);
    const base = asset.method === "slm" ? asset.cost : asset.method === "wdv" ? book : 0;
    const charge = round2(Math.min(Math.max(0, book - floor), (base * asset.rate * share) / 100));
    rows.push({ fyStart, fyEnd, label: fiscalYearLabel(fyStart, fyStartMonth), opening: round2(book), depreciation: charge, closing: round2(book - charge), days });
    book = round2(book - charge);
    fyStart = addDaysISO(fyEnd, 1);
  }
  return rows;
}

/** Book value at the end of `asOf` (cost before the purchase date). */
export function bookValue(asset: DepreciableAsset, asOf: string, fyStartMonth = 4): number {
  const rows = depreciationSchedule(asset, asOf, fyStartMonth);
  return rows.length ? rows[rows.length - 1].closing : asset.cost;
}

export type YearFigures = { opening: number; additions: number; depreciation: number; disposals: number; closing: number };

/**
 * One asset's line in the depreciation schedule for the financial year starting `fyStart`:
 * opening book value, cost added in the year, the year's depreciation, book value removed on disposal, closing.
 */
export function yearFigures(asset: DepreciableAsset, fyStart: string, fyStartMonth = 4): YearFigures {
  const fyEnd = fyEndOf(fyStart);
  const empty = { opening: 0, additions: 0, depreciation: 0, disposals: 0, closing: 0 };
  if (asset.purchaseDate > fyEnd || (asset.disposedOn && asset.disposedOn < fyStart)) return empty;
  const opening = asset.purchaseDate < fyStart ? bookValue(asset, addDaysISO(fyStart, -1), fyStartMonth) : 0;
  const additions = asset.purchaseDate >= fyStart ? asset.cost : 0;
  const row = depreciationSchedule(asset, fyEnd, fyStartMonth).find((r) => r.fyStart === fyStart);
  const depreciation = row?.depreciation ?? 0;
  const disposedInYear = Boolean(asset.disposedOn && asset.disposedOn <= fyEnd);
  const disposals = disposedInYear ? round2(opening + additions - depreciation) : 0;
  return { opening, additions, depreciation, disposals, closing: disposedInYear ? 0 : round2(opening + additions - depreciation) };
}

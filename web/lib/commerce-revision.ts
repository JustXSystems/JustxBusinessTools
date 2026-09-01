import { invalidateLiveData } from "@/hooks/useLiveRefresh";

/** Cross-tab / same-tab signal that catalog prices or packs changed. */
export const COMMERCE_REV_KEY = "jbt.commerce-rev";
export const COMMERCE_CHANNEL = "jbt-commerce";

/** Call after admin SKU / pack mutations so operator carts and catalogs refresh. */
export function bumpCommerceRevision(): void {
  if (typeof window === "undefined") return;
  const at = String(Date.now());
  try {
    localStorage.setItem(COMMERCE_REV_KEY, at);
  } catch {
    /* private mode */
  }
  try {
    const bc = new BroadcastChannel(COMMERCE_CHANNEL);
    bc.postMessage({ type: "commerce-rev", at });
    bc.close();
  } catch {
    /* unsupported */
  }
  invalidateLiveData("commerce");
}

export function catalogPriceFingerprint(
  catalog: Array<{ toolId: string; priceInr: number; includedFree?: boolean }> | undefined,
  packs?: Array<{ id: string; priceInr: number; listPriceInr: number }> | undefined,
): string {
  const skuPart = (catalog ?? [])
    .map((s) => `${s.toolId}:${s.includedFree ? 0 : s.priceInr}`)
    .sort()
    .join("|");
  const packPart = (packs ?? [])
    .map((p) => `${p.id}:${p.priceInr}:${p.listPriceInr}`)
    .sort()
    .join("|");
  return `${skuPart}::${packPart}`;
}

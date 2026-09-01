const KEY = "jbt.tool-cart";
const PACK_KEY = "jbt.active-pack";

export function readToolCart(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((x) => String(x)))];
  } catch {
    return [];
  }
}

export function writeToolCart(ids: string[]): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(KEY, JSON.stringify([...new Set(ids)]));
  window.dispatchEvent(new Event("jbt-cart-change"));
}

export function addToToolCart(id: string): string[] {
  clearActivePack();
  const next = [...readToolCart().filter((x) => x !== id), id];
  writeToolCart(next);
  return next;
}

export function addManyToToolCart(ids: string[]): string[] {
  clearActivePack();
  const next = [...new Set([...readToolCart(), ...ids.map(String)])];
  writeToolCart(next);
  return next;
}

/** Replace cart with pack tools and keep pack id for discounted checkout. */
export function setPackCart(packId: string, toolIds: string[]): string[] {
  if (typeof window === "undefined") return [];
  const next = [...new Set(toolIds.map(String).filter(Boolean))];
  sessionStorage.setItem(PACK_KEY, packId);
  writeToolCart(next);
  return next;
}

export function readActivePack(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(PACK_KEY);
}

export function clearActivePack(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PACK_KEY);
}

export function removeFromToolCart(id: string): string[] {
  clearActivePack();
  const next = readToolCart().filter((x) => x !== id);
  writeToolCart(next);
  return next;
}

export function clearToolCart(): void {
  clearActivePack();
  writeToolCart([]);
}

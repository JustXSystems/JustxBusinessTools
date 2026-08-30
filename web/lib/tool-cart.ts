const KEY = "jbt.tool-cart";

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
  const next = [...readToolCart().filter((x) => x !== id), id];
  writeToolCart(next);
  return next;
}

export function removeFromToolCart(id: string): string[] {
  const next = readToolCart().filter((x) => x !== id);
  writeToolCart(next);
  return next;
}

export function clearToolCart(): void {
  writeToolCart([]);
}

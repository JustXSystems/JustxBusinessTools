/**
 * Group items by a key, or return a single flat bucket when grouping is off.
 */
export function groupItemsByKey<T>(
  items: T[],
  keyOf: (item: T) => string,
  groupEnabled: boolean,
  flatLabel = "All",
): Array<[string, T[]]> {
  if (!groupEnabled) {
    return items.length ? [[flatLabel, items]] : [];
  }
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item) || "General";
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return Array.from(map.entries());
}

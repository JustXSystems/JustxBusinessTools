/**
 * IMS module deep-links.
 *
 * URL shape: `/ims?m=<module>&open=<uuid>` for classic entity opens,
 * or `/ims?m=<module>&intent=<raw>` for richer intents (returns, new-return, tabs).
 * `open` may also carry a prefixed intent (`return:<uuid>`) for shareable search hits.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the value is already a full intent (not a bare entity id). */
export function isPrefixedIntent(raw: string): boolean {
  if (!raw) return false;
  if (UUID_RE.test(raw)) return false;
  // Named intents and prefixed ids: returns, new, open:…, return:…, new-return:…
  return true;
}

/** Normalize a search/notification `open` field into a navigate() intent value. */
export function intentFromOpenField(open: string): string {
  const v = open.trim();
  if (!v) return v;
  if (isPrefixedIntent(v)) return v;
  return `open:${v}`;
}

/** Resolve URL query (`open` + `intent`) into a navigate() intent value. */
export function intentFromUrlQuery(open: string | null, intent: string | null): string | null {
  if (intent?.trim()) return intent.trim();
  if (!open?.trim()) return null;
  return intentFromOpenField(open.trim());
}

/** Write intent into URLSearchParams (mutates). Clears previous open/intent. */
export function applyIntentToSearchParams(params: URLSearchParams, intent: string | null | undefined): void {
  params.delete("open");
  params.delete("intent");
  if (!intent) return;
  if (intent.startsWith("open:") && UUID_RE.test(intent.slice(5))) {
    params.set("open", intent.slice(5));
    return;
  }
  if (UUID_RE.test(intent)) {
    params.set("open", intent);
    return;
  }
  params.set("intent", intent);
}

/** Convenience builders for BOM / DC / Returns cross-links. */
export const bomDcLink = {
  list: () => undefined as string | undefined,
  returns: () => "returns",
  newDc: () => "new",
  newReturn: () => "new-return",
  openDc: (dcId: string) => `open:${dcId}`,
  openReturn: (returnId: string) => `return:${returnId}`,
  createReturn: (dcId: string) => `new-return:${dcId}`,
  newDcForBom: (bomId: string) => `new:${bomId}`,
};

export const bomLink = {
  open: (bomId: string) => `open:${bomId}`,
};

export const salesLink = {
  open: (invoiceId: string) => `open:${invoiceId}`,
};

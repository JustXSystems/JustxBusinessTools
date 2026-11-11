/** Shared identity helpers for party dedupe across Quotation, IMS, and BOS. */

export function phoneKey(raw: unknown): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length > 10) d = d.slice(-10);
  return d.length >= 8 ? d : "";
}

export function normalizeName(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function normalizeGstin(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase();
}

export type PartyMatchProbe = {
  name?: string | null;
  mobile?: string | null;
  phone?: string | null;
  gstin?: string | null;
  email?: string | null;
};

export type PartyMatchRow = {
  id: string;
  name: string;
  mobile?: string | null;
  gstin?: string | null;
  email?: string | null;
  active?: boolean | number;
};

/**
 * Match order: GSTIN → phone (normalized) → exact name (+ phone when both present).
 * Prefer active rows when duplicates exist.
 */
export function findMatchingParty<T extends PartyMatchRow>(list: ReadonlyArray<T>, probe: PartyMatchProbe): T | null {
  const gstin = normalizeGstin(probe.gstin);
  const phone = phoneKey(probe.mobile ?? probe.phone);
  const name = normalizeName(probe.name);
  const email = String(probe.email ?? "")
    .trim()
    .toLowerCase();

  const preferActive = (hits: T[]) => {
    if (!hits.length) return null;
    const active = hits.find((h) => h.active === undefined || h.active === true || h.active === 1);
    return active ?? hits[0];
  };

  if (gstin.length >= 10) {
    const hit = preferActive(list.filter((r) => normalizeGstin(r.gstin) === gstin));
    if (hit) return hit;
  }

  if (phone.length >= 10) {
    const hit = preferActive(list.filter((r) => phoneKey(r.mobile) === phone));
    if (hit) return hit;
  }

  if (name) {
    const sameName = list.filter((r) => normalizeName(r.name) === name);
    if (phone.length >= 8) {
      const withPhone = preferActive(sameName.filter((r) => !phoneKey(r.mobile) || phoneKey(r.mobile) === phone));
      if (withPhone) return withPhone;
    }
    if (email.includes("@")) {
      const withEmail = preferActive(sameName.filter((r) => String(r.email ?? "").trim().toLowerCase() === email));
      if (withEmail) return withEmail;
    }
    if (sameName.length === 1) return sameName[0];
  }

  return null;
}

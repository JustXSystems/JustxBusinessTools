/** Registry kinds are IMS-canonical. BOS uses "vendor" as an alias for "supplier". */

export const REGISTRY_PARTY_KINDS = ["customer", "supplier", "both"] as const;
export type RegistryPartyKind = (typeof REGISTRY_PARTY_KINDS)[number];

export const BOS_PARTY_KINDS = ["customer", "vendor", "both"] as const;
export type BosPartyKind = (typeof BOS_PARTY_KINDS)[number];

export function toRegistryKind(raw: string | null | undefined): RegistryPartyKind {
  const s = String(raw ?? "customer").trim().toLowerCase();
  if (s === "vendor" || s === "supplier") return "supplier";
  if (s === "both") return "both";
  if (s === "customer") return "customer";
  return "customer";
}

export function toBosKind(kind: RegistryPartyKind): BosPartyKind {
  if (kind === "supplier") return "vendor";
  return kind;
}

export function mergeKinds(a: RegistryPartyKind, b: RegistryPartyKind): RegistryPartyKind {
  if (a === b || a === "both") return a;
  if (b === "both") return "both";
  return "both";
}

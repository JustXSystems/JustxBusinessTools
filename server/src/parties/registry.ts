import { randomUUID } from "node:crypto";
import { mergeKinds, toBosKind, toRegistryKind, type RegistryPartyKind } from "./kinds.js";
import { findMatchingParty, normalizeGstin, phoneKey, type PartyMatchProbe } from "./match.js";
import { exec, one, rows, type PartyDb } from "./db.js";

export type RegistryPartyRow = {
  id: string;
  tenant_id: number;
  kind: string;
  name: string;
  company: string | null;
  contact_person: string | null;
  mobile: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  payment_terms_days: number | null;
  credit_limit: string | null;
  opening_balance: string;
  account_manager_id: number | null;
  account_manager_name: string | null;
  tags: string | null;
  notes: string | null;
  active: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

export type RegistryParty = {
  id: string;
  kind: RegistryPartyKind;
  name: string;
  company: string | null;
  contactPerson: string | null;
  mobile: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  paymentTermsDays: number | null;
  creditLimit: number | null;
  openingBalance: number;
  accountManagerId: number | null;
  accountManagerName: string | null;
  tags: string[];
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RegistryPartyUpsert = {
  kind?: RegistryPartyKind | string;
  name: string;
  company?: string | null;
  contactPerson?: string | null;
  mobile?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  pan?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  stateCode?: string | null;
  paymentTermsDays?: number | null;
  creditLimit?: number | null;
  openingBalance?: number | null;
  accountManagerId?: number | null;
  accountManagerName?: string | null;
  tags?: string[] | string | null;
  notes?: string | null;
  active?: boolean;
  /** Preserve a known UUID when creating (e.g. IMS / BOS projection). */
  id?: string;
  createdBy?: number | null;
  sourceTool?: string | null;
  sourceRef?: string | null;
};

const clip = (v: unknown, n: number): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, n) : null;
};

const money = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const tagsOf = (v: string | null): string[] =>
  String(v ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

const tagsToDb = (v: string[] | string | null | undefined): string | null => {
  if (v == null) return null;
  const list = Array.isArray(v)
    ? v
    : String(v)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
  const joined = [...new Set(list)].join(", ").slice(0, 255);
  return joined || null;
};

export function mapRegistryParty(r: RegistryPartyRow): RegistryParty {
  return {
    id: r.id,
    kind: toRegistryKind(r.kind),
    name: r.name,
    company: r.company,
    contactPerson: r.contact_person,
    mobile: r.mobile,
    email: r.email,
    gstin: r.gstin,
    pan: r.pan,
    address: r.address,
    city: r.city,
    state: r.state,
    stateCode: r.state_code,
    paymentTermsDays: r.payment_terms_days == null ? null : Number(r.payment_terms_days),
    creditLimit: r.credit_limit == null ? null : money(r.credit_limit),
    openingBalance: money(r.opening_balance),
    accountManagerId: r.account_manager_id == null ? null : Number(r.account_manager_id),
    accountManagerName: r.account_manager_name,
    tags: tagsOf(r.tags),
    notes: r.notes,
    active: Boolean(r.active),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function loadRegistryParty(db: PartyDb, tenantId: number, id: string): Promise<RegistryParty | null> {
  const r = await one<RegistryPartyRow>(db, `SELECT * FROM jbt_parties WHERE tenant_id = :tenantId AND id = :id LIMIT 1`, { tenantId, id });
  return r ? mapRegistryParty(r) : null;
}

export async function listRegistryParties(
  db: PartyDb,
  tenantId: number,
  opts: { kind?: "customer" | "supplier" | "both" | null; q?: string | null; includeInactive?: boolean; limit?: number } = {},
): Promise<RegistryParty[]> {
  const where = ["tenant_id = :tenantId"];
  const params: Record<string, unknown> = { tenantId };
  if (opts.kind === "supplier" || opts.kind === "customer") {
    where.push("kind IN (:kind, 'both')");
    params.kind = opts.kind;
  } else if (opts.kind === "both") {
    where.push("kind = 'both'");
  }
  if (!opts.includeInactive) where.push("active = 1");
  const q = clip(opts.q, 80);
  if (q) {
    where.push("(name LIKE :q OR company LIKE :q OR contact_person LIKE :q OR mobile LIKE :q OR gstin LIKE :q OR email LIKE :q OR city LIKE :q OR tags LIKE :q)");
    params.q = `%${q.replace(/[%_]/g, "")}%`;
  }
  const limit = Math.min(Math.max(opts.limit ?? 5000, 1), 20000);
  const list = await rows<RegistryPartyRow>(
    db,
    `SELECT * FROM jbt_parties WHERE ${where.join(" AND ")} ORDER BY name LIMIT ${limit}`,
    params,
  );
  return list.map(mapRegistryParty);
}

async function recordOrigin(db: PartyDb, tenantId: number, partyId: string, sourceTool?: string | null, sourceRef?: string | null): Promise<void> {
  if (!sourceTool || !sourceRef) return;
  await exec(
    db,
    `INSERT IGNORE INTO jbt_party_origins (tenant_id, party_id, source_tool, source_ref)
     VALUES (:tenantId, :partyId, :sourceTool, :sourceRef)`,
    { tenantId, partyId, sourceTool: clip(sourceTool, 40), sourceRef: clip(sourceRef, 64) },
  );
}

/** Keep BOS projection row aligned (same UUID) for connectors and liftability. */
export async function syncBosPartyProjection(db: PartyDb, tenantId: number, partyId: string): Promise<void> {
  const party = await loadRegistryParty(db, tenantId, partyId);
  if (!party) return;
  try {
    await exec(
      db,
      `INSERT INTO bos_parties (
         id, tenant_id, kind, name, company, gstin, email, phone, address, city, state, notes, created_by, archived_at
       ) VALUES (
         :id, :tenantId, :kind, :name, :company, :gstin, :email, :phone, :address, :city, :state, :notes, NULL,
         IF(:active = 1, NULL, CURRENT_TIMESTAMP)
       )
       ON DUPLICATE KEY UPDATE
         kind = VALUES(kind),
         name = VALUES(name),
         company = VALUES(company),
         gstin = VALUES(gstin),
         email = VALUES(email),
         phone = VALUES(phone),
         address = VALUES(address),
         city = VALUES(city),
         state = VALUES(state),
         notes = VALUES(notes),
         archived_at = IF(:active = 1, NULL, COALESCE(archived_at, CURRENT_TIMESTAMP))`,
      {
        id: party.id,
        tenantId,
        kind: toBosKind(party.kind),
        name: party.name,
        company: party.company,
        gstin: party.gstin,
        email: party.email,
        phone: party.mobile,
        address: party.address,
        city: party.city,
        state: party.state,
        notes: party.notes,
        active: party.active ? 1 : 0,
      },
    );
  } catch {
    // BOS schema may be absent in slim environments — registry still works.
  }
}

async function findExisting(db: PartyDb, tenantId: number, probe: PartyMatchProbe): Promise<RegistryPartyRow | null> {
  const gstin = normalizeGstin(probe.gstin);
  if (gstin.length >= 10) {
    const byGstin = await one<RegistryPartyRow>(
      db,
      `SELECT * FROM jbt_parties WHERE tenant_id = :tenantId AND gstin = :gstin ORDER BY active DESC LIMIT 1`,
      { tenantId, gstin },
    );
    if (byGstin) return byGstin;
  }

  const candidates = await rows<RegistryPartyRow>(
    db,
    `SELECT * FROM jbt_parties
     WHERE tenant_id = :tenantId AND (LOWER(name) = LOWER(:name) OR mobile IS NOT NULL OR email IS NOT NULL)
     ORDER BY active DESC
     LIMIT 5000`,
    { tenantId, name: String(probe.name ?? "").trim() || "_" },
  );
  return findMatchingParty(
    candidates.map((r) => ({ ...r, active: r.active })),
    probe,
  );
}

/**
 * Create or merge a party into the registry (and BOS projection).
 * Fill-empty-only on merge so tool-specific richer data is not wiped by thinner imports.
 */
export async function upsertRegistryParty(
  db: PartyDb,
  tenantId: number,
  input: RegistryPartyUpsert,
): Promise<{ party: RegistryParty; created: boolean }> {
  const name = clip(input.name, 200) || "Party";
  const mobile = clip(input.mobile ?? input.phone, 40);
  const gstin = clip(input.gstin, 20)?.toUpperCase() ?? null;
  const kind = toRegistryKind(input.kind);
  const existing = await findExisting(db, tenantId, { name, mobile, phone: mobile, gstin, email: input.email });

  if (existing) {
    const nextKind = mergeKinds(toRegistryKind(existing.kind), kind);
    await exec(
      db,
      `UPDATE jbt_parties SET
         kind = :kind,
         company = COALESCE(NULLIF(company, ''), :company),
         contact_person = COALESCE(NULLIF(contact_person, ''), :contactPerson),
         mobile = COALESCE(NULLIF(mobile, ''), :mobile),
         email = COALESCE(NULLIF(email, ''), :email),
         gstin = COALESCE(NULLIF(gstin, ''), :gstin),
         pan = COALESCE(NULLIF(pan, ''), :pan),
         address = COALESCE(NULLIF(address, ''), :address),
         city = COALESCE(NULLIF(city, ''), :city),
         state = COALESCE(NULLIF(state, ''), :state),
         state_code = COALESCE(NULLIF(state_code, ''), :stateCode),
         notes = COALESCE(NULLIF(notes, ''), :notes),
         active = 1
       WHERE tenant_id = :tenantId AND id = :id`,
      {
        tenantId,
        id: existing.id,
        kind: nextKind,
        company: clip(input.company, 200),
        contactPerson: clip(input.contactPerson, 120),
        mobile,
        email: clip(input.email, 180),
        gstin,
        pan: clip(input.pan, 12)?.toUpperCase() ?? null,
        address: clip(input.address, 500),
        city: clip(input.city, 120),
        state: clip(input.state, 80),
        stateCode: clip(input.stateCode, 4),
        notes: clip(input.notes, 4000),
      },
    );
    await recordOrigin(db, tenantId, existing.id, input.sourceTool, input.sourceRef);
    await syncBosPartyProjection(db, tenantId, existing.id);
    return { party: (await loadRegistryParty(db, tenantId, existing.id))!, created: false };
  }

  const id = input.id && String(input.id).length <= 36 ? String(input.id) : randomUUID();
  await exec(
    db,
    `INSERT INTO jbt_parties (
       id, tenant_id, kind, name, company, contact_person, mobile, email, gstin, pan,
       address, city, state, state_code, payment_terms_days, credit_limit, opening_balance,
       account_manager_id, account_manager_name, tags, notes, active, created_by
     ) VALUES (
       :id, :tenantId, :kind, :name, :company, :contactPerson, :mobile, :email, :gstin, :pan,
       :address, :city, :state, :stateCode, :paymentTermsDays, :creditLimit, :openingBalance,
       :accountManagerId, :accountManagerName, :tags, :notes, :active, :createdBy
     )`,
    {
      id,
      tenantId,
      kind,
      name,
      company: clip(input.company, 200),
      contactPerson: clip(input.contactPerson, 120),
      mobile,
      email: clip(input.email, 180),
      gstin,
      pan: clip(input.pan, 12)?.toUpperCase() ?? null,
      address: clip(input.address, 500),
      city: clip(input.city, 120),
      state: clip(input.state, 80),
      stateCode: clip(input.stateCode, 4),
      paymentTermsDays: input.paymentTermsDays ?? null,
      creditLimit: input.creditLimit ?? null,
      openingBalance: input.openingBalance ?? 0,
      accountManagerId: input.accountManagerId ?? null,
      accountManagerName: clip(input.accountManagerName, 120),
      tags: tagsToDb(input.tags),
      notes: clip(input.notes, 4000),
      active: input.active === false ? 0 : 1,
      createdBy: input.createdBy ?? null,
    },
  );
  await recordOrigin(db, tenantId, id, input.sourceTool, input.sourceRef);
  await syncBosPartyProjection(db, tenantId, id);
  return { party: (await loadRegistryParty(db, tenantId, id))!, created: true };
}

export async function suggestRegistryParties(
  db: PartyDb,
  tenantId: number,
  query: string,
  opts: { kind?: "customer" | "supplier"; limit?: number } = {},
): Promise<RegistryParty[]> {
  const q = String(query ?? "").trim();
  if (q.length < 2) return [];
  return listRegistryParties(db, tenantId, {
    kind: opts.kind ?? "customer",
    q,
    limit: opts.limit ?? 12,
  });
}

/** Quote / BOS snapshot shape from a registry party. */
export function partyToCustomerSnapshot(party: RegistryParty): {
  name: string;
  company: string;
  address: string;
  city: string;
  state: string;
  gstin: string;
  phone: string;
  email: string;
} {
  return {
    name: party.name,
    company: party.company ?? "",
    address: party.address ?? "",
    city: party.city ?? "",
    state: party.state ?? "",
    gstin: party.gstin ?? "",
    phone: party.mobile ?? "",
    email: party.email ?? "",
  };
}

export function partyIdentityHint(party: { name?: string | null; mobile?: string | null; phone?: string | null; gstin?: string | null }): string {
  const phone = phoneKey(party.mobile ?? party.phone);
  const gstin = normalizeGstin(party.gstin);
  if (gstin) return `g:${gstin}`;
  if (phone) return `p:${phone}`;
  return `n:${String(party.name ?? "").trim().toLowerCase()}`;
}

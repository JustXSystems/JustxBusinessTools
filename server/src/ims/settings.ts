import type { Router } from "express";
import { z } from "zod";
import { isPlatformAdmin } from "../lib/platform-admin.js";
import { accessOf, actorOf, optText, parse, recordEvent, requirePerm, type ImsAccess, type ImsDeps } from "./context.js";
import { exec, json, money, one, tx, type Queryable } from "./db.js";
import { badRequest, forbidden, type ImsActor } from "./host.js";
import {
  BUSINESS_TYPES,
  DEFAULT_PERMISSIONS,
  exciseApplies,
  IMS_PERMISSIONS,
  IMS_ROLES,
  isImsRole,
  normalizePermissions,
  normalizeAgingBreaks,
  normalizeArPriorityThresholds,
  normalizeReminders,
  normalizeTaxonomy,
  permissionsFor,
  type ArPriorityThresholds,
  type ImsRole,
  type PermissionMatrix,
  type ReminderSettings,
  type Taxonomy,
  DEFAULT_AGING_BREAKS,
  DEFAULT_AP_DUE_SOON_DAYS,
  DEFAULT_AR_PRIORITY,
} from "./logic.js";
import { DEFAULT_BASE_CURRENCY, normalizeCurrencyCode, normalizeDunningSequences, DUNNING_TONES, MAX_DUNNING_LEVELS, type DunningLevel } from "./wave6-logic.js";

/** Canonical BOM document purposes (+ legacy aesthetic ids accepted on read). */
export const BOM_PAPER_PURPOSES = ["proposal", "executive", "technical", "field", "share"] as const;
export type BomPaperPurpose = (typeof BOM_PAPER_PURPOSES)[number];

export const BOM_PAPER_LEGACY_TEMPLATES = [
  "aether",
  "classic",
  "tiered",
  "epc",
  "aurora",
  "ledger",
  "atelier",
  "prism",
  "orbit",
  "forge",
  "nova",
  "folio",
] as const;

export const BOM_PAPER_TEMPLATES = [...BOM_PAPER_PURPOSES, ...BOM_PAPER_LEGACY_TEMPLATES] as const;
export type BomPaperTemplateId = BomPaperPurpose;

const PURPOSE_ALIAS: Record<string, BomPaperPurpose> = {
  proposal: "proposal",
  executive: "executive",
  technical: "technical",
  field: "field",
  share: "share",
  aether: "proposal",
  classic: "proposal",
  tiered: "proposal",
  aurora: "proposal",
  atelier: "proposal",
  prism: "proposal",
  nova: "proposal",
  orbit: "executive",
  epc: "technical",
  ledger: "technical",
  forge: "technical",
  folio: "share",
};

export function normalizeBomPaperTemplate(v: unknown): BomPaperPurpose {
  const s = String(v ?? "").trim().toLowerCase();
  return PURPOSE_ALIAS[s] ?? "proposal";
}

export const BOM_INDUSTRY_PACKS = ["general", "epc", "solar", "manufacturing", "services", "procurement"] as const;
export type BomIndustryPackId = (typeof BOM_INDUSTRY_PACKS)[number];

export function normalizeBomIndustryPack(v: unknown): BomIndustryPackId {
  const s = String(v ?? "").trim().toLowerCase();
  return (BOM_INDUSTRY_PACKS as readonly string[]).includes(s) ? (s as BomIndustryPackId) : "general";
}

export const BOM_PAPER_TONES = ["neutral", "bold", "editorial"] as const;
export type BomPaperTone = (typeof BOM_PAPER_TONES)[number];
export function normalizeBomPaperTone(v: unknown): BomPaperTone {
  const s = String(v ?? "").trim().toLowerCase();
  return (BOM_PAPER_TONES as readonly string[]).includes(s) ? (s as BomPaperTone) : "neutral";
}

export const BOM_PAPER_DENSITIES = ["compact", "comfort"] as const;
export type BomPaperDensity = (typeof BOM_PAPER_DENSITIES)[number];
export function normalizeBomPaperDensity(v: unknown): BomPaperDensity {
  const s = String(v ?? "").trim().toLowerCase();
  return (BOM_PAPER_DENSITIES as readonly string[]).includes(s) ? (s as BomPaperDensity) : "comfort";
}

const BOM_SCHEDULE_COLUMN_IDS = [
  "index",
  "item",
  "sku",
  "hsn",
  "make",
  "kind",
  "qty",
  "unit",
  "rate",
  "amount",
  "remarks",
] as const;
export type BomScheduleColumnId = (typeof BOM_SCHEDULE_COLUMN_IDS)[number];

/** Parse tenant schedule-column preference; empty → null (pack defaults). */
export function normalizeBomScheduleColumnsSetting(v: unknown): BomScheduleColumnId[] | null {
  const allowed = new Set<string>(BOM_SCHEDULE_COLUMN_IDS);
  let raw: unknown[] = [];
  if (Array.isArray(v)) raw = v;
  else if (typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) raw = parsed;
    } catch {
      raw = [];
    }
  } else if (v && typeof v === "object" && !Array.isArray(v)) {
    return null;
  }
  if (!raw.length) return null;
  const picked = new Set<BomScheduleColumnId>();
  for (const x of raw) {
    const id = String(x ?? "")
      .trim()
      .toLowerCase();
    if (allowed.has(id)) picked.add(id as BomScheduleColumnId);
  }
  picked.add("item");
  picked.add("qty");
  const out = BOM_SCHEDULE_COLUMN_IDS.filter((c) => picked.has(c));
  return out.length ? out : null;
}

export type ImsSettings = {
  businessName: string;
  businessType: string;
  gstin: string | null;
  /** ISO-4217 base currency for documents and reports (default INR). Foreign documents lock an FX rate against it. */
  baseCurrency: string;
  state: string | null;
  stateCode: string | null;
  address: string | null;
  phone: string | null;
  /** UPI VPA printed as payment QR on issued tax invoices. */
  bankUpi: string | null;
  bankAccountName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  msmeRegistered: boolean;
  msmeUdyam: string | null;
  email: string | null;
  fiscalYearStart: number;
  poPrefix: string;
  invoicePrefix: string;
  cnPrefix: string;
  dnPrefix: string;
  proformaPrefix: string;
  retainerPrefix: string;
  soPrefix: string;
  soDcPrefix: string;
  billPrefix: string;
  returnPrefix: string;
  checkPrefix: string;
  ticketPrefix: string;
  bomPrefix: string;
  bomDcPrefix: string;
  bomDcReturnPrefix: string;
  /** Default BOM document purpose for live preview + print/PDF. */
  bomPaperTemplate: BomPaperTemplateId;
  bomIndustryPack: BomIndustryPackId;
  bomPaperTone: BomPaperTone;
  bomPaperDensity: BomPaperDensity;
  bomHideMargin: boolean;
  /** When true, confirming a BOM requires the Approvals permission (owners always can). */
  bomConfirmNeedsApproval: boolean;
  /** When true, quotation reference is required before confirming a BOM. */
  bomRequireQuotationRef: boolean;
  /** Null = use industry-pack column defaults. */
  bomScheduleColumns: BomScheduleColumnId[] | null;
  poApprovalLimit: number;
  /** 0 = no invoice approval. At/above this grand total, Save & issue queues for Approvals. */
  invoiceApprovalLimit: number;
  /** Multi-level dunning letters (L1 → L3 by days overdue). Never empty. */
  dunningSequences: DunningLevel[];
  draftPoPurgeDays: number;
  paymentTermsDays: number;
  defaultGstRate: number;
  allowNegativeStock: boolean;
  /** Max invoices included in a Sales “Print pack” batch. */
  printPackMax: number;
  /** Max upload size for invoice/bill/audit attachments (bytes). */
  attachmentMaxBytes: number;
  /** Four ascending day caps for AR/stock aging buckets (fifth is open-ended). */
  agingBreaks: number[];
  arPriority: ArPriorityThresholds;
  /** Payables “due soon” window in days. */
  apDueSoonDays: number;
  exciseEnabled: boolean;
  /** Derived: excise register is shown (enabled or a liquor / bar business type). */
  exciseActive: boolean;
  permissions: PermissionMatrix;
  taxonomy: Taxonomy;
  reminders: ReminderSettings;
  terms: string | null;
};

type SettingsRow = {
  business_name: string | null;
  business_type: string;
  gstin: string | null;
  base_currency?: string | null;
  state: string | null;
  state_code: string | null;
  address: string | null;
  phone: string | null;
  bank_upi?: string | null;
  bank_account_name?: string | null;
  bank_account_no?: string | null;
  bank_ifsc?: string | null;
  bank_name?: string | null;
  msme_registered?: number | boolean | null;
  msme_udyam?: string | null;
  email: string | null;
  fiscal_year_start: number;
  po_prefix: string;
  invoice_prefix: string;
  cn_prefix?: string;
  dn_prefix?: string;
  proforma_prefix?: string;
  retainer_prefix?: string;
  so_prefix?: string;
  so_dc_prefix?: string;
  bill_prefix: string;
  return_prefix: string;
  check_prefix: string;
  ticket_prefix: string;
  bom_prefix?: string | null;
  bom_dc_prefix?: string | null;
  bom_dc_return_prefix?: string | null;
  bom_paper_template?: string | null;
  bom_industry_pack?: string | null;
  bom_paper_tone?: string | null;
  bom_paper_density?: string | null;
  bom_hide_margin?: number | boolean | null;
  bom_confirm_needs_approval?: number | boolean | null;
  bom_require_quotation_ref?: number | boolean | null;
  bom_schedule_columns_json?: unknown;
  po_approval_limit: string | number;
  invoice_approval_limit?: string | number;
  dunning_sequences?: unknown;
  draft_po_purge_days: number;
  payment_terms_days: number;
  default_gst_rate: string | number;
  allow_negative_stock: number;
  print_pack_max?: number | null;
  attachment_max_bytes?: number | null;
  aging_breaks?: unknown;
  ar_priority_critical_days?: number | null;
  ar_priority_high_days?: number | null;
  ar_priority_medium_days?: number | null;
  ap_due_soon_days?: number | null;
  excise_enabled: number;
  permissions: unknown;
  taxonomy: unknown;
  reminders: unknown;
  terms: string | null;
};

const mapSettings = (r: SettingsRow): ImsSettings => ({
  businessName: r.business_name ?? "",
  businessType: r.business_type || "distributor",
  gstin: r.gstin,
  baseCurrency: normalizeCurrencyCode(r.base_currency, DEFAULT_BASE_CURRENCY),
  state: r.state,
  stateCode: r.state_code,
  address: r.address,
  phone: r.phone,
  bankUpi: r.bank_upi ?? null,
  bankAccountName: r.bank_account_name ?? null,
  bankAccountNo: r.bank_account_no ?? null,
  bankIfsc: r.bank_ifsc ?? null,
  bankName: r.bank_name ?? null,
  msmeRegistered: Boolean(r.msme_registered),
  msmeUdyam: r.msme_udyam ?? null,
  email: r.email,
  fiscalYearStart: Number(r.fiscal_year_start) || 4,
  poPrefix: r.po_prefix,
  invoicePrefix: r.invoice_prefix,
  cnPrefix: r.cn_prefix || "CN",
  dnPrefix: r.dn_prefix || "DN",
  proformaPrefix: r.proforma_prefix || "PF",
  retainerPrefix: r.retainer_prefix || "RA",
  soPrefix: r.so_prefix || "SO",
  soDcPrefix: r.so_dc_prefix || "SODC",
  billPrefix: r.bill_prefix,
  returnPrefix: r.return_prefix,
  checkPrefix: r.check_prefix,
  ticketPrefix: r.ticket_prefix,
  bomPrefix: r.bom_prefix || "BOM",
  bomDcPrefix: r.bom_dc_prefix || "DC",
  bomDcReturnPrefix: r.bom_dc_return_prefix || "RTN",
  bomPaperTemplate: normalizeBomPaperTemplate(r.bom_paper_template),
  bomIndustryPack: normalizeBomIndustryPack(r.bom_industry_pack),
  bomPaperTone: normalizeBomPaperTone(r.bom_paper_tone),
  bomPaperDensity: normalizeBomPaperDensity(r.bom_paper_density),
  bomHideMargin: Boolean(r.bom_hide_margin),
  bomConfirmNeedsApproval: Boolean(r.bom_confirm_needs_approval),
  bomRequireQuotationRef: Boolean(r.bom_require_quotation_ref),
  bomScheduleColumns: normalizeBomScheduleColumnsSetting(r.bom_schedule_columns_json),
  poApprovalLimit: money(r.po_approval_limit),
  invoiceApprovalLimit: money(r.invoice_approval_limit ?? 0),
  dunningSequences: normalizeDunningSequences(r.dunning_sequences),
  draftPoPurgeDays: Number(r.draft_po_purge_days) || 0,
  paymentTermsDays: Number(r.payment_terms_days) || 0,
  defaultGstRate: money(r.default_gst_rate),
  allowNegativeStock: Boolean(r.allow_negative_stock),
  printPackMax: Math.max(1, Math.min(200, Number(r.print_pack_max) || 25)),
  attachmentMaxBytes: Math.max(256 * 1024, Math.min(20 * 1024 * 1024, Number(r.attachment_max_bytes) || 2 * 1024 * 1024)),
  agingBreaks: normalizeAgingBreaks(r.aging_breaks ?? DEFAULT_AGING_BREAKS),
  arPriority: normalizeArPriorityThresholds({
    critical: r.ar_priority_critical_days ?? DEFAULT_AR_PRIORITY.critical,
    high: r.ar_priority_high_days ?? DEFAULT_AR_PRIORITY.high,
    medium: r.ar_priority_medium_days ?? DEFAULT_AR_PRIORITY.medium,
  }),
  apDueSoonDays: Math.max(1, Math.min(365, Number(r.ap_due_soon_days) || DEFAULT_AP_DUE_SOON_DAYS)),
  exciseEnabled: Boolean(r.excise_enabled),
  exciseActive: exciseApplies(r.business_type, Boolean(r.excise_enabled)),
  permissions: normalizePermissions(json(r.permissions, {})),
  taxonomy: normalizeTaxonomy(json(r.taxonomy, {})),
  reminders: normalizeReminders(json(r.reminders, {})),
  terms: r.terms,
});

const SELECT_SETTINGS = `SELECT * FROM ims_settings WHERE tenant_id = :tenantId LIMIT 1`;

/** Settings for a tenant, seeded from the host brand (business profile) on first use. */
export async function getSettings(deps: ImsDeps, tenantId: number, db: Queryable = deps.db): Promise<ImsSettings> {
  const existing = await one<SettingsRow>(db, SELECT_SETTINGS, { tenantId });
  if (existing) return mapSettings(existing);
  const brand = await deps.host.brand(tenantId).catch(() => null);
  await exec(
    db,
    `INSERT IGNORE INTO ims_settings (tenant_id, business_name, gstin, state, state_code, address, email, phone)
     VALUES (:tenantId, :name, :gstin, :state, :stateCode, :address, :email, :phone)`,
    {
      tenantId,
      name: brand?.name || null,
      gstin: brand?.gstin ?? null,
      state: brand?.state ?? null,
      stateCode: brand?.stateCode ?? null,
      address: brand?.address ?? null,
      email: brand?.email ?? null,
      phone: brand?.phone ?? null,
    },
  );
  return mapSettings((await one<SettingsRow>(db, SELECT_SETTINGS, { tenantId }))!);
}

const prefix = z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9-]+$/, "Letters, digits and dashes only");

const SettingsInput = z.object({
  businessName: z.string().trim().max(200).optional(),
  businessType: z.enum(BUSINESS_TYPES.map((b) => b.key) as [string, ...string[]]).optional(),
  gstin: optText(20),
  baseCurrency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Use a 3-letter ISO currency code (e.g. INR, USD)")
    .optional(),
  state: optText(80),
  stateCode: optText(4),
  address: optText(500),
  phone: optText(40),
  bankUpi: optText(80),
  bankAccountName: optText(120),
  bankAccountNo: optText(40),
  bankIfsc: optText(20),
  bankName: optText(120),
  msmeRegistered: z.boolean().optional(),
  msmeUdyam: optText(32),
  email: optText(180),
  fiscalYearStart: z.coerce.number().int().min(1).max(12).optional(),
  poPrefix: prefix.optional(),
  invoicePrefix: prefix.optional(),
  cnPrefix: prefix.optional(),
  dnPrefix: prefix.optional(),
  proformaPrefix: prefix.optional(),
  retainerPrefix: prefix.optional(),
  soPrefix: prefix.optional(),
  soDcPrefix: prefix.optional(),
  billPrefix: prefix.optional(),
  returnPrefix: prefix.optional(),
  checkPrefix: prefix.optional(),
  ticketPrefix: prefix.optional(),
  bomPrefix: prefix.optional(),
  bomDcPrefix: prefix.optional(),
  bomDcReturnPrefix: prefix.optional(),
  bomPaperTemplate: z.enum(BOM_PAPER_TEMPLATES).optional(),
  bomIndustryPack: z.enum(BOM_INDUSTRY_PACKS).optional(),
  bomPaperTone: z.enum(BOM_PAPER_TONES).optional(),
  bomPaperDensity: z.enum(BOM_PAPER_DENSITIES).optional(),
  bomHideMargin: z.boolean().optional(),
  bomConfirmNeedsApproval: z.boolean().optional(),
  bomRequireQuotationRef: z.boolean().optional(),
  bomScheduleColumns: z.array(z.enum(BOM_SCHEDULE_COLUMN_IDS)).max(16).nullable().optional(),
  poApprovalLimit: z.coerce.number().min(0).max(1e12).optional(),
  invoiceApprovalLimit: z.coerce.number().min(0).max(1e12).optional(),
  dunningSequences: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(24),
        label: z.string().trim().max(80),
        minDaysOverdue: z.coerce.number().int().min(0).max(3650),
        tone: z.enum(DUNNING_TONES),
      }),
    )
    .min(1, "Keep at least one dunning level")
    .max(MAX_DUNNING_LEVELS)
    .optional(),
  draftPoPurgeDays: z.coerce.number().int().min(0).max(365).optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  defaultGstRate: z.coerce.number().min(0).max(100).optional(),
  allowNegativeStock: z.boolean().optional(),
  printPackMax: z.coerce.number().int().min(1).max(200).optional(),
  attachmentMaxBytes: z.coerce.number().int().min(256 * 1024).max(20 * 1024 * 1024).optional(),
  agingBreaks: z.array(z.coerce.number().int().min(1).max(3650)).length(4).optional(),
  arPriority: z
    .object({
      critical: z.coerce.number().int().min(2).max(3650),
      high: z.coerce.number().int().min(1).max(3650),
      medium: z.coerce.number().int().min(1).max(3650),
    })
    .optional(),
  apDueSoonDays: z.coerce.number().int().min(1).max(365).optional(),
  exciseEnabled: z.boolean().optional(),
  permissions: z.record(z.string(), z.record(z.string(), z.boolean())).optional(),
  taxonomy: z.record(z.string(), z.unknown()).optional(),
  reminders: z.record(z.string(), z.unknown()).optional(),
  terms: optText(4000),
});

const COLUMN: Record<string, string> = {
  businessName: "business_name",
  businessType: "business_type",
  gstin: "gstin",
  baseCurrency: "base_currency",
  state: "state",
  stateCode: "state_code",
  address: "address",
  phone: "phone",
  bankUpi: "bank_upi",
  bankAccountName: "bank_account_name",
  bankAccountNo: "bank_account_no",
  bankIfsc: "bank_ifsc",
  bankName: "bank_name",
  msmeRegistered: "msme_registered",
  msmeUdyam: "msme_udyam",
  email: "email",
  fiscalYearStart: "fiscal_year_start",
  poPrefix: "po_prefix",
  invoicePrefix: "invoice_prefix",
  cnPrefix: "cn_prefix",
  dnPrefix: "dn_prefix",
  proformaPrefix: "proforma_prefix",
  retainerPrefix: "retainer_prefix",
  soPrefix: "so_prefix",
  soDcPrefix: "so_dc_prefix",
  billPrefix: "bill_prefix",
  returnPrefix: "return_prefix",
  checkPrefix: "check_prefix",
  ticketPrefix: "ticket_prefix",
  bomPrefix: "bom_prefix",
  bomDcPrefix: "bom_dc_prefix",
  bomDcReturnPrefix: "bom_dc_return_prefix",
  bomPaperTemplate: "bom_paper_template",
  bomIndustryPack: "bom_industry_pack",
  bomPaperTone: "bom_paper_tone",
  bomPaperDensity: "bom_paper_density",
  bomHideMargin: "bom_hide_margin",
  bomConfirmNeedsApproval: "bom_confirm_needs_approval",
  bomRequireQuotationRef: "bom_require_quotation_ref",
  bomScheduleColumns: "bom_schedule_columns_json",
  poApprovalLimit: "po_approval_limit",
  invoiceApprovalLimit: "invoice_approval_limit",
  dunningSequences: "dunning_sequences",
  draftPoPurgeDays: "draft_po_purge_days",
  paymentTermsDays: "payment_terms_days",
  defaultGstRate: "default_gst_rate",
  allowNegativeStock: "allow_negative_stock",
  printPackMax: "print_pack_max",
  attachmentMaxBytes: "attachment_max_bytes",
  agingBreaks: "aging_breaks",
  apDueSoonDays: "ap_due_soon_days",
  exciseEnabled: "excise_enabled",
  permissions: "permissions",
  taxonomy: "taxonomy",
  reminders: "reminders",
  terms: "terms",
};

export async function updateSettings(deps: ImsDeps, actor: ImsActor, body: unknown): Promise<ImsSettings> {
  await getSettings(deps, actor.tenantId);
  const input = parse(SettingsInput, body) as Record<string, unknown>;
  const sets: string[] = [];
  const params: Record<string, unknown> = { tenantId: actor.tenantId, updatedBy: actor.userId };
  if (input.arPriority !== undefined) {
    const t = normalizeArPriorityThresholds(input.arPriority as ArPriorityThresholds);
    sets.push("ar_priority_critical_days = :arPriorityCritical", "ar_priority_high_days = :arPriorityHigh", "ar_priority_medium_days = :arPriorityMedium");
    params.arPriorityCritical = t.critical;
    params.arPriorityHigh = t.high;
    params.arPriorityMedium = t.medium;
    delete input.arPriority;
  }
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || !COLUMN[key]) continue;
    let v: unknown = value;
    if (key === "permissions") v = JSON.stringify(normalizePermissions(value));
    else if (key === "taxonomy") v = JSON.stringify(normalizeTaxonomy(value));
    else if (key === "reminders") v = JSON.stringify(normalizeReminders(value));
    else if (key === "baseCurrency") v = normalizeCurrencyCode(value);
    else if (key === "dunningSequences") v = JSON.stringify(normalizeDunningSequences(value));
    else if (key === "agingBreaks") v = JSON.stringify(normalizeAgingBreaks(value));
    else if (key === "bomPaperTemplate") v = normalizeBomPaperTemplate(value);
    else if (key === "bomIndustryPack") v = normalizeBomIndustryPack(value);
    else if (key === "bomPaperTone") v = normalizeBomPaperTone(value);
    else if (key === "bomPaperDensity") v = normalizeBomPaperDensity(value);
    else if (key === "bomScheduleColumns") {
      const cols = normalizeBomScheduleColumnsSetting(value);
      v = cols ? JSON.stringify(cols) : null;
    } else if (typeof value === "boolean") v = value ? 1 : 0;
    else if (typeof value === "string" && key.endsWith("Prefix")) v = value.toUpperCase();
    sets.push(`${COLUMN[key]} = :${key}`);
    params[key] = v;
  }
  if (sets.length) {
    await exec(deps.db, `UPDATE ims_settings SET ${sets.join(", ")}, updated_by = :updatedBy WHERE tenant_id = :tenantId`, params);
    await recordEvent(deps, actor, { type: "settings.updated", entityType: "settings", entityId: String(actor.tenantId), summary: "Updated IMS settings", payload: { fields: Object.keys(input) } });
  }
  return getSettings(deps, actor.tenantId);
}

/* ---------- Access ---------- */

/**
 * The caller's IMS role and permissions. Platform owners / admins / single-user installs are IMS owners;
 * platform viewers are IMS viewers; everyone else takes their `ims_members` role (staff by default).
 */
export async function resolveAccess(deps: ImsDeps, actor: ImsActor): Promise<ImsAccess> {
  const settings = await getSettings(deps, actor.tenantId);
  let role: ImsRole;
  if (actor.role === "owner" || actor.role === "admin" || actor.role === "legacy") role = "owner";
  else if (actor.role === "viewer") role = "viewer";
  else {
    const member = actor.userId
      ? await one<{ ims_role: string; active: number }>(deps.db, `SELECT ims_role, active FROM ims_members WHERE tenant_id = :tenantId AND user_id = :userId LIMIT 1`, {
          tenantId: actor.tenantId,
          userId: actor.userId,
        })
      : null;
    role = member && member.active && isImsRole(member.ims_role) && member.ims_role !== "owner" ? member.ims_role : member?.ims_role === "owner" ? "manager" : "staff";
  }
  return { role, perms: new Set(permissionsFor(role, settings.permissions)) };
}

/* ---------- Team (IMS roles per user) ---------- */

export type ImsMember = {
  userId: number;
  name: string | null;
  email: string | null;
  platformRole: string;
  imsRole: ImsRole;
  phone: string | null;
  isAccountManager: boolean;
  active: boolean;
  /** Owners and admins are always IMS owners; their role isn't editable here. */
  locked: boolean;
};

export async function listMembers(deps: ImsDeps, actor: ImsActor): Promise<ImsMember[]> {
  const users = await deps.host.users(actor).catch(() => []);
  const rowsById = new Map<number, { ims_role: string; display_name: string | null; phone: string | null; is_account_manager: number; active: number }>();
  const [result] = await deps.db.query(`SELECT user_id, ims_role, display_name, phone, is_account_manager, active FROM ims_members WHERE tenant_id = :tenantId`, { tenantId: actor.tenantId });
  for (const r of (Array.isArray(result) ? result : []) as Array<{ user_id: number; ims_role: string; display_name: string | null; phone: string | null; is_account_manager: number; active: number }>) {
    rowsById.set(Number(r.user_id), r);
  }
  return users.map((u) => {
    const locked = u.role === "owner" || u.role === "admin" || u.role === "legacy";
    const row = rowsById.get(u.userId);
    const imsRole: ImsRole = locked ? "owner" : u.role === "viewer" ? "viewer" : row && isImsRole(row.ims_role) && row.ims_role !== "owner" ? row.ims_role : "staff";
    return {
      userId: u.userId,
      name: row?.display_name || u.name,
      email: u.email,
      platformRole: u.role,
      imsRole,
      phone: row?.phone ?? null,
      isAccountManager: Boolean(row?.is_account_manager),
      active: row ? Boolean(row.active) : true,
      locked,
    };
  });
}

const MemberInput = z.object({
  imsRole: z.enum(IMS_ROLES.filter((r) => r !== "owner") as [ImsRole, ...ImsRole[]]).optional(),
  phone: optText(40),
  displayName: optText(120),
  isAccountManager: z.boolean().optional(),
  active: z.boolean().optional(),
});

const ClearOperationalInput = z.object({
  /** Must match the tenant business name (case-insensitive). */
  confirmName: z.string().trim().min(1).max(200),
});

/**
 * Never delete or update these — Quotation V1 (and other non-IMS tools) own them.
 * Live customer quotes for orgs such as Zigma Technologies live in document_records,
 * not in ims_* tables. Clear operational data must never touch this surface.
 */
const QUOTATION_AND_OUTSIDE_IMS_NEVER_TOUCH = [
  "document_records",
  "quotation_followup_reminders",
  "platform_config",
  "business_profiles",
  "profile_tool_licenses",
] as const;

/** Only `DELETE FROM ims_<table> WHERE tenant_id = :tenantId` is allowed. */
const CLEAR_SQL_RE = /^DELETE FROM (ims_[a-z0-9_]+) WHERE tenant_id = :tenantId$/i;

/**
 * Child-first wipe of every IMS-created row for a fresh module load.
 * Preserves settings, team (JBT user links), and integration connection config.
 * Never touches Quotation V1 / document_records / other tools outside IMS.
 */
const CLEAR_TABLES: ReadonlyArray<{ key: string; sql: string }> = [
  { key: "events", sql: "DELETE FROM ims_events WHERE tenant_id = :tenantId" },
  { key: "syncLog", sql: "DELETE FROM ims_sync_log WHERE tenant_id = :tenantId" },
  { key: "arActivity", sql: "DELETE FROM ims_ar_activity WHERE tenant_id = :tenantId" },
  { key: "documents", sql: "DELETE FROM ims_documents WHERE tenant_id = :tenantId" },
  { key: "auditItems", sql: "DELETE FROM ims_audit_items WHERE tenant_id = :tenantId" },
  { key: "bankTxns", sql: "DELETE FROM ims_bank_txns WHERE tenant_id = :tenantId" },
  { key: "payments", sql: "DELETE FROM ims_payments WHERE tenant_id = :tenantId" },
  { key: "paymentRuns", sql: "DELETE FROM ims_payment_runs WHERE tenant_id = :tenantId" },
  { key: "ledgerEntries", sql: "DELETE FROM ims_ledger_entries WHERE tenant_id = :tenantId" },
  { key: "expenses", sql: "DELETE FROM ims_expenses WHERE tenant_id = :tenantId" },
  { key: "dailyClosings", sql: "DELETE FROM ims_daily_closings WHERE tenant_id = :tenantId" },
  { key: "dunningRuns", sql: "DELETE FROM ims_dunning_runs WHERE tenant_id = :tenantId" },
  { key: "installmentSchedule", sql: "DELETE FROM ims_installment_schedule WHERE tenant_id = :tenantId" },
  { key: "installmentPlans", sql: "DELETE FROM ims_installment_plans WHERE tenant_id = :tenantId" },
  { key: "invoiceDcLinks", sql: "DELETE FROM ims_invoice_dc_links WHERE tenant_id = :tenantId" },
  { key: "invoiceSoDcLinks", sql: "DELETE FROM ims_invoice_so_dc_links WHERE tenant_id = :tenantId" },
  { key: "soDcs", sql: "DELETE FROM ims_so_dcs WHERE tenant_id = :tenantId" },
  { key: "salesOrders", sql: "DELETE FROM ims_sales_orders WHERE tenant_id = :tenantId" },
  { key: "bomDcReturnLines", sql: "DELETE FROM ims_bom_dc_return_lines WHERE tenant_id = :tenantId" },
  { key: "bomDcReturns", sql: "DELETE FROM ims_bom_dc_returns WHERE tenant_id = :tenantId" },
  { key: "bomDcLines", sql: "DELETE FROM ims_bom_dc_lines WHERE tenant_id = :tenantId" },
  { key: "bomDcs", sql: "DELETE FROM ims_bom_dcs WHERE tenant_id = :tenantId" },
  { key: "bomPdfBlobs", sql: "DELETE FROM ims_bom_pdf_blobs WHERE tenant_id = :tenantId" },
  { key: "bomDocLines", sql: "DELETE FROM ims_bom_doc_lines WHERE tenant_id = :tenantId" },
  { key: "bomDocs", sql: "DELETE FROM ims_bom_docs WHERE tenant_id = :tenantId" },
  { key: "bomRevisions", sql: "DELETE FROM ims_bom_revisions WHERE tenant_id = :tenantId" },
  { key: "bomRateCardLines", sql: "DELETE FROM ims_bom_rate_card_lines WHERE tenant_id = :tenantId" },
  { key: "bomRateCards", sql: "DELETE FROM ims_bom_rate_cards WHERE tenant_id = :tenantId" },
  { key: "bomPackageLines", sql: "DELETE FROM ims_bom_package_lines WHERE tenant_id = :tenantId" },
  { key: "bomPackages", sql: "DELETE FROM ims_bom_packages WHERE tenant_id = :tenantId" },
  { key: "movements", sql: "DELETE FROM ims_movements WHERE tenant_id = :tenantId" },
  { key: "returns", sql: "DELETE FROM ims_returns WHERE tenant_id = :tenantId" },
  { key: "stockChecks", sql: "DELETE FROM ims_stock_checks WHERE tenant_id = :tenantId" },
  { key: "invoices", sql: "DELETE FROM ims_invoices WHERE tenant_id = :tenantId" },
  { key: "bills", sql: "DELETE FROM ims_bills WHERE tenant_id = :tenantId" },
  { key: "purchaseOrders", sql: "DELETE FROM ims_purchase_orders WHERE tenant_id = :tenantId" },
  { key: "fieldVisits", sql: "DELETE FROM ims_field_visits WHERE tenant_id = :tenantId" },
  { key: "fieldCheckins", sql: "DELETE FROM ims_field_checkins WHERE tenant_id = :tenantId" },
  { key: "fieldTasks", sql: "DELETE FROM ims_field_tasks WHERE tenant_id = :tenantId" },
  { key: "exciseRecords", sql: "DELETE FROM ims_excise_records WHERE tenant_id = :tenantId" },
  { key: "reports", sql: "DELETE FROM ims_reports WHERE tenant_id = :tenantId" },
  { key: "tickets", sql: "DELETE FROM ims_tickets WHERE tenant_id = :tenantId" },
  { key: "links", sql: "DELETE FROM ims_links WHERE tenant_id = :tenantId" },
  { key: "items", sql: "DELETE FROM ims_items WHERE tenant_id = :tenantId" },
  { key: "parties", sql: "DELETE FROM ims_parties WHERE tenant_id = :tenantId" },
  { key: "sequences", sql: "DELETE FROM ims_sequences WHERE tenant_id = :tenantId" },
];

function assertClearTablesAreImsOnly(): void {
  const blocked = new Set(QUOTATION_AND_OUTSIDE_IMS_NEVER_TOUCH.map((t) => t.toLowerCase()));
  for (const step of CLEAR_TABLES) {
    const m = CLEAR_SQL_RE.exec(step.sql.trim());
    if (!m) {
      throw new Error(`IMS clear refused unsafe SQL for “${step.key}” — only DELETE FROM ims_* is allowed`);
    }
    const table = m[1]!.toLowerCase();
    if (blocked.has(table) || !table.startsWith("ims_")) {
      throw new Error(`IMS clear refused table “${table}” — Quotation / non-IMS data must never be touched`);
    }
  }
}

assertClearTablesAreImsOnly();

export type ClearOperationalResult = {
  businessName: string;
  deleted: Record<string, number>;
  sequencesCleared: number;
};

/**
 * Platform-admin wipe of all IMS-created data for the active business profile.
 * Quotation V1 records (document_records / platform_config / reminders) are never modified.
 */
export async function clearOperationalData(deps: ImsDeps, actor: ImsActor, confirmName: string): Promise<ClearOperationalResult> {
  if (!isPlatformAdmin()) throw forbidden("Only a JBT Super Admin can clear IMS operational data");
  const settings = await getSettings(deps, actor.tenantId);
  const expected = settings.businessName.trim().toLowerCase();
  if (!expected || confirmName.trim().toLowerCase() !== expected) {
    throw badRequest(`Type the business name exactly to confirm (currently “${settings.businessName || "—"}”)`);
  }

  const deleted: Record<string, number> = {};
  const result = await tx(deps.db, async (conn) => {
    for (const step of CLEAR_TABLES) {
      try {
        const res = await exec(conn, step.sql, { tenantId: actor.tenantId });
        deleted[step.key] = Number(res.affectedRows ?? 0);
      } catch (err) {
        // Older deploys may lack BOM/DC/submodule tables — skip missing relations.
        const e = err as { code?: string; errno?: number };
        if (e.code === "ER_NO_SUCH_TABLE" || e.errno === 1146) {
          deleted[step.key] = 0;
          continue;
        }
        throw err;
      }
    }

    return {
      businessName: settings.businessName,
      deleted,
      sequencesCleared: deleted.sequences ?? 0,
    };
  });

  await recordEvent(deps, actor, {
    type: "settings.clear_operational",
    entityType: "settings",
    entityId: String(actor.tenantId),
    summary: `Cleared all IMS module data for ${result.businessName}`,
    payload: result,
  });
  await deps.host.audit(actor, "settings.clear_operational", "tenant", String(actor.tenantId), result).catch(() => undefined);

  return result;
}

export function registerSettings(router: Router, deps: ImsDeps): void {
  router.get("/settings", async (_req, res) => {
    const actor = actorOf(res);
    res.json({ settings: await getSettings(deps, actor.tenantId), businessTypes: BUSINESS_TYPES, permissionKeys: IMS_PERMISSIONS, roles: IMS_ROLES, defaults: DEFAULT_PERMISSIONS });
  });

  router.put("/settings", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "settings");
    res.json({ settings: await updateSettings(deps, actor, req.body) });
  });

  router.post("/settings/clear-operational", async (req, res) => {
    const actor = actorOf(res);
    if (!isPlatformAdmin()) throw forbidden("Only a JBT Super Admin can clear IMS operational data");
    const input = parse(ClearOperationalInput, req.body);
    res.json(await clearOperationalData(deps, actor, input.confirmName));
  });

  router.get("/team", async (_req, res) => {
    const actor = actorOf(res);
    res.json({ members: await listMembers(deps, actor), canManage: accessOf(res).perms.has("settings") });
  });

  router.put("/team/:userId", async (req, res) => {
    const actor = actorOf(res);
    requirePerm(res, "settings");
    const userId = Number(req.params.userId);
    const users = await deps.host.users(actor);
    const target = users.find((u) => u.userId === userId);
    if (!target) {
      res.status(404).json({ error: "That person isn't a member of this business" });
      return;
    }
    if (target.role === "owner" || target.role === "admin") {
      res.status(400).json({ error: "Owners and admins always have full IMS access" });
      return;
    }
    const input = parse(MemberInput, req.body);
    await exec(
      deps.db,
      `INSERT INTO ims_members (tenant_id, user_id, display_name, ims_role, phone, is_account_manager, active)
       VALUES (:tenantId, :userId, :displayName, :imsRole, :phone, :am, :active)
       ON DUPLICATE KEY UPDATE
         display_name = COALESCE(:displayName, display_name),
         ims_role = COALESCE(:imsRoleSet, ims_role),
         phone = COALESCE(:phone, phone),
         is_account_manager = COALESCE(:amSet, is_account_manager),
         active = COALESCE(:activeSet, active)`,
      {
        tenantId: actor.tenantId,
        userId,
        displayName: input.displayName ?? null,
        imsRole: input.imsRole ?? "staff",
        imsRoleSet: input.imsRole ?? null,
        phone: input.phone ?? null,
        am: input.isAccountManager ? 1 : 0,
        amSet: input.isAccountManager === undefined ? null : input.isAccountManager ? 1 : 0,
        active: input.active === false ? 0 : 1,
        activeSet: input.active === undefined ? null : input.active ? 1 : 0,
      },
    );
    await recordEvent(deps, actor, {
      type: "team.updated",
      entityType: "member",
      entityId: String(userId),
      summary: `Updated IMS access for ${target.name ?? target.email ?? `user ${userId}`}`,
      payload: input,
    });
    res.json({ members: await listMembers(deps, actor) });
  });
}

import type { Router } from "express";
import { z } from "zod";
import { accessOf, actorOf, optText, parse, recordEvent, requirePerm, type ImsAccess, type ImsDeps } from "./context.js";
import { exec, json, money, one, type Queryable } from "./db.js";
import type { ImsActor } from "./host.js";
import {
  BUSINESS_TYPES,
  DEFAULT_PERMISSIONS,
  exciseApplies,
  IMS_PERMISSIONS,
  IMS_ROLES,
  isImsRole,
  normalizePermissions,
  normalizeReminders,
  normalizeTaxonomy,
  permissionsFor,
  type ImsRole,
  type PermissionMatrix,
  type ReminderSettings,
  type Taxonomy,
} from "./logic.js";

export type ImsSettings = {
  businessName: string;
  businessType: string;
  gstin: string | null;
  state: string | null;
  stateCode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  fiscalYearStart: number;
  poPrefix: string;
  invoicePrefix: string;
  billPrefix: string;
  returnPrefix: string;
  checkPrefix: string;
  ticketPrefix: string;
  poApprovalLimit: number;
  draftPoPurgeDays: number;
  paymentTermsDays: number;
  defaultGstRate: number;
  allowNegativeStock: boolean;
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
  state: string | null;
  state_code: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  fiscal_year_start: number;
  po_prefix: string;
  invoice_prefix: string;
  bill_prefix: string;
  return_prefix: string;
  check_prefix: string;
  ticket_prefix: string;
  po_approval_limit: string | number;
  draft_po_purge_days: number;
  payment_terms_days: number;
  default_gst_rate: string | number;
  allow_negative_stock: number;
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
  state: r.state,
  stateCode: r.state_code,
  address: r.address,
  phone: r.phone,
  email: r.email,
  fiscalYearStart: Number(r.fiscal_year_start) || 4,
  poPrefix: r.po_prefix,
  invoicePrefix: r.invoice_prefix,
  billPrefix: r.bill_prefix,
  returnPrefix: r.return_prefix,
  checkPrefix: r.check_prefix,
  ticketPrefix: r.ticket_prefix,
  poApprovalLimit: money(r.po_approval_limit),
  draftPoPurgeDays: Number(r.draft_po_purge_days) || 0,
  paymentTermsDays: Number(r.payment_terms_days) || 0,
  defaultGstRate: money(r.default_gst_rate),
  allowNegativeStock: Boolean(r.allow_negative_stock),
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
  state: optText(80),
  stateCode: optText(4),
  address: optText(500),
  phone: optText(40),
  email: optText(180),
  fiscalYearStart: z.coerce.number().int().min(1).max(12).optional(),
  poPrefix: prefix.optional(),
  invoicePrefix: prefix.optional(),
  billPrefix: prefix.optional(),
  returnPrefix: prefix.optional(),
  checkPrefix: prefix.optional(),
  ticketPrefix: prefix.optional(),
  poApprovalLimit: z.coerce.number().min(0).max(1e12).optional(),
  draftPoPurgeDays: z.coerce.number().int().min(0).max(365).optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  defaultGstRate: z.coerce.number().min(0).max(100).optional(),
  allowNegativeStock: z.boolean().optional(),
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
  state: "state",
  stateCode: "state_code",
  address: "address",
  phone: "phone",
  email: "email",
  fiscalYearStart: "fiscal_year_start",
  poPrefix: "po_prefix",
  invoicePrefix: "invoice_prefix",
  billPrefix: "bill_prefix",
  returnPrefix: "return_prefix",
  checkPrefix: "check_prefix",
  ticketPrefix: "ticket_prefix",
  poApprovalLimit: "po_approval_limit",
  draftPoPurgeDays: "draft_po_purge_days",
  paymentTermsDays: "payment_terms_days",
  defaultGstRate: "default_gst_rate",
  allowNegativeStock: "allow_negative_stock",
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
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || !COLUMN[key]) continue;
    let v: unknown = value;
    if (key === "permissions") v = JSON.stringify(normalizePermissions(value));
    else if (key === "taxonomy") v = JSON.stringify(normalizeTaxonomy(value));
    else if (key === "reminders") v = JSON.stringify(normalizeReminders(value));
    else if (typeof value === "boolean") v = value ? 1 : 0;
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

import type { NextFunction, Request, Response } from "express";
import { pool } from "../../db.js";
import { getActiveOrgId } from "../request-context.js";
import { isPlatformAdmin, orgEqualsSql, orgScopeParams } from "../platform-admin.js";

export type AdminProfileRef = {
  profileId: number;
  organizationId: number;
  businessName: string;
};

export type AdminProfileOption = {
  id: number;
  businessName: string;
  isDefault: boolean;
  organizationId: number;
  organizationName: string | null;
};

function isErrorResult(v: unknown): v is { error: string; status: number } {
  return Boolean(v && typeof v === "object" && "error" in v && "status" in v);
}

/** Ensure target user belongs to the caller's org scope (or platform admin). */
export async function assertOrgMember(
  userId: number,
): Promise<{ ok: true; orgId: number } | { ok: false; status: number; error: string }> {
  if (!Number.isInteger(userId) || userId <= 0) {
    return { ok: false, status: 400, error: "Invalid member" };
  }
  const [rows] = await pool.query(
    `SELECT m.organization_id AS orgId
     FROM org_members m
     WHERE m.user_id = :userId AND ${orgEqualsSql("m.organization_id")}
     LIMIT 1`,
    { userId, ...orgScopeParams() },
  );
  const row = Array.isArray(rows) ? (rows[0] as { orgId: number } | undefined) : undefined;
  if (!row) {
    return { ok: false, status: 404, error: "Member not found" };
  }
  return { ok: true, orgId: Number(row.orgId) };
}

/**
 * Resolve invite/assign org id.
 * Platform supers must pass organizationId explicitly (never inherit Operator act-as session org).
 * Non–platform-admins stay on their active org.
 */
export function resolveAdminOrgId(requested: unknown): number | { error: string; status: number } {
  return requireAdminOrgId(requested);
}

/**
 * Org-scoped admin actions that must not inherit the operator Business Profile / org
 * selection: platform supers must pass organizationId explicitly.
 */
export function requireAdminOrgId(requested: unknown): number | { error: string; status: number } {
  if (isPlatformAdmin()) {
    const raw = Number(requested);
    if (!Number.isInteger(raw) || raw < 1) {
      return { error: "organizationId required — Admin Console does not use the operator Business Profile selection", status: 400 };
    }
    return raw;
  }
  return getActiveOrgId();
}

/**
 * Resolve a Business Profile for Admin Console APIs.
 * Platform supers: lookup is global; never falls back to the operator session profile.
 * Pass `required: true` when the action needs a profile (grant, IMS save, etc.).
 */
export async function resolveAdminBusinessProfile(
  raw: unknown,
  opts?: { required?: boolean },
): Promise<AdminProfileRef | { error: string; status: number } | null> {
  let profileId = Number(raw);
  if (!Number.isInteger(profileId) || profileId < 1) {
    if (isPlatformAdmin()) {
      return opts?.required
        ? {
            error: "businessProfileId required — select a Business Profile in Admin Console",
            status: 400,
          }
        : null;
    }
    const { getActiveProfileId } = await import("../request-context.js");
    profileId = Number(getActiveProfileId());
    if (!Number.isInteger(profileId) || profileId < 1) {
      return opts?.required ? { error: "businessProfileId required", status: 400 } : null;
    }
  }

  const [rows] = await pool.query(
    isPlatformAdmin()
      ? `SELECT id, organization_id, business_name
         FROM business_profiles WHERE id = :id LIMIT 1`
      : `SELECT id, organization_id, business_name
         FROM business_profiles
         WHERE id = :id AND organization_id = :orgId LIMIT 1`,
    { id: profileId, orgId: getActiveOrgId() },
  );
  const row = Array.isArray(rows)
    ? (rows[0] as { id: number; organization_id: number; business_name: string } | undefined)
    : undefined;
  if (!row) {
    return {
      error: isPlatformAdmin()
        ? "Business Profile not found"
        : "Business profile not found in this organization",
      status: 404,
    };
  }
  return {
    profileId: Number(row.id),
    organizationId: Number(row.organization_id),
    businessName: String(row.business_name ?? `Profile #${row.id}`),
  };
}

/** List Business Profiles visible in Admin Console (all orgs for platform supers). */
export async function listAdminBusinessProfiles(
  organizationId?: number | null,
): Promise<AdminProfileOption[]> {
  const orgFilter =
    organizationId != null && Number.isInteger(organizationId) && organizationId > 0
      ? "p.organization_id = :filterOrgId"
      : isPlatformAdmin()
        ? "1=1"
        : "p.organization_id = :orgId";
  const [rows] = await pool.query(
    `SELECT p.id, p.business_name, p.is_default, p.organization_id, o.name AS organization_name
     FROM business_profiles p
     LEFT JOIN organizations o ON o.id = p.organization_id
     WHERE ${orgFilter}
     ORDER BY o.name ASC, p.is_default DESC, p.business_name ASC`,
    {
      filterOrgId: organizationId ?? null,
      ...orgScopeParams(),
    },
  );
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: Number(r.id),
      businessName: String(r.business_name ?? `Profile #${r.id}`),
      isDefault: Boolean(r.is_default),
      organizationId: Number(r.organization_id),
      organizationName: r.organization_name == null ? null : String(r.organization_name),
    };
  });
}

export type AdminOrganizationOption = {
  id: number;
  name: string;
};

/** Organizations visible in Admin Console (all for platform supers). */
export async function listAdminOrganizations(): Promise<AdminOrganizationOption[]> {
  const [rows] = await pool.query(
    `SELECT id, name FROM organizations
     WHERE ${orgEqualsSql("id")}
     ORDER BY name ASC, id ASC`,
    orgScopeParams(),
  );
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as { id: number; name: string };
    return { id: Number(r.id), name: String(r.name ?? `Org ${r.id}`) };
  });
}

/**
 * Resolve organization_id for an existing admin resource by primary key.
 * Platform supers look up globally; never uses operator session org as the owner.
 */
export async function resolveAdminResourceOrgId(
  table:
    | "org_themes"
    | "payment_gateways"
    | "payment_ops"
    | "business_profiles",
  id: number,
): Promise<number | { error: string; status: number }> {
  if (!Number.isInteger(id) || id < 1) {
    return { error: "Invalid id", status: 400 };
  }
  const [rows] = await pool.query(
    `SELECT organization_id AS orgId FROM ${table}
     WHERE id = :id AND ${orgEqualsSql("organization_id")}
     LIMIT 1`,
    { id, ...orgScopeParams() },
  );
  const row = Array.isArray(rows) ? (rows[0] as { orgId: number } | undefined) : undefined;
  if (!row) return { error: "Not found", status: 404 };
  return Number(row.orgId);
}

/**
 * Optional org filter for list endpoints.
 * Platform: omit → all orgs; pass id → that org.
 * Never silently falls back to operator session for platform supers.
 */
export function optionalAdminOrgFilter(
  requested: unknown,
): { orgId: number | null } | { error: string; status: number } {
  if (requested == null || requested === "") {
    return { orgId: isPlatformAdmin() ? null : getActiveOrgId() };
  }
  const resolved = requireAdminOrgId(requested);
  if (isErrorResult(resolved)) return resolved;
  return { orgId: resolved };
}

export function adminResolveError(
  result: { error: string; status: number } | unknown,
): result is { error: string; status: number } {
  return isErrorResult(result);
}

export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isPlatformAdmin()) {
    res.status(403).json({ error: "Platform admin required" });
    return;
  }
  next();
}

import type { Response } from "express";
import { z } from "zod";
import type { ImsDb } from "./db.js";
import { exec } from "./db.js";
import { ImsError, forbidden, type ImsActor, type ImsHost, type ImsNotice } from "./host.js";
import { isISODate, type ImsPermission, type ImsRole } from "./logic.js";
import type { ImsCatalogSource, ImsDocumentSource } from "./sources/types.js";

/** A real calendar date in `YYYY-MM-DD` (rejects 2026-02-30). */
export const isoDate = z.string().refine(isISODate, "Use a valid date (YYYY-MM-DD)");
export const optText = (max: number) => z.string().trim().max(max).nullable().optional();
export const money = z.coerce.number().min(0).max(1e12);
export const qty = z.coerce.number().min(0).max(1e9);

export type ImsDeps = {
  db: ImsDb;
  host: ImsHost;
  sources: ReadonlyArray<ImsDocumentSource>;
  catalogs: ReadonlyArray<ImsCatalogSource>;
};

/** What the caller may do in IMS, resolved once per request (see access.ts). */
export type ImsAccess = {
  role: ImsRole;
  perms: ReadonlySet<ImsPermission>;
};

export function actorOf(res: Response): ImsActor {
  const actor = res.locals.imsActor as ImsActor | undefined;
  if (!actor) throw new ImsError(401, "Sign in to use Justx IMS");
  return actor;
}

export function accessOf(res: Response): ImsAccess {
  const access = res.locals.imsAccess as ImsAccess | undefined;
  if (!access) throw new ImsError(401, "Sign in to use Justx IMS");
  return access;
}

export function can(res: Response, perm: ImsPermission): boolean {
  return accessOf(res).perms.has(perm);
}

/** Throws 403 unless the caller holds the permission (owners hold every permission). */
export function requirePerm(res: Response, perm: ImsPermission, message?: string): void {
  if (!can(res, perm)) throw forbidden(message ?? `Your IMS role doesn't allow this (${perm}). Ask an owner to update Settings → Team & roles.`);
}

export function requireAnyPerm(res: Response, perms: ReadonlyArray<ImsPermission>, message?: string): void {
  if (!perms.some((p) => can(res, p))) throw forbidden(message ?? "Your IMS role doesn't allow this. Ask an owner to update Settings → Team & roles.");
}

export function isOwner(res: Response): boolean {
  return accessOf(res).role === "owner";
}

/** Validate a body with zod and surface field errors as a 400. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const details = result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
  throw new ImsError(400, "Please check the highlighted fields", details);
}

/**
 * Validate a partial update. Zod fills `.default()` values even inside `.partial()`, which would overwrite stored
 * fields the caller didn't send, so only the keys present in the body are kept.
 */
export function parsePatch<S extends z.ZodObject>(schema: S, input: unknown): Partial<z.infer<S>> {
  const parsed = parse(schema.partial(), input) as Record<string, unknown>;
  const sent = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => sent[k] !== undefined)) as Partial<z.infer<S>>;
}

/** Query-string helpers. */
export const qstr = (v: unknown, max = 120): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const qint = (v: unknown, fallback: number, min = 1, max = 1000): number => {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export type ImsEventInput = {
  type: string;
  entityType: string;
  entityId: string;
  summary: string;
  payload?: Record<string, unknown>;
  notice?: Omit<ImsNotice, "href" | "entityType" | "entityId"> & { path?: string };
  ip?: string;
};

/**
 * One call records the IMS activity history, the host audit trail and (optionally)
 * a host notification. Side effects never fail the business operation.
 */
export async function recordEvent(deps: ImsDeps, actor: ImsActor, ev: ImsEventInput): Promise<void> {
  try {
    await exec(
      deps.db,
      `INSERT INTO ims_events (tenant_id, actor_user_id, actor_name, event_type, entity_type, entity_id, summary, payload)
       VALUES (:tenantId, :userId, :actorName, :type, :entityType, :entityId, :summary, :payload)`,
      {
        tenantId: actor.tenantId,
        userId: actor.userId,
        actorName: actor.name ?? actor.email ?? null,
        type: ev.type,
        entityType: ev.entityType,
        entityId: ev.entityId,
        summary: ev.summary.slice(0, 255),
        payload: ev.payload ? JSON.stringify(ev.payload) : null,
      },
    );
  } catch (err) {
    console.warn("[ims] event log failed", err instanceof Error ? err.message : err);
  }
  deps.host.audit(actor, ev.type, ev.entityType, ev.entityId, ev.payload, ev.ip).catch(() => undefined);
  if (ev.notice) {
    const { path, ...notice } = ev.notice;
    try {
      deps.host.notify(actor, {
        ...notice,
        href: `${deps.host.appHref}${path ?? ""}`,
        entityType: ev.entityType,
        entityId: ev.entityId,
      });
    } catch {
      /* notifications are best-effort */
    }
  }
}

export const actorName = (actor: ImsActor): string | null => actor.name ?? actor.email ?? null;

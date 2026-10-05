import type { Response } from "express";
import { z } from "zod";
import type { BosConnector } from "./connectors/types.js";
import type { BosDb } from "./db.js";
import { exec } from "./db.js";
import { BosError, type BosActor, type BosHost, type BosNotice } from "./host.js";
import { isISODate } from "./logic.js";

/** A real calendar date in `YYYY-MM-DD` (rejects 2026-02-30). */
export const isoDate = z.string().refine(isISODate, "Use a valid date (YYYY-MM-DD)");
export const optText = (max: number) => z.string().trim().max(max).nullable().optional();

export type BosDeps = {
  db: BosDb;
  host: BosHost;
  connectors: ReadonlyArray<BosConnector>;
};

export function actorOf(res: Response): BosActor {
  const actor = res.locals.bosActor as BosActor | undefined;
  if (!actor) throw new BosError(401, "Sign in to use Justx BOS");
  return actor;
}

/** An admin switch (see `BosHost.feature`); a host without switches allows everything. */
export function featureOn(deps: BosDeps, actor: BosActor, key: string): Promise<boolean> {
  return deps.host.feature ? deps.host.feature(actor, key) : Promise.resolve(true);
}

/** Validate a body with zod and surface field errors as a 400. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const details = result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
  throw new BosError(400, "Please check the highlighted fields", details);
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

export type BosEventInput = {
  type: string;
  entityType: string;
  entityId: string;
  summary: string;
  payload?: Record<string, unknown>;
  notice?: Omit<BosNotice, "href" | "entityType" | "entityId"> & { path?: string };
  ip?: string;
};

/**
 * One call records the BOS activity feed, the host audit trail and (optionally)
 * a host notification. Side effects never fail the business operation.
 */
export async function recordEvent(deps: BosDeps, actor: BosActor, ev: BosEventInput): Promise<void> {
  try {
    await exec(
      deps.db,
      `INSERT INTO bos_events (tenant_id, actor_user_id, actor_name, event_type, entity_type, entity_id, summary, payload)
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
    console.warn("[bos] event log failed", err instanceof Error ? err.message : err);
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

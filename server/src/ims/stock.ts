import type { PoolConnection } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { exec, money, nextSequence, one, type Queryable } from "./db.js";
import { ImsError, notFound, type ImsActor } from "./host.js";
import { fiscalYearLabel, formatDocNo, movementEffect, round2, round3, todayISO, type MovementType } from "./logic.js";

export type MovementInput = {
  itemId: string;
  type: MovementType;
  /** Positive units; ADJUSTMENT takes the signed correction. */
  qty: number;
  /** Customer returns into quarantine, supplier returns out of quarantine. */
  damaged?: boolean;
  unitCost?: number | null;
  unitPrice?: number | null;
  refType?: "manual" | "po" | "invoice" | "return" | "check" | "pos" | "tally" | "import";
  refId?: string | null;
  refNo?: string | null;
  partyId?: string | null;
  partyName?: string | null;
  reason?: string | null;
  refundStatus?: string | null;
  exciseDuty?: number | null;
  notes?: string | null;
  date?: string;
};

export type PostedMovement = {
  id: string;
  itemId: string;
  itemName: string;
  type: MovementType;
  qty: number;
  delta: number;
  before: number;
  after: number;
  value: number;
};

type LockedItem = { id: string; name: string; current_stock: string | number; damaged_stock: string | number; purchase_price: string | number; selling_price: string | number; active: number };

/**
 * The only way stock changes. Locks the item row, applies the movement to the saleable and
 * damaged buckets, enforces the negative-stock rule and appends the ledger row.
 * Must run inside a transaction (`tx`) so concurrent movements serialize on the item.
 */
export async function postMovement(conn: PoolConnection, actor: ImsActor, input: MovementInput, opts: { allowNegative: boolean }): Promise<PostedMovement> {
  const item = await one<LockedItem>(
    conn,
    `SELECT id, name, current_stock, damaged_stock, purchase_price, selling_price, active
     FROM ims_items WHERE tenant_id = :tenantId AND id = :id FOR UPDATE`,
    { tenantId: actor.tenantId, id: input.itemId },
  );
  if (!item) throw notFound("Item");
  const effect = movementEffect(input.type, input.qty, { damaged: input.damaged });
  if (effect.saleable === 0 && effect.damaged === 0) throw new ImsError(400, "Quantity must be more than zero");
  const before = round3(money(item.current_stock));
  const damagedBefore = round3(money(item.damaged_stock));
  const after = round3(before + effect.saleable);
  const damagedAfter = round3(damagedBefore + effect.damaged);
  if (after < 0 && !opts.allowNegative) {
    throw new ImsError(409, `Only ${before} ${item.name} in stock — can't remove ${Math.abs(effect.saleable)}. Receive stock first or allow negative stock in Settings.`, undefined, "IMS_INSUFFICIENT_STOCK");
  }
  if (damagedAfter < 0) {
    throw new ImsError(409, `Only ${damagedBefore} damaged ${item.name} in quarantine.`, undefined, "IMS_INSUFFICIENT_STOCK");
  }
  const qty = round3(Math.abs(input.qty));
  const unitCost = input.unitCost ?? money(item.purchase_price);
  const unitPrice = input.unitPrice ?? (input.type === "OUT" ? money(item.selling_price) : null);
  const value = round2(qty * (input.type === "OUT" && unitPrice != null ? unitPrice : unitCost));
  await exec(
    conn,
    `UPDATE ims_items SET current_stock = :after, damaged_stock = :damagedAfter, last_movement_at = CURRENT_TIMESTAMP
     ${input.type === "IN" && input.unitCost ? ", purchase_price = :unitCost" : ""}
     WHERE tenant_id = :tenantId AND id = :id`,
    { tenantId: actor.tenantId, id: item.id, after, damagedAfter, unitCost },
  );
  const id = randomUUID();
  await exec(
    conn,
    `INSERT INTO ims_movements
       (id, tenant_id, item_id, item_name, type, qty, delta, before_qty, after_qty, unit_cost, unit_price, value,
        ref_type, ref_id, ref_no, party_id, party_name, reason, refund_status, excise_duty, notes, movement_date, actor_user_id, actor_name)
     VALUES
       (:id, :tenantId, :itemId, :itemName, :type, :qty, :delta, :before, :after, :unitCost, :unitPrice, :value,
        :refType, :refId, :refNo, :partyId, :partyName, :reason, :refundStatus, :exciseDuty, :notes, :date, :userId, :actorName)`,
    {
      id,
      tenantId: actor.tenantId,
      itemId: item.id,
      itemName: item.name,
      type: input.type,
      qty,
      delta: effect.saleable,
      before,
      after,
      unitCost,
      unitPrice,
      value,
      refType: input.refType ?? "manual",
      refId: input.refId ?? null,
      refNo: input.refNo ?? null,
      partyId: input.partyId ?? null,
      partyName: input.partyName ?? null,
      reason: input.reason ?? null,
      refundStatus: input.refundStatus ?? null,
      exciseDuty: input.exciseDuty ?? null,
      notes: input.notes ?? null,
      date: input.date ?? todayISO(),
      userId: actor.userId,
      actorName: actor.name ?? actor.email ?? null,
    },
  );
  return { id, itemId: item.id, itemName: item.name, type: input.type, qty, delta: effect.saleable, before, after, value };
}

/** Next document number, e.g. `PO/26-27/0007`, numbered per fiscal year. */
export async function nextDocNo(db: Queryable, tenantId: number, key: string, prefix: string, date: string, fyStartMonth: number): Promise<string> {
  const period = fiscalYearLabel(date, fyStartMonth);
  const seq = await nextSequence(db, tenantId, key, period);
  return formatDocNo(prefix, period, seq);
}

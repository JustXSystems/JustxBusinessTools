/**
 * Client for the stock entry, stock check, returns/damage and history screens —
 * the fields and routes added on top of the base `ims` client in `api.ts`.
 */
import { get, post, type CheckLine, type CheckStatus, type DateRange, type ImsItem, type ImsMovement, type ImsReturn, type ImsStockCheck, type MovementType, type Period, type PostedMovement } from "./api";

export type MovementTotals = Partial<Record<MovementType, { qty: number; delta?: number; value: number; count: number }>>;

export type MovementQuery = {
  period?: Period;
  from?: string;
  to?: string;
  type?: string;
  itemId?: string;
  partyId?: string;
  refType?: string;
  refId?: string;
  refNo?: string;
  q?: string;
  limit?: number;
};

export type MovementPage = { range: DateRange; movements: ImsMovement[]; totals: MovementTotals; count?: number; truncated?: boolean };

export type CountLine = CheckLine & { location?: string | null; liveQty?: number | null };
export type CountSheet = Omit<ImsStockCheck, "lines"> & {
  shortQty?: number;
  shortValue?: number;
  excessQty?: number;
  excessValue?: number;
  lines?: CountLine[];
};

export type ReturnsSummary = {
  monthStart: string;
  customerReturns: number;
  customerValue: number;
  supplierReturns: number;
  supplierValue: number;
  refundPending: number;
  refundPendingCount: number;
  damagedUnits: number;
  damagedValue: number;
  damageMtdValue: number;
  damageMtdUnits: number;
  writeOffMtdValue: number;
  writeOffMtdUnits: number;
};

export type ReturnsOverview = { returns: ImsReturn[]; damage: ImsMovement[]; quarantine: ImsItem[]; summary?: ReturnsSummary };

/** Mirrors server RESTORE_REASON: the RETURN_IN half of a quarantine restore. */
export const RESTORE_REASON = "Restored to saleable";
export const isRestore = (m: Pick<ImsMovement, "type" | "reason" | "refType">): boolean => m.type === "RETURN_IN" && m.refType === "manual" && m.reason === RESTORE_REASON;

export const imsB = {
  movements: (params: MovementQuery = {}) => get<MovementPage>("/movements", params),
  checks: (status?: CheckStatus) => get<{ checks: CountSheet[] }>("/checks", { status }),
  check: (id: string) => get<{ check: CountSheet }>(`/checks/${id}`),
  returnsOverview: () => get<ReturnsOverview>("/returns"),
  restoreDamaged: (input: { itemId: string; qty: number; notes?: string | null; date?: string }) => post<{ movements: PostedMovement[] }>("/damage/restore", input),
};

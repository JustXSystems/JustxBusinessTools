import { addDaysISO, daysBetween, round2 } from "./logic.js";

export const TRAVEL_MODES = ["flight", "train", "bus", "car", "other"] as const;
export const TRAVEL_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];
export type TravelStatus = (typeof TRAVEL_STATUSES)[number];
export type TripPhase = "pending" | "upcoming" | "on_trip" | "completed" | "rejected" | "cancelled";
export type ReturnState = "overdue" | "due" | null;

/** Longest single trip, in days including both ends. */
export const MAX_TRIP_DAYS = 90;
/** How far back a trip can start when it's requested after the fact. */
export const BACKDATE_DAYS = 30;
/** How far ahead a trip can be requested. */
export const AHEAD_DAYS = 365;

export type TripDates = { departOn: string; returnOn: string; estimatedCost: number; advance: number };

export const tripDays = (departOn: string, returnOn: string): number => daysBetween(departOn, returnOn) + 1;

/** Why a trip can't be saved, or null when it can. */
export function tripProblem(t: TripDates, today: string): string | null {
  if (t.returnOn < t.departOn) return "The return date is before the departure date";
  if (tripDays(t.departOn, t.returnOn) > MAX_TRIP_DAYS) return `A trip can be up to ${MAX_TRIP_DAYS} days — split longer travel into separate requests`;
  if (t.departOn < addDaysISO(today, -BACKDATE_DAYS)) return `The trip can't start more than ${BACKDATE_DAYS} days ago`;
  if (t.departOn > addDaysISO(today, AHEAD_DAYS)) return "The trip can't start more than a year ahead";
  if (t.advance > t.estimatedCost) return "The advance can't be more than the estimated cost";
  return null;
}

/** Where an approved trip stands today; other statuses pass through. */
export function tripPhase(t: { status: TravelStatus; departOn: string; returnOn: string }, today: string): TripPhase {
  if (t.status !== "approved") return t.status;
  if (today < t.departOn) return "upcoming";
  return today <= t.returnOn ? "on_trip" : "completed";
}

/** Pending trips, and approved ones that haven't started, can be cancelled. */
export const canCancelTrip = (t: { status: TravelStatus; departOn: string }, today: string): boolean => t.status === "pending" || (t.status === "approved" && t.departOn > today);

/** Whether an asset's holder needs to hand it back: overdue once they've left, due while they serve notice. */
export function returnState(holder: { status: string; exitDate: string | null } | null, today: string): ReturnState {
  if (!holder) return null;
  if (holder.status === "exited" || (holder.exitDate !== null && holder.exitDate < today)) return "overdue";
  if (holder.status === "notice" || holder.exitDate !== null) return "due";
  return null;
}

export type WorkplaceData = {
  assets: ReadonlyArray<{ employeeId: string | null; returnState: ReturnState; status: string }>;
  trips: ReadonlyArray<{ status: TravelStatus; departOn: string; returnOn: string; estimatedCost: number }>;
  claims: ReadonlyArray<{ status: string; amount: number }>;
};

export function workplaceTotals(data: WorkplaceData, today: string) {
  const held = data.assets.filter((a) => a.status !== "disposed");
  const phases = data.trips.map((t) => ({ ...t, phase: tripPhase(t, today) }));
  const pending = phases.filter((t) => t.phase === "pending");
  const submitted = data.claims.filter((c) => c.status === "submitted");
  const approved = data.claims.filter((c) => c.status === "approved");
  const sum = (list: ReadonlyArray<{ amount: number }>) => round2(list.reduce((s, c) => s + c.amount, 0));
  return {
    assetsAssigned: held.filter((a) => a.employeeId).length,
    assetsInStore: held.filter((a) => !a.employeeId).length,
    overdueReturns: held.filter((a) => a.returnState === "overdue").length,
    returnsDue: held.filter((a) => a.returnState === "due").length,
    travelPending: pending.length,
    travelPendingCost: round2(pending.reduce((s, t) => s + t.estimatedCost, 0)),
    travelUpcoming: phases.filter((t) => t.phase === "upcoming").length,
    onTrip: phases.filter((t) => t.phase === "on_trip").length,
    claimsPending: submitted.length,
    claimsToReimburse: approved.length,
    claimsOpen: submitted.length + approved.length,
    claimsOpenAmount: round2(sum(submitted) + sum(approved)),
  };
}
export type WorkplaceTotals = ReturnType<typeof workplaceTotals>;

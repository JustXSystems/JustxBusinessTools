import { describe, expect, it } from "vitest";
import { canCancelTrip, returnState, tripDays, tripPhase, tripProblem, workplaceTotals } from "./travel-logic.js";

const today = "2026-10-05";
const trip = { departOn: "2026-10-12", returnOn: "2026-10-14", estimatedCost: 12000, advance: 5000 };

describe("trip checks", () => {
  it("counts both ends of the trip", () => {
    expect(tripDays("2026-10-12", "2026-10-14")).toBe(3);
    expect(tripDays("2026-10-12", "2026-10-12")).toBe(1);
  });

  it("accepts a normal trip and explains what's wrong otherwise", () => {
    expect(tripProblem(trip, today)).toBeNull();
    expect(tripProblem({ ...trip, returnOn: "2026-10-11" }, today)).toMatch(/before the departure/);
    expect(tripProblem({ ...trip, returnOn: "2027-01-10" }, today)).toMatch(/up to 90 days/);
    expect(tripProblem({ ...trip, departOn: "2026-09-01", returnOn: "2026-09-02" }, today)).toMatch(/30 days ago/);
    expect(tripProblem({ ...trip, departOn: "2026-09-05", returnOn: "2026-09-06" }, today)).toBeNull();
    expect(tripProblem({ ...trip, departOn: "2027-10-06", returnOn: "2027-10-07" }, today)).toMatch(/year ahead/);
    expect(tripProblem({ ...trip, advance: 12001 }, today)).toMatch(/advance/);
  });
});

describe("trip phase", () => {
  it("derives upcoming, on trip and completed from the dates of an approved trip", () => {
    const approved = { status: "approved" as const, departOn: "2026-10-04", returnOn: "2026-10-06" };
    expect(tripPhase({ ...approved, departOn: "2026-10-06" }, today)).toBe("upcoming");
    expect(tripPhase(approved, today)).toBe("on_trip");
    expect(tripPhase({ ...approved, returnOn: "2026-10-05" }, today)).toBe("on_trip");
    expect(tripPhase({ ...approved, returnOn: "2026-10-04" }, today)).toBe("completed");
    expect(tripPhase({ ...approved, status: "pending" }, today)).toBe("pending");
    expect(tripPhase({ ...approved, status: "rejected" }, today)).toBe("rejected");
  });

  it("only cancels pending trips or approved ones that haven't started", () => {
    expect(canCancelTrip({ status: "pending", departOn: "2026-10-01" }, today)).toBe(true);
    expect(canCancelTrip({ status: "approved", departOn: "2026-10-06" }, today)).toBe(true);
    expect(canCancelTrip({ status: "approved", departOn: "2026-10-05" }, today)).toBe(false);
    expect(canCancelTrip({ status: "rejected", departOn: "2026-10-10" }, today)).toBe(false);
  });
});

describe("asset returns", () => {
  it("is overdue once the holder has left and due while they serve notice", () => {
    expect(returnState(null, today)).toBeNull();
    expect(returnState({ status: "active", exitDate: null }, today)).toBeNull();
    expect(returnState({ status: "exited", exitDate: null }, today)).toBe("overdue");
    expect(returnState({ status: "notice", exitDate: "2026-10-04" }, today)).toBe("overdue");
    expect(returnState({ status: "notice", exitDate: "2026-10-31" }, today)).toBe("due");
    expect(returnState({ status: "notice", exitDate: null }, today)).toBe("due");
    expect(returnState({ status: "active", exitDate: "2026-11-30" }, today)).toBe("due");
  });
});

describe("workplace totals", () => {
  it("counts assets, trips and open claims", () => {
    const t = workplaceTotals(
      {
        assets: [
          { employeeId: "e1", returnState: null, status: "in_use" },
          { employeeId: "e2", returnState: "overdue", status: "in_use" },
          { employeeId: "e3", returnState: "due", status: "maintenance" },
          { employeeId: null, returnState: null, status: "in_use" },
          { employeeId: "e1", returnState: null, status: "disposed" },
        ],
        trips: [
          { status: "pending", departOn: "2026-10-12", returnOn: "2026-10-14", estimatedCost: 12000 },
          { status: "pending", departOn: "2026-10-20", returnOn: "2026-10-20", estimatedCost: 1500.5 },
          { status: "approved", departOn: "2026-10-08", returnOn: "2026-10-09", estimatedCost: 4000 },
          { status: "approved", departOn: "2026-10-04", returnOn: "2026-10-06", estimatedCost: 9000 },
          { status: "approved", departOn: "2026-09-01", returnOn: "2026-09-02", estimatedCost: 3000 },
          { status: "rejected", departOn: "2026-10-12", returnOn: "2026-10-12", estimatedCost: 800 },
        ],
        claims: [
          { status: "submitted", amount: 1200 },
          { status: "approved", amount: 800.25 },
          { status: "reimbursed", amount: 5000 },
          { status: "rejected", amount: 300 },
        ],
      },
      today,
    );
    expect(t).toEqual({
      assetsAssigned: 3,
      assetsInStore: 1,
      overdueReturns: 1,
      returnsDue: 1,
      travelPending: 2,
      travelPendingCost: 13500.5,
      travelUpcoming: 1,
      onTrip: 1,
      claimsPending: 1,
      claimsToReimburse: 1,
      claimsOpen: 2,
      claimsOpenAmount: 2000.25,
    });
  });
});

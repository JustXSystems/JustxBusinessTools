import { describe, expect, it } from "vitest";
import { addMonthsISO, certificateExpiry, certificateStatus, fiscalQuarterStart, isCurrentKra, performanceTotals, promotionProblem } from "./performance-logic.js";

describe("dates", () => {
  it("adds months, clamping to the month's end", () => {
    expect(addMonthsISO("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsISO("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsISO("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonthsISO("2026-03-10", -3)).toBe("2025-12-10");
  });

  it("runs a certificate to the day before the same date", () => {
    expect(certificateExpiry("2026-01-10", 12)).toBe("2027-01-09");
    expect(certificateExpiry("2026-01-10", null)).toBeNull();
    expect(certificateExpiry("2026-01-10", 0)).toBeNull();
  });

  it("shows a certificate as expiring within 30 days and expired after its last day", () => {
    expect(certificateStatus(null, "2026-10-05")).toBe("valid");
    expect(certificateStatus("2026-12-01", "2026-10-05")).toBe("valid");
    expect(certificateStatus("2026-11-04", "2026-10-05")).toBe("expiring");
    expect(certificateStatus("2026-10-05", "2026-10-05")).toBe("expiring");
    expect(certificateStatus("2026-10-04", "2026-10-05")).toBe("expired");
  });

  it("finds the fiscal quarter for any financial-year start", () => {
    expect(fiscalQuarterStart("2026-10-05")).toBe("2026-10-01");
    expect(fiscalQuarterStart("2026-05-20")).toBe("2026-04-01");
    expect(fiscalQuarterStart("2027-02-01")).toBe("2027-01-01");
    expect(fiscalQuarterStart("2026-08-31", 1)).toBe("2026-07-01");
    expect(fiscalQuarterStart("2027-01-15", 2)).toBe("2026-11-01");
  });

  it("treats a KRA as current inside its period", () => {
    expect(isCurrentKra({ periodStart: "2026-04-01", periodEnd: "2027-03-31" }, "2026-10-05")).toBe(true);
    expect(isCurrentKra({ periodStart: "2026-04-01", periodEnd: "2026-09-30" }, "2026-10-05")).toBe(false);
  });
});

describe("performanceTotals", () => {
  const today = "2026-10-05";
  const base = {
    employees: [{ id: "e1" }, { id: "e2" }, { id: "e3" }],
    programs: [
      { id: "safety", archived: false, certificate: true, mandatory: true },
      { id: "solar", archived: false, certificate: true, mandatory: false },
      { id: "old", archived: true, certificate: true, mandatory: true },
    ],
    enrollments: [
      { programId: "solar", employeeId: "e1", enrolledOn: "2026-10-01", sessionDate: "2026-10-20", status: "enrolled" as const, completedOn: null },
      { programId: "solar", employeeId: "e2", enrolledOn: "2026-10-02", sessionDate: "2026-10-20", status: "enrolled" as const, completedOn: null },
      { programId: "safety", employeeId: "e3", enrolledOn: "2026-10-02", sessionDate: "2026-10-03", status: "completed" as const, completedOn: "2026-10-03" },
      { programId: "safety", employeeId: "e2", enrolledOn: "2026-10-03", sessionDate: "2026-12-01", status: "enrolled" as const, completedOn: null },
      { programId: "solar", employeeId: "e3", enrolledOn: "2026-09-10", sessionDate: null, status: "completed" as const, completedOn: "2026-09-12" },
      { programId: "solar", employeeId: "e1", enrolledOn: "2026-10-04", sessionDate: null, status: "cancelled" as const, completedOn: null },
    ],
    certificates: [
      { employeeId: "e1", programId: "safety", issuedOn: "2025-10-01", expiresOn: "2026-10-20" },
      { employeeId: "e3", programId: "safety", issuedOn: "2026-10-03", expiresOn: "2027-10-02" },
      { employeeId: "e3", programId: "solar", issuedOn: "2026-09-12", expiresOn: null },
      { employeeId: "e2", programId: "safety", issuedOn: "2024-01-01", expiresOn: "2024-12-31" },
      { employeeId: "gone", programId: "safety", issuedOn: "2026-05-01", expiresOn: null },
    ],
    kras: [
      { employeeId: "e1", periodStart: "2026-04-01", periodEnd: "2027-03-31", status: "on_track" as const },
      { employeeId: "e1", periodStart: "2026-04-01", periodEnd: "2027-03-31", status: "achieved" as const },
      { employeeId: "e2", periodStart: "2026-07-01", periodEnd: "2026-12-31", status: "at_risk" as const },
      { employeeId: "e3", periodStart: "2025-04-01", periodEnd: "2026-03-31", status: "missed" as const },
      { employeeId: "gone", periodStart: "2026-04-01", periodEnd: "2027-03-31", status: "off_track" as const },
    ],
    promotions: [
      { status: "pending" as const, decidedOn: null },
      { status: "approved" as const, decidedOn: "2026-06-01" },
      { status: "approved" as const, decidedOn: "2026-02-01" },
    ],
    pips: [
      { status: "active" as const, reviewOn: "2026-11-01" },
      { status: "active" as const, reviewOn: "2026-10-25" },
      { status: "passed" as const, reviewOn: "2026-09-01" },
    ],
    recognitions: [{ awardedOn: "2026-10-01" }, { awardedOn: "2026-09-30" }],
  };

  it("counts current employees only and the quarter's enrollments", () => {
    const t = performanceTotals(base, today, "2026-04-01", "2026-10-01");
    expect(t.headcount).toBe(3);
    expect(t.promotionsPending).toBe(1);
    expect(t.promotionsApproved).toBe(1);
    expect(t.programs).toBe(2);
    expect(t.enrolledQuarter).toBe(4);
    expect(t.completedQuarter).toBe(1);
    // Two people in the same solar session count once; the December safety session is beyond 30 days.
    expect(t.upcomingSessions).toBe(1);
    expect(t.onPip).toBe(2);
    expect(t.nextPipReview).toBe("2026-10-25");
    expect(t.recognitionsMonth).toBe(1);
  });

  it("works out certification, mandatory compliance and expiry", () => {
    const t = performanceTotals(base, today, "2026-04-01", "2026-10-01");
    expect(t.certifiedEmployees).toBe(2);
    expect(t.mandatoryPrograms).toBe(1);
    expect(t.mandatoryCompliant).toBe(2);
    expect(t.expiringSoon).toBe(1);
    expect(t.expired).toBe(1);
    expect(t.issuedFy).toBe(3);
  });

  it("summarises current KRAs", () => {
    const t = performanceTotals(base, today, "2026-04-01", "2026-10-01");
    expect(t.krasSet).toBe(2);
    expect(t.kras).toEqual({ current: 3, onTrack: 2, atRisk: 1, offTrack: 0 });
  });

  it("reports no mandatory compliance when no program is mandatory", () => {
    const t = performanceTotals({ ...base, programs: base.programs.map((p) => ({ ...p, mandatory: false })) }, today, "2026-04-01", "2026-10-01");
    expect(t.mandatoryPrograms).toBe(0);
    expect(t.mandatoryCompliant).toBe(0);
  });
});

describe("promotionProblem", () => {
  it("needs a new designation or a higher CTC", () => {
    expect(promotionProblem({ proposedDesignation: "Senior Technician", currentDesignation: "Technician", proposedCtc: null, currentCtc: 300000 })).toBeNull();
    expect(promotionProblem({ proposedDesignation: " technician ", currentDesignation: "Technician", proposedCtc: null, currentCtc: 300000 })).toMatch(/new designation/);
    expect(promotionProblem({ proposedDesignation: "Technician", currentDesignation: "Technician", proposedCtc: 360000, currentCtc: 300000 })).toBeNull();
    expect(promotionProblem({ proposedDesignation: "Lead", currentDesignation: "Technician", proposedCtc: 250000, currentCtc: 300000 })).toMatch(/below/);
  });
});

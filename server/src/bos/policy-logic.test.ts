import { describe, expect, it } from "vitest";
import {
  agreementProblem,
  agreementState,
  agreementTotals,
  COMPLIANCE_TEMPLATES,
  complianceState,
  complianceTotals,
  firstDueISO,
  isWebUrl,
  nextDueISO,
  percent,
  policyTotals,
} from "./policy-logic.js";

describe("recurring due dates", () => {
  it("steps by the recurrence and keeps the intended day after a short month", () => {
    expect(nextDueISO("2026-01-31", "monthly", 31)).toBe("2026-02-28");
    expect(nextDueISO("2026-02-28", "monthly", 31)).toBe("2026-03-31");
    expect(nextDueISO("2026-11-15", "monthly", 15)).toBe("2026-12-15");
    expect(nextDueISO("2026-12-15", "monthly", 15)).toBe("2027-01-15");
    expect(nextDueISO("2026-07-31", "quarterly", 31)).toBe("2026-10-31");
    expect(nextDueISO("2026-08-31", "half_yearly", 31)).toBe("2027-02-28");
    expect(nextDueISO("2028-02-29", "yearly", 29)).toBe("2029-02-28");
    expect(nextDueISO("2026-05-10", "none", 10)).toBeNull();
  });

  it("falls back to the due date's own day when no day is kept", () => {
    expect(nextDueISO("2026-04-30", "monthly")).toBe("2026-05-30");
  });

  it("finds the first due date of a standard filing on or after today", () => {
    expect(firstDueISO({ recurrence: "monthly", day: 15 }, "2026-10-05")).toBe("2026-10-15");
    expect(firstDueISO({ recurrence: "monthly", day: 15 }, "2026-10-15")).toBe("2026-10-15");
    expect(firstDueISO({ recurrence: "monthly", day: 15 }, "2026-12-20")).toBe("2027-01-15");
    expect(firstDueISO({ recurrence: "monthly", day: 31 }, "2026-11-05")).toBe("2026-11-30");
    expect(firstDueISO({ recurrence: "yearly", month: 7, day: 31 }, "2026-10-05")).toBe("2027-07-31");
    expect(firstDueISO({ recurrence: "yearly", month: 1, day: 31 }, "2026-10-05")).toBe("2027-01-31");
    expect(firstDueISO({ recurrence: "yearly", month: 10, day: 31 }, "2026-10-05")).toBe("2026-10-31");
  });

  it("has unique template keys with valid days", () => {
    const keys = COMPLIANCE_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of COMPLIANCE_TEMPLATES) {
      expect(t.day).toBeGreaterThanOrEqual(1);
      expect(t.day).toBeLessThanOrEqual(31);
      if (t.recurrence === "yearly") expect(t.month).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("states", () => {
  const today = "2026-10-05";
  it("classifies filings", () => {
    expect(complianceState({ status: "done", dueOn: "2026-09-01" }, today)).toBe("done");
    expect(complianceState({ status: "open", dueOn: "2026-10-04" }, today)).toBe("overdue");
    expect(complianceState({ status: "open", dueOn: "2026-10-05" }, today)).toBe("due_soon");
    expect(complianceState({ status: "open", dueOn: "2026-10-12" }, today)).toBe("due_soon");
    expect(complianceState({ status: "open", dueOn: "2026-10-13" }, today)).toBe("upcoming");
  });

  it("classifies agreements", () => {
    expect(agreementState({ status: "ended", signedOn: "2025-01-01", expiresOn: null }, today)).toBe("ended");
    expect(agreementState({ status: "active", signedOn: "2025-01-01", expiresOn: "2026-10-04" }, today)).toBe("expired");
    expect(agreementState({ status: "active", signedOn: null, expiresOn: null }, today)).toBe("unsigned");
    expect(agreementState({ status: "active", signedOn: "2025-01-01", expiresOn: "2026-11-04" }, today)).toBe("expiring");
    expect(agreementState({ status: "active", signedOn: "2025-01-01", expiresOn: "2026-11-05" }, today)).toBe("active");
    expect(agreementState({ status: "active", signedOn: "2025-01-01", expiresOn: null }, today)).toBe("active");
  });
});

describe("agreement checks", () => {
  const base = { employeeId: "e1", counterparty: null, signedOn: "2026-10-01", startsOn: "2026-10-01", expiresOn: "2027-09-30" };
  it("needs exactly one party and sensible dates", () => {
    expect(agreementProblem(base, "2026-10-05")).toBeNull();
    expect(agreementProblem({ ...base, employeeId: null, counterparty: "Sunrise Manpower" }, "2026-10-05")).toBeNull();
    expect(agreementProblem({ ...base, employeeId: null }, "2026-10-05")).toMatch(/Pick the employee/);
    expect(agreementProblem({ ...base, counterparty: "Sunrise Manpower" }, "2026-10-05")).toMatch(/not both/);
    expect(agreementProblem({ ...base, signedOn: "2026-10-06" }, "2026-10-05")).toMatch(/future/);
    expect(agreementProblem({ ...base, expiresOn: "2026-09-30" }, "2026-10-05")).toMatch(/before the start/);
  });

  it("accepts only web links for the signed copy", () => {
    expect(isWebUrl("https://drive.google.com/file/d/abc")).toBe(true);
    expect(isWebUrl("http://intranet.local/nda.pdf")).toBe(true);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
    expect(isWebUrl("file:///C:/nda.pdf")).toBe(false);
    expect(isWebUrl("not a url")).toBe(false);
  });
});

describe("totals", () => {
  const today = "2026-10-05";
  it("counts filings", () => {
    const t = complianceTotals(
      [
        { status: "open", dueOn: "2026-10-01", doneOn: null },
        { status: "open", dueOn: "2026-10-07", doneOn: null },
        { status: "open", dueOn: "2026-11-01", doneOn: null },
        { status: "open", dueOn: "2026-12-01", doneOn: null },
        { status: "done", dueOn: "2026-10-01", doneOn: "2026-10-02" },
        { status: "done", dueOn: "2026-09-15", doneOn: "2026-09-14" },
      ],
      today,
    );
    expect(t).toEqual({ overdue: 1, dueSoon: 1, due30: 2, doneMonth: 1 });
  });

  it("counts agreements", () => {
    const t = agreementTotals(
      [
        { status: "active", signedOn: "2025-01-01", expiresOn: null },
        { status: "active", signedOn: "2025-01-01", expiresOn: "2026-10-20" },
        { status: "active", signedOn: null, expiresOn: null },
        { status: "active", signedOn: "2024-01-01", expiresOn: "2026-01-01" },
        { status: "ended", signedOn: "2024-01-01", expiresOn: null },
      ],
      today,
    );
    expect(t).toEqual({ active: 3, expiring: 1, expired: 1, unsigned: 1 });
  });

  it("works out the org-wide acknowledgement over published policies", () => {
    const t = policyTotals(
      [
        { status: "published", mandatory: true, acknowledged: 9 },
        { status: "published", mandatory: false, acknowledged: 5 },
        { status: "draft", mandatory: true, acknowledged: 0 },
        { status: "archived", mandatory: false, acknowledged: 10 },
      ],
      10,
    );
    expect(t).toEqual({ published: 2, mandatory: 1, drafts: 1, headcount: 10, ackRate: 70, mandatoryPending: 1 });
    expect(policyTotals([], 0).ackRate).toBeNull();
    expect(percent(1, 3)).toBe(33);
  });
});

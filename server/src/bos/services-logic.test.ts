import { describe, expect, it } from "vitest";
import { letterProblem, resolutionDays, serviceTotals, type ServiceRequestLite } from "./services-logic.js";

describe("resolution time", () => {
  it("counts days between raising and resolving, to one decimal", () => {
    expect(resolutionDays("2026-10-01 10:00:00", "2026-10-02 22:00:00")).toBe(1.5);
    expect(resolutionDays("2026-10-01 10:00:00", "2026-10-01 10:30:00")).toBe(0);
    expect(resolutionDays("2026-10-02 10:00:00", "2026-10-01 10:00:00")).toBe(0);
  });
});

describe("letters", () => {
  const active = { status: "active", exitDate: null, ctcAnnual: 600000 };
  it("issues employment and salary certificates to current staff", () => {
    expect(letterProblem("employment", active)).toBeNull();
    expect(letterProblem("salary", active)).toBeNull();
    expect(letterProblem("salary", { ...active, ctcAnnual: null })).toMatch(/CTC/);
  });

  it("keeps experience letters for people leaving or gone", () => {
    expect(letterProblem("experience", active)).toMatch(/employment certificate instead/);
    expect(letterProblem("experience", { ...active, status: "notice" })).toBeNull();
    expect(letterProblem("experience", { ...active, exitDate: "2026-11-30" })).toBeNull();
    expect(letterProblem("experience", { ...active, status: "exited" })).toBeNull();
    expect(letterProblem("employment", { ...active, status: "exited" })).toMatch(/experience letter instead/);
  });
});

describe("service totals", () => {
  it("counts open work by type and averages recent resolution times against the month before", () => {
    const r = (type: ServiceRequestLite["type"], status: ServiceRequestLite["status"], createdAt = "2026-10-01 09:00:00", resolvedAt: string | null = null): ServiceRequestLite => ({ type, status, createdAt, resolvedAt });
    const t = serviceTotals(
      [
        r("helpdesk", "open"),
        r("helpdesk", "in_progress"),
        r("certificate", "open"),
        r("id_card", "in_progress"),
        r("kit", "open"),
        r("other", "cancelled"),
        r("helpdesk", "resolved", "2026-10-01 09:00:00", "2026-10-02 09:00:00"),
        r("certificate", "resolved", "2026-10-01 09:00:00", "2026-10-03 09:00:00"),
        r("helpdesk", "resolved", "2026-08-20 09:00:00", "2026-08-23 09:00:00"),
        r("helpdesk", "resolved", "2026-06-01 09:00:00", "2026-06-20 09:00:00"),
      ],
      "2026-10-05",
    );
    expect(t).toEqual({
      open: 5,
      unassigned: 3,
      helpdeskOpen: 2,
      helpdeskUnassigned: 1,
      certificatesOpen: 1,
      kitsOpen: 2,
      resolvedRecent: 2,
      avgResolutionDays: 1.5,
      avgResolutionPrevDays: 3,
    });
  });

  it("has no average when nothing was resolved", () => {
    expect(serviceTotals([], "2026-10-05").avgResolutionDays).toBeNull();
  });
});

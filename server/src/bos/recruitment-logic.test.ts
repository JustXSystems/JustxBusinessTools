import { describe, expect, it } from "vitest";
import { onboardingProgress, readOnboarding, recruitmentTotals, splitName, stageMoveProblem, type PipelineCandidate, type PipelineOpening } from "./recruitment-logic.js";

const TODAY = "2026-10-05";
const cand = (over: Partial<PipelineCandidate>): PipelineCandidate => ({
  openingId: "o1",
  stage: "applied",
  appliedOn: "2026-09-01",
  hiredOn: null,
  offerSentOn: null,
  offerStatus: null,
  offerRespondedOn: null,
  joiningDate: null,
  onboarding: {},
  employeeId: null,
  ...over,
});
const done = (date = "2026-10-01") => ({ done: true, date });

describe("stageMoveProblem", () => {
  it("lets open candidates move between pipeline stages and close", () => {
    expect(stageMoveProblem("applied", "interview")).toBeNull();
    expect(stageMoveProblem("offer", "applied")).toBeNull();
    expect(stageMoveProblem("interview", "rejected")).toBeNull();
    expect(stageMoveProblem("withdrawn", "applied")).toBeNull();
  });

  it("only hires through an accepted offer and keeps hires put", () => {
    expect(stageMoveProblem("offer", "hired")).toMatch(/accepted/);
    expect(stageMoveProblem("hired", "offer")).toMatch(/undo the hire/);
    expect(stageMoveProblem("interview", "interview")).toMatch(/already/);
  });
});

describe("onboardingProgress", () => {
  it("counts the five tasks plus the employee record", () => {
    expect(onboardingProgress({ joiningDate: "2026-11-01", onboarding: {}, employeeId: null }, TODAY)).toEqual({ done: 0, total: 6, synced: false, state: "not_started" });
    expect(onboardingProgress({ joiningDate: "2026-11-01", onboarding: { documents: done() }, employeeId: null }, TODAY).state).toBe("on_track");
  });

  it("is delayed when the joining date arrives with pre-joining work pending", () => {
    const p = onboardingProgress({ joiningDate: TODAY, onboarding: { documents: done(), kyc: done() }, employeeId: "e1" }, TODAY);
    expect(p.state).toBe("delayed");
    const noRecord = onboardingProgress({ joiningDate: "2026-10-01", onboarding: { documents: done(), kyc: done(), it: done() }, employeeId: null }, TODAY);
    expect(noRecord.state).toBe("delayed");
    const ready = onboardingProgress({ joiningDate: "2026-10-01", onboarding: { documents: done(), kyc: done(), it: done() }, employeeId: "e1" }, TODAY);
    expect(ready.state).toBe("on_track");
  });

  it("completes when every task is done and the employee record exists", () => {
    const all = { documents: done(), kyc: done(), it: done(), induction: done(), kra: done() };
    expect(onboardingProgress({ joiningDate: "2026-09-01", onboarding: all, employeeId: "e1" }, TODAY)).toEqual({ done: 6, total: 6, synced: true, state: "completed" });
    expect(onboardingProgress({ joiningDate: "2026-09-01", onboarding: all, employeeId: null }, TODAY).state).toBe("delayed");
  });
});

describe("recruitmentTotals", () => {
  const openings: PipelineOpening[] = [
    { id: "o1", status: "open", openings: 2, departmentId: "d1" },
    { id: "o2", status: "open", openings: 1, departmentId: "d2" },
    { id: "o3", status: "draft", openings: 3, departmentId: "d3" },
    { id: "o4", status: "closed", openings: 1, departmentId: "d1" },
  ];

  it("counts open positions still to fill and the departments hiring", () => {
    const t = recruitmentTotals(openings, [cand({ openingId: "o2", stage: "hired", hiredOn: "2026-09-20", offerStatus: "accepted", offerRespondedOn: "2026-09-20" })], TODAY, "2026-04-01");
    expect(t.openPositions).toBe(2);
    expect(t.departmentsHiring).toBe(1);
    expect(t.openRoles).toBe(2);
    expect(t.draftRoles).toBe(1);
  });

  it("works out time to hire, offer acceptance and stage counts", () => {
    const list = [
      cand({ stage: "applied" }),
      cand({ stage: "interview" }),
      cand({ stage: "offer", offerSentOn: "2026-10-01", offerStatus: "sent" }),
      cand({ stage: "hired", appliedOn: "2026-08-01", hiredOn: "2026-08-21", offerSentOn: "2026-08-15", offerStatus: "accepted", offerRespondedOn: "2026-08-21", joiningDate: "2026-10-12" }),
      cand({ stage: "hired", appliedOn: "2026-07-01", hiredOn: "2026-08-01", offerSentOn: "2026-07-25", offerStatus: "accepted", offerRespondedOn: "2026-08-01", joiningDate: "2026-08-15" }),
      cand({ stage: "withdrawn", offerSentOn: "2026-09-01", offerStatus: "declined", offerRespondedOn: "2026-09-03" }),
      cand({ stage: "hired", appliedOn: "2024-01-01", hiredOn: "2024-02-01", offerStatus: "accepted", offerRespondedOn: "2024-02-01", joiningDate: "2024-03-01" }),
    ];
    const t = recruitmentTotals(openings, list, TODAY, "2026-04-01");
    expect(t.activeApplicants).toBe(3);
    expect(t.byStage).toMatchObject({ applied: 1, interview: 1, offer: 1, hired: 3, withdrawn: 1 });
    expect(t.avgDaysToHire).toBe(26);
    expect(t.hiresCounted).toBe(2);
    expect([t.offersAccepted, t.offersDeclined, t.offersPending, t.offersSent]).toEqual([2, 1, 1, 4]);
    expect(t.joinersThisMonth).toBe(1);
    expect(t.onboarding.total).toBe(3);
    expect(t.onboarding.delayed).toBe(2);
  });

  it("counts inductions in the next week and pending documents", () => {
    const list = [
      cand({ stage: "hired", hiredOn: "2026-09-20", joiningDate: "2026-10-10", onboarding: { induction: { done: false, date: "2026-10-10" } } }),
      cand({ stage: "hired", hiredOn: "2026-09-20", joiningDate: "2026-11-10", onboarding: { documents: done(), induction: { done: false, date: "2026-11-10" } } }),
    ];
    const t = recruitmentTotals(openings, list, TODAY, "2026-04-01");
    expect(t.inductionsSoon).toBe(1);
    expect(t.documentsPending).toBe(1);
    expect(t.avgDaysToHire).toBe(19);
  });
});

describe("helpers", () => {
  it("splits a name into first and last", () => {
    expect(splitName("  Asha  Rao Kumar ")).toEqual({ firstName: "Asha Rao", lastName: "Kumar" });
    expect(splitName("Ravi")).toEqual({ firstName: "Ravi", lastName: null });
  });

  it("reads a stored checklist and drops unknown keys", () => {
    expect(readOnboarding({ documents: { done: true, date: "2026-10-01" }, induction: { done: false, date: "2026-10-10" }, laptop: { done: true }, kyc: "yes" })).toEqual({
      documents: { done: true, date: "2026-10-01" },
      induction: { done: false, date: "2026-10-10" },
    });
    expect(readOnboarding(null)).toEqual({});
  });
});
